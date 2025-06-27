// src/services/positionService.ts

import axios from 'axios';
import crypto from 'crypto';
import WebSocket from 'ws';
import { getTimeOffset } from './timeOffsetService';
import fs from 'fs';
import path from 'path';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime?: number;
  positionAmt: number;
}

export class PositionService {
  private baseURL: string;
  private apiKey: string;
  private apiSecret: string;

  private openPositions: Map<string, OpenPosition> = new Map();
  private ws?: WebSocket;
  private listenKey?: string;
  private wsReconnectTimer?: NodeJS.Timeout;
  private listenKeyInterval?: NodeJS.Timeout;

  private lastRestSync: number = 0;

  private isStopped: boolean = false;

  constructor(baseURL: string, apiKey: string, apiSecret: string) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /** Gera a assinatura HMAC-SHA256 sobre a query string */
  private sign(query: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(query)
      .digest('hex');
  }

  /** Retorna posições abertas (do cache atualizado por WS, ou via REST se vazio) */
  async getOpenPositions(): Promise<OpenPosition[]> {
    let arr = Array.from(this.openPositions.values());
    const now = Date.now();
    if (arr.length === 0 && now - this.lastRestSync > 500000) { // 30s
      this.lastRestSync = now;
      // this.log('[PositionService] Nenhuma posição em cache via WS, tentando fallback via REST...');
      try {
        await this.syncOpenPositionsViaRest();
        arr = Array.from(this.openPositions.values());
      } catch (err) {
        this.log('[PositionService] Erro no fallback REST:', (err as any)?.message || err);
      }
    }
    return arr;
  }

  /** (Melhoria) Valida symbol da Binance */
  private isValidSymbol(symbol: any): boolean {
    return !!symbol && typeof symbol === 'string' && symbol !== 'undefined' && symbol.trim() !== '';
  }

  /** Inicia o listener de posições via WebSocket */
  async startPositionStream() {
    this.isStopped = false;
    await this.cleanupWs(); // Evita múltiplas conexões

    try {
      console.log('[PositionService] Criando listenKey...');
      const resp = await axios.post<{ listenKey: string }>(
        `${this.baseURL}/fapi/v1/listenKey`,
        {},
        {
          headers: {
            'X-MBX-APIKEY': this.apiKey
          }
        }
      );

      this.listenKey = resp.data.listenKey;
      const wsURL = `wss://fstream.binance.com/ws/${this.listenKey}`;

      console.log(`[PositionService] Conectando WS em: ${wsURL}`);

      this.ws = new WebSocket(wsURL);

      this.ws.on('open', () => {
        this.log('[PositionService] WS aberto ✅');
        this.startKeepAliveListenKey(); // Inicia keep-alive
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWsMessage(msg);
        } catch (err) {
          this.log('[PositionService] Erro ao parsear WS:', err);
        }
      });

      this.ws.on('close', () => {
        this.log('[PositionService] WS fechado, tentando reconectar...');
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.log('[PositionService] WS erro:', err);
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.log(`[PositionService] Erro ao criar listenKey: ${err?.response?.data?.msg || err.message}`);
      this.scheduleReconnect();
    }
  }

  /** (Melhoria) Keep-alive listenKey a cada 20 minutos */
  private startKeepAliveListenKey() {
    if (this.listenKeyInterval) clearInterval(this.listenKeyInterval);

    this.listenKeyInterval = setInterval(async () => {
      if (this.isStopped || !this.listenKey) return;
      try {
        await axios.put(
          `${this.baseURL}/fapi/v1/listenKey`,
          {},
          { headers: { 'X-MBX-APIKEY': this.apiKey } }
        );
        this.log('[PositionService] ListenKey renovada com sucesso.');
      } catch (err: any) {
        this.log('[PositionService] Erro ao renovar listenKey:', err?.response?.data?.msg || err.message);
      }
    }, 20 * 60 * 1000); // 20 minutos
  }

  /** Lida com as mensagens WS */
  private handleWsMessage(msg: any) {
    if (msg.e === 'ACCOUNT_UPDATE') {
      const positions = msg.a?.P ?? [];
      let updatedCount = 0;

      positions.forEach((p: any) => {
        if (!this.isValidSymbol(p.s)) return;

        const positionAmt = parseFloat(p.pa);
        if (positionAmt !== 0) {
          const pos: OpenPosition = {
            symbol: p.s,
            side: positionAmt > 0 ? 'BUY' : 'SELL',
            entryPrice: parseFloat(p.ep),
            positionAmt: positionAmt
          };
          this.openPositions.set(pos.symbol, pos);
          updatedCount++;
        } else {
          if (this.openPositions.has(p.s)) {
            this.openPositions.delete(p.s);
          }
        }
      });

      this.log(`[PositionService] WS update recebido - ${updatedCount} posições abertas`);
    }
  }

  /** Reagendar reconexão do WS */
  private scheduleReconnect() {
    if (this.isStopped) {
      this.log('[PositionService] Reconexão abortada — service foi parado');
      return;
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    this.wsReconnectTimer = setTimeout(async () => {
      if (this.isStopped) {
        this.log('[PositionService] Reconexão abortada — service foi parado');
        return;
      }

      this.log('[PositionService] Reconectando WS...');
      await this.startPositionStream();
    }, 5000);
  }

  /** Fallback via REST para ressincronizar posições (melhoria) */
  async syncOpenPositionsViaRest() {
    try {
      const timestamp = Date.now() + getTimeOffset();
      const recvWindow = 30000;
      const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
      const signature = this.sign(query);

      const resp = await axios.get<any[]>(
        `${this.baseURL}/fapi/v2/positionRisk?${query}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': this.apiKey }
        }
      );
      let count = 0;
      for (const p of resp.data) {
        if (!this.isValidSymbol(p.symbol)) continue;
        const amt = Number(p.positionAmt);
        if (amt !== 0) {
          this.openPositions.set(p.symbol, {
            symbol: p.symbol,
            side: amt > 0 ? 'BUY' : 'SELL',
            entryPrice: Number(p.entryPrice),
            positionAmt: amt,
          });
          count++;
        } else {
          this.openPositions.delete(p.symbol);
        }
      }
      this.log(`[PositionService] Posições sincronizadas via REST: ${count}`);
    } catch (err: any) {
      this.log('[PositionService] Falha ao sincronizar posições via REST:', err?.response?.data?.msg || err.message);
    }
  }

  /** Limpa WebSocket e intervalos */
  private async cleanupWs() {
    this.isStopped = true;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = undefined;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = undefined;
    }
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval);
      this.listenKeyInterval = undefined;
    }
    this.isStopped = false;
  }

  /** Opcional: parar WS e limpar */
  stopPositionStream() {
    this.log('[PositionService] Encerrando WS...');
    this.cleanupWs();
  }

  /** Logging para arquivo + console (opcional) */
  private log(...args: any[]) {
    const msg = args.map(String).join(' ');
    console.log(msg);
    // (Opcional) Persistir log em arquivo
    // try {
    //   const logPath = path.join(__dirname, "../logs/positions.log");
    //   fs.mkdirSync(path.dirname(logPath), { recursive: true });
    //   fs.appendFileSync(logPath, new Date().toISOString() + ' ' + msg + "\n");
    // } catch { }
  }
}
