// src/services/positionService.ts

import axios from 'axios';
import crypto from 'crypto';
import WebSocket from 'ws';
import { getTimeOffset } from './timeOffsetService';

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

  /** Retorna posições abertas (do cache atualizado por WS) */
  async getOpenPositions(): Promise<OpenPosition[]> {
    return Array.from(this.openPositions.values());
  }

  /** Inicia o listener de posições via WebSocket */
  async startPositionStream() {
    this.isStopped = false;
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
      console.log('[PositionService] WS aberto ✅');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleWsMessage(msg);
      } catch (err) {
        console.error('[PositionService] Erro ao parsear WS:', err);
      }
    });

    this.ws.on('close', () => {
      console.warn('[PositionService] WS fechado, tentando reconectar...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[PositionService] WS erro:', err);
      this.scheduleReconnect();
    });
  }

  /** Lida com as mensagens WS */
  private handleWsMessage(msg: any) {
    if (msg.e === 'ACCOUNT_UPDATE') {
      const positions = msg.a?.P ?? [];

      let updatedCount = 0;

      positions.forEach((p: any) => {
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
          // Remove posição zerada
          if (this.openPositions.has(p.s)) {
            this.openPositions.delete(p.s);
          }
        }
      });

      console.log(`[PositionService] WS update recebido - ${updatedCount} posições abertas`);
    }
  }

  /** Reagendar reconexão do WS */
  private scheduleReconnect() {
    if (this.isStopped) {
      console.log('[PositionService] Reconexão abortada — service foi parado');
      return;
    }

    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }

    this.wsReconnectTimer = setTimeout(async () => {
      if (this.isStopped) {
        console.log('[PositionService] Reconexão abortada — service foi parado');
        return;
      }
      
      console.log('[PositionService] Reconectando WS...');
      await this.startPositionStream();
    }, 5000);
  }

  /** Opcional: parar WS e limpar */
  stopPositionStream() {
    console.log('[PositionService] Encerrando WS...');
    this.isStopped = true;
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = undefined;
    }
  }
}
