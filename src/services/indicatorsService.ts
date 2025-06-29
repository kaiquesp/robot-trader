import { fetchAllKlines, fetchFundingRate, fetchLongShortRatio, fetchOpenInterest } from '../services/binanceService';
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
  calculateCVD,
  calculateEMA
} from '../utils/indicators';
import { Indicators } from '../models/Indicators';
import { BOT_TIMEFRAME } from '../configs/botConstants';

/** Converte intervalos ('15m','1h','1d' etc) em milissegundos. */
function intervalToMs(interval: string): number {
  const unit = interval.slice(-1);
  const num = parseInt(interval.slice(0, -1), 10);
  switch (unit) {
    case 'm': return num * 60_000;
    case 'h': return num * 3_600_000;
    case 'd': return num * 86_400_000;
    default: throw new Error(`Intervalo não suportado: ${interval}`);
  }
}

const DEFAULT_RSI = 50;

export class IndicatorService {
  /**
   * Busca e retorna indicadores para timeframe configurado. Nunca retorna null.
   */
  async fetchIndicators(symbol: string): Promise<Indicators> {
    const interval = BOT_TIMEFRAME;
    const endTime = Date.now();
    const startTime = endTime - 251 * intervalToMs(interval);

    const raw = await fetchAllKlines(symbol, interval, startTime, endTime);

    if (!raw || raw.length < 26) {
      console.warn(`⚠️ Poucas velas para ${symbol} (${raw?.length}). Usando defaults.`);
      const empty: number[] = [];
      return {
        opens: empty,
        highs: empty,
        lows: empty,
        closes: empty,
        volumes: empty,
        rsi: 50,   // valor neutro se não houver dados suficientes
        macd: 0,
        signal: 0,
        histogram: 0,
        bollinger: { middle: 0, upper: 0, lower: 0 },
        support: 0,
        resistance: 0,
        emaTrend: 'sideways',
        atr: 0,
        adx: 0,
        stochastic: { k: empty, d: empty },
        vwap: 0,
        obv: 0,
        cmf: 0,
        cvd: empty,
        lsr: 0,
        oi: 0,
        funding: 0,
        emaFast: 0,
        emaSlow: 0,
        emaFastPrev: 0,
        emaSlowPrev: 0
      };
    }

    const klines = raw.slice(-251, -1);

    // Certifique-se de converter para number caso venha string
    const opens = klines.map(k => +k.open);
    const highs = klines.map(k => +k.high);
    const lows = klines.map(k => +k.low);
    const closes = klines.map(k => +k.close);
    const volumes = klines.map(k => +k.volume);

    // O RSI normalmente retorna array; pegue só o último valor
    const rsiArr = calculateRSI(closes);
    const rsi = Array.isArray(rsiArr) ? (rsiArr.length ? rsiArr[rsiArr.length - 1] : DEFAULT_RSI) : DEFAULT_RSI;

    const { macd, signal, histogram } = calculateMACD(closes);
    const bollinger = calculateBollingerBands(closes);
    const { support, resistance } = calculateSupportResistance(closes);
    const emaTrend = calculateEMATrend(closes);
    const atr = calculateATR(highs, lows, closes);
    const adx = calculateADX(highs, lows, closes);
    const stochastic = calculateStochastic(highs, lows, closes);
    const vwap = calculateVWAP(highs, lows, closes, volumes);
    const obv = calculateOBV(closes, volumes);
    const cmf = calculateCMF(highs, lows, closes, volumes);
    const cvd = calculateCVD(opens, closes, volumes);

    const emaFastArray = calculateEMA(closes, 34);
    const emaSlowArray = calculateEMA(closes, 72);

    const emaFastCurr = emaFastArray[emaFastArray.length - 1] ?? 0;
    const emaSlowCurr = emaSlowArray[emaSlowArray.length - 1] ?? 0;

    const emaFastPrev = emaFastArray[emaFastArray.length - 2] ?? 0;
    const emaSlowPrev = emaSlowArray[emaSlowArray.length - 2] ?? 0;

    // LSR, OI, Funding: proteja o fetch
    let lsr = 0, oi = 0, funding = 0;
    try { lsr = await fetchLongShortRatio(symbol) ?? 0; } catch (err) { console.warn(`[LSR] ${symbol}:`, err); }
    try { oi = await fetchOpenInterest(symbol) ?? 0; } catch (err) { console.warn(`[OI] ${symbol}:`, err); }
    try { funding = await fetchFundingRate(symbol) ?? 0; } catch (err) { console.warn(`[Funding] ${symbol}:`, err); }

    return {
      opens,
      highs,
      lows,
      closes,
      volumes,
      rsi,
      macd,
      signal,
      histogram,
      bollinger,
      support,
      resistance,
      emaTrend,
      atr,
      adx,
      stochastic,
      vwap,
      obv,
      cmf,
      cvd,
      lsr,
      oi,
      funding,
      emaFast: emaFastCurr,
      emaSlow: emaSlowCurr,
      emaFastPrev,
      emaSlowPrev
    };
  }
}

export const indicatorService = new IndicatorService();
