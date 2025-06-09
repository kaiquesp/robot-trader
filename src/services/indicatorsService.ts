// src/robot/indicatorService.ts

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSupportResistance,
  calculateEMATrend,
  calculateATR,
  calculateADX,
  calculateStochastic,
  calculateVWAP,
  calculateOBV,
  calculateCMF,
  calculateCVD
} from '../utils/indicators';
import {
  fetchKlines,
  fetchLongShortRatio,
  fetchOpenInterest,
  fetchFundingRate
} from '../services/binanceService';

export interface Indicators {
  highs: number[];
  lows: number[];
  opens: number[];        // <- adicionado
  closes: number[];
  volumes: number[];
  rsi: number;
  macd: number;
  signal: number;
  histogram: number;
  bollinger: { middle: number; upper: number; lower: number };
  support: number;
  resistance: number;
  emaTrend: 'up' | 'down' | 'sideways';
  atr: number;
  adx: number;
  stochastic: { k: number[]; d: number[] };
  vwap: number;
  obv: number;
  cmf: number;
  cvd: number[];
  lsr: number;
  oi: number;
  funding: number;
}

export class IndicatorService {
  async fetchIndicators(symbol: string): Promise<Indicators | null> {
    // 1) pega 100 velas de 5m
    const klines = await fetchKlines(symbol, '5m', 100);
    if (!klines || klines.length < 26) return null;

    // 2) extrai arrays de candles
    const opens   = klines.map((k: any) => parseFloat(k[1]));
    const highs   = klines.map((k: any) => parseFloat(k[2]));
    const lows    = klines.map((k: any) => parseFloat(k[3]));
    const closes  = klines.map((k: any) => parseFloat(k[4]));
    const volumes = klines.map((k: any) => parseFloat(k[5]));

    // 3) calcula todos os indicadores
    const rsi       = calculateRSI(closes);
    const { macd, signal, histogram } = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes);
    const { support, resistance } = calculateSupportResistance(closes);
    const emaTrend  = calculateEMATrend(closes);
    const atr       = calculateATR(highs, lows, closes);
    const adx       = calculateADX(highs, lows, closes);
    const stochastic= calculateStochastic(highs, lows, closes);
    const vwap      = calculateVWAP(highs, lows, closes, volumes);
    const obv       = calculateOBV(closes, volumes);
    const cmf       = calculateCMF(highs, lows, closes, volumes);
    const cvd       = calculateCVD(opens, closes, volumes);

    // 4) indicadores de câmbio e derivativos
    const lsr       = await fetchLongShortRatio(symbol)  ?? 0;
    const oi        = await fetchOpenInterest(symbol)    ?? 0;
    const funding   = await fetchFundingRate(symbol)     ?? 0;

    return {
      opens, highs, lows, closes, volumes,
      rsi, macd, signal, histogram,
      bollinger, support, resistance,
      emaTrend, atr, adx, stochastic,
      vwap, obv, cmf, cvd,
      lsr, oi, funding
    };
  }
}
