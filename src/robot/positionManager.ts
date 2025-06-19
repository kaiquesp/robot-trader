// src/robot/positionManager.ts

import {
  calculateADX,
  calculateATR,
  calculateCMF,
  calculateCVD,
  calculateEMA,
  calculateMACD,
  calculateOBV,
  calculateRSI,
  calculateVWAP
} from '../utils/indicators';
import { Indicators } from '../models/Indicators';
import { fetchAllKlines, fetchAllSymbols, fetchFundingRate, fetchLongShortRatio, fetchOpenInterest, SymbolInfo } from '../services/binanceService';
import { Context, determineAction } from '../rules/tradingRules';
import { BOT_TIMEFRAME } from '../configs/botConstants';
import { indicatorService } from '../services/indicatorsService';
import { TradingRule } from '../enum/tradingRule';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryDate?: string; // data de entrada, opcional
  exitPrice?: number; // preço de saída, opcional
  positionAmt: number;
}

const EMA_SHORT = parseInt(process.env.EMA_SHORT || '34', 10);
const EMA_LONG = parseInt(process.env.EMA_LONG || '72', 10);
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

  //   determineAction(symbol: string, ind: Indicators): 'BUY' | 'SELL' | null {
  //   const { closes, highs, lows, volumes } = ind;
  //   if (
  //     !closes || closes.length < 50 ||
  //     !highs || highs.length < closes.length ||
  //     !lows || lows.length < closes.length ||
  //     !volumes || volumes.length < closes.length
  //   ) {
  //     return null;
  //   }

  //   const n = closes.length - 1;

  //   // --- 1️⃣ Parâmetros ajustados ---
  //   const rsi = ind.rsi ?? 50;
  //   const lsrValue = ind.lsr ?? 1.0;
  //   const adx = ind.adx ?? 0;
  //   const obv = ind.obv ?? 0;
  //   const atr = ind.atr ?? 0;

  //   // Média de volume
  //   const avgVolume = volumes.slice(n - 20, n).reduce((a, b) => a + b, 0) / 20;
  //   const volCurrent = volumes[n];

  //   // --- 2️⃣ Bollinger breakout ---
  //   const upper = ind.bollinger?.upper ?? 0;
  //   const lower = ind.bollinger?.lower ?? 0;

  //   const price = closes[n];
  //   const breakoutUp = price > upper;
  //   const breakoutDown = price < lower;

  //   // --- 3️⃣ Candle rejection ---
  //   const candleBody = Math.abs(closes[n] - (ind.opens && ind.opens[n] !== undefined ? ind.opens[n] : closes[n]));
  //   const candleRange = highs[n] - lows[n];
  //   const rejection = (candleBody / candleRange) < 0.4;

  //   // --- 4️⃣ Regras mais assertivas ---

  //   // BUY
  //   if (
  //     ind.emaTrend === 'up' &&
  //     lsrValue < 1.0 &&       // + apertado
  //     rsi < 50 &&             // + apertado
  //     adx > 25 &&
  //     obv > 0 &&
  //     volCurrent > avgVolume * 1.2 &&  // exige volume alto
  //     breakoutUp &&
  //     rejection
  //   ) {
  //     console.log(`🔍 ${symbol}: sinal BUY → rsi=${rsi}, lsr=${lsrValue}, adx=${adx}, vol=${volCurrent.toFixed(0)}, avgVol=${avgVolume.toFixed(0)}`);
  //     return 'BUY';
  //   }

  //   // SELL
  //   if (
  //     ind.emaTrend === 'down' &&
  //     lsrValue > 1.2 &&       // + apertado
  //     rsi > 55 &&             // + apertado
  //     adx > 25 &&
  //     obv < 0 &&
  //     volCurrent > avgVolume * 1.2 &&
  //     breakoutDown &&
  //     rejection
  //   ) {
  //     console.log(`🔍 ${symbol}: sinal SELL → rsi=${rsi}, lsr=${lsrValue}, adx=${adx}, vol=${volCurrent.toFixed(0)}, avgVol=${avgVolume.toFixed(0)}`);
  //     return 'SELL';
  //   }

  //   // --- caso não tenha sinal ---
  //   return null;
  // }

  async processSymbol(symbol: string, ruleSet: TradingRule) {
    const indicators = await indicatorService.fetchIndicators(symbol);
    const context = this.mapIndicatorsToContext(indicators);
    const action = determineAction(ruleSet, context);

    return action;
  }

  mapIndicatorsToContext(ind: Indicators): Context {
    const n = ind.closes?.length ? ind.closes.length - 1 : 0;

    return {
      rsi: ind.rsi ?? 0,
      macd: ind.macd ?? 0,
      volume: ind.volumes?.[n] ?? 0,
      trend: ind.emaTrend === 'up' ? 'UP' :
        ind.emaTrend === 'down' ? 'DOWN' : 'SIDEWAYS',
      lsr: ind.lsr ?? 0,
      openInterest: ind.oi ?? 0,
      fundingRate: ind.funding ?? 0,
      atr: ind.atr ?? 0,
      adx: ind.adx ?? 0,
      stochasticK: ind.stochastic?.k?.[n] ?? 0,
      stochasticD: ind.stochastic?.d?.[n] ?? 0,
      vwap: ind.vwap ?? 0,
      obv: ind.obv ?? 0,
      cmf: ind.cmf ?? 0,
      support: ind.support ?? 0,
      resistance: ind.resistance ?? 0,
      price: ind.closes?.[n] ?? 0,
      cvd: ind.cvd?.[n] ?? 0,
      openPrice: ind.opens?.[n] ?? 0,
      high: ind.highs?.[n] ?? 0,
      low: ind.lows?.[n] ?? 0,
      emaFast: ind.emaFast ?? 0,
      emaSlow: ind.emaSlow ?? 0,
      emaFastPrev: ind.emaFastPrev ?? 0,
      emaSlowPrev: ind.emaSlowPrev ?? 0
    };
  }

  /**
   * Fecha BUY quando EMA_SHORT cruza abaixo de EMA_LONG + RSI < 50
   * Fecha SELL quando EMA_SHORT cruza acima de EMA_LONG + RSI > 50
   */
  shouldClosePosition(pos: OpenPosition, ind: Indicators, stopLoss?: number): boolean {
    const { closes } = ind;
    if (!closes || closes.length < EMA_LONG + 1) return false;

    const emaShort = calculateEMA(closes, EMA_SHORT);
    const emaLong = calculateEMA(closes, EMA_LONG);

    const n = closes.length - 1;
    const prevShort = emaShort[n - 1];
    const prevLong = emaLong[n - 1];
    const currShort = emaShort[n];
    const currLong = emaLong[n];
    const lastPrice = closes[n];

    const crossedDown = currShort < currLong && prevShort >= prevLong;
    const crossedUp = currShort > currLong && prevShort <= prevLong;

    const stopHitBuy = typeof stopLoss === "number" && lastPrice <= stopLoss;
    const stopHitSell = typeof stopLoss === "number" && lastPrice >= stopLoss;

    if (pos.side === 'BUY') {
      if (crossedDown || stopHitBuy) {
        console.log(`🟥 Fechando BUY: crossedDown=${crossedDown}, stopHit=${stopHitBuy}`);
        return true;
      }
    } else {
      if (crossedUp || stopHitSell) {
        console.log(`🟦 Fechando SELL: crossedUp=${crossedUp}, stopHit=${stopHitSell}`);
        return true;
      }
    }

    return false;
  }


}
function fetchVolume(symbol: string): number | PromiseLike<number> {
  throw new Error('Function not implemented.');
}

