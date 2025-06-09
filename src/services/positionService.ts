// src/services/positionService.ts

import axios from 'axios';
import crypto from 'crypto';
import { getTimeOffset } from '../utils/timeOffset';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  positionAmt: number;
}

export class PositionService {
  private baseURL: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(
    baseURL: string,
    apiKey: string,
    apiSecret: string
  ) {
    this.baseURL   = baseURL;
    this.apiKey    = apiKey;
    this.apiSecret = apiSecret;
  }

  /** Gera a assinatura HMAC-SHA256 sobre a query string */
  private sign(query: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(query)
      .digest('hex');
  }

  /**
   * Busca todas as posições abertas (positionAmt ≠ 0) na conta Futures
   * e retorna só symbol, side, entryPrice e quantidade.
   */
  async getOpenPositions(): Promise<OpenPosition[]> {
    // 1) monta timestamp + recvWindow
    const offset = await getTimeOffset();    // se não usar offset, remova esta linha
    const timestamp = Date.now() + offset;
    const recvWindow = 60_000;

    // 2) query string pra assinatura
    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
    const signature = this.sign(query);

    // 3) chamada HTTP
    const resp = await axios.get<{ 
      symbol: string; 
      positionAmt: string; 
      entryPrice: string; 
    }[]>(
      `${this.baseURL}/fapi/v2/positionRisk`,
      {
        params: {
          timestamp,
          recvWindow,
          signature
        },
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      }
    );

    // 4) filtra e mapeia só posições !== 0
    const open: OpenPosition[] = resp.data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'BUY' : 'SELL',
        entryPrice: parseFloat(p.entryPrice),
        positionAmt: parseFloat(p.positionAmt)
      }));

    return open;
  }
}
