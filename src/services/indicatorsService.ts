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
import { Indicators } from '../models/Indicators';

/**
 * Serviço de indicadores (live) que sempre retorna um objeto completo,
 * incluindo arrays de preços para o BotController.
 */
export class IndicatorService {
  /**
   * Busca e retorna indicadores. Nunca retorna null.
   */
  async fetchIndicators(symbol: string): Promise<Indicators> {
    // 1) Baixa todas as velas de 5m (pode vir mais, vamos fatiar)
    const raw = await fetchKlines(symbol, '5m');
    if (!raw || raw.length < 26) {
      console.warn(`Poucas velas para ${symbol} (encontradas ${raw?.length}). Usando valores default.`);
      const empty: number[] = [];
      return {
        opens:   empty,
        highs:   empty,
        lows:    empty,
        closes:  empty,
        volumes: empty,
        rsi: 50,
        macd: 0, signal: 0, histogram: 0,
        bollinger: { middle: 0, upper: 0, lower: 0 },
        support: 0, resistance: 0,
        emaTrend: 'sideways',
        atr: 0, adx: 0,
        stochastic: { k: empty, d: empty },
        vwap: 0, obv: 0, cmf: 0, cvd: empty,
        lsr: 0, oi: 0, funding: 0
      };
    }

    // 2) Seleciona últimas 100 velas
    const klines = raw.slice(-100);

    // 3) Extrai arrays de candles
    const opens   = klines.map((k: any[]) => parseFloat(k[1]));
    const highs   = klines.map((k: any[]) => parseFloat(k[2]));
    const lows    = klines.map((k: any[]) => parseFloat(k[3]));
    const closes  = klines.map((k: any[]) => parseFloat(k[4]));
    const volumes = klines.map((k: any[]) => parseFloat(k[5]));

    // 4) Calcula indicadores técnicos
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

    // 5) Indicadores de derivativos
    const lsr     = await fetchLongShortRatio(symbol)  ?? 0;
    const oi      = await fetchOpenInterest(symbol)    ?? 0;
    const funding = await fetchFundingRate(symbol)     ?? 0;

    // 6) Retorna tudo sem jamais retornar null
    return {
      opens, highs, lows, closes, volumes,
      rsi,
      macd, signal, histogram,
      bollinger, support, resistance,
      emaTrend, atr, adx, stochastic,
      vwap, obv, cmf, cvd,
      lsr, oi, funding
    };
  }
}