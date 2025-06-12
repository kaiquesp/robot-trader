// src/robot/positionManager.ts

import {
  calculateEMA,
  calculateRSI
} from '../utils/indicators';
import { Indicators } from '../models/Indicators';
import { fetchAllSymbols, SymbolInfo } from '../services/binanceService';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  positionAmt?: number;
}

const EMA_SHORT = parseInt(process.env.EMA_SHORT || '34', 10);
const EMA_LONG  = parseInt(process.env.EMA_LONG  || '72', 10);
const RSI_PERIOD = parseInt(process.env.RSI_PERIOD || '14', 10);

export class PositionManager {
  async getSymbols(): Promise<string[]> {
    try {
      const symbolsInfo: SymbolInfo[] = await fetchAllSymbols();
      return symbolsInfo
        .filter(s =>
          s.status === 'TRADING' &&
          s.quoteAsset === 'USDT' &&
          (!s.contractType || s.contractType === 'PERPETUAL')
        )
        .map(s => s.symbol);
    } catch (error: any) {
      console.error('❌ Erro ao buscar símbolos da API:', error.message ?? error);
      return [];
    }
  }

  /**
   * Decide ação com base em EMA crossover + filtro RSI:
   *  - BUY se EMA34 cruzou acima de EMA72 e RSI > 50
   *  - SELL se EMA34 cruzou abaixo de EMA72 e RSI < 50
   *
   * Mantém as regras antigas comentadas para uso futuro.
   */
  determineAction(symbol: string, ind: Indicators): 'BUY' | 'SELL' | null {
    const { closes } = ind;
    if (!closes || closes.length < EMA_LONG + 1) {
      // não há candles suficientes para EMA_LONG+1
      return null;
    }

    // pré-cálculo de EMAs e RSI
    const emaShort = calculateEMA(closes, EMA_SHORT);
    const emaLong  = calculateEMA(closes, EMA_LONG);

    const n = closes.length - 1;
    const prevShort = emaShort[n - 1];
    const prevLong  = emaLong[n - 1];
    const currShort = emaShort[n];
    const currLong  = emaLong[n];

    // RSI no candle atual
    const rsi = calculateRSI(closes.slice(n - RSI_PERIOD, n + 1), RSI_PERIOD);

    // 🚀 nova regra: EMA crossover + filtro RSI
    if (currShort > currLong && prevShort <= prevLong && rsi > 50) {
      return 'BUY';
    }
    if (currShort < currLong && prevShort >= prevLong && rsi < 50) {
      return 'SELL';
    }

    // ---- regras antigas (para referência) ----
    /*
    const { lsr, support, resistance, cvd } = ind;
    if (!cvd || cvd.length === 0) return null;
    const price = closes[n];
    const oiRising = cvd[cvd.length - 1]! > cvd[0]!;
    const prox = 0.01;
    const nearSupport    = support !== undefined && price <= support * (1 + prox);
    const nearResistance = resistance !== undefined && price >= resistance * (1 - prox);

    if (lsr! <= 1 && oiRising && nearSupport) return 'BUY';
    if (lsr! >  1 && oiRising && nearResistance) return 'SELL';
    */

    return null;
  }

  /**
   * Fecha BUY quando EMA_SHORT cruza abaixo de EMA_LONG + RSI < 50
   * Fecha SELL quando EMA_SHORT cruza acima de EMA_LONG + RSI > 50
   */
  shouldClosePosition(pos: OpenPosition, ind: Indicators): boolean {
    const { closes } = ind;
    // precisa de pelo menos EMA_LONG+1 candles
    if (!closes || closes.length < EMA_LONG + 1) return false;

    // gera as EMAs
    const emaShort = calculateEMA(closes, EMA_SHORT);
    const emaLong  = calculateEMA(closes, EMA_LONG);

    const n = closes.length - 1;
    const prevShort = emaShort[n - 1];
    const prevLong  = emaLong[n - 1];
    const currShort = emaShort[n];
    const currLong  = emaLong[n];

    // RSI do candle atual (últimos RSI_PERIOD candles)
    const sliceForRsi = closes.slice(n - RSI_PERIOD + 1, n + 1);
    if (sliceForRsi.length < RSI_PERIOD) return false;
    const rsi = calculateRSI(sliceForRsi, RSI_PERIOD);

    if (pos.side === 'BUY') {
      // crossover de alta virou baixa + RSI < 50
      return currShort < currLong && prevShort >= prevLong && rsi < 50;
    } else {
      // crossover de baixa virou alta + RSI > 50
      return currShort > currLong && prevShort <= prevLong && rsi > 50;
    }
  }
}
