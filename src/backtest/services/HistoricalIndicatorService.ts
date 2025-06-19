// src/backtest/services/HistoricalIndicatorService.ts

import { Indicators } from "../../models/Indicators";
import { Candle, fetchLongShortRatio, fetchOpenInterest } from "../../services/binanceService";
import { calculateEMA, calculateRSI } from "../../utils/indicators";

/**
 * Serviço para retornar indicadores históricos baseados em velas carregadas.
 */
export class HistoricalIndicatorService {
  private candles: Candle[];
  private currentTime = 0;

  constructor(candles: Candle[]) {
    this.candles = candles;
  }

  /** Define o timestamp atual para simulação */
  setCurrentTime(timestamp: number): void {
    this.currentTime = timestamp;
  }

  /** Busca indicadores até o timestamp atual, incluindo arrays de preços */
  async fetchIndicators(symbol: string): Promise<Indicators> {
    // filtra velas até o timestamp
    const slice = this.candles.filter(c => c.openTime <= this.currentTime);

    // extrai arrays de velas
    const opens = slice.map(c => c.open);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const closes = slice.map(c => c.close);
    const volumes = slice.map(c => c.volume);

    // calcula RSI (últimos 14 períodos)
    const rsi = calculateRSI(closes.slice(-14));

    // LS-Ratio e Open Interest históricos
    const lsr = await fetchLongShortRatio(symbol, this.currentTime) ?? 0;
    const oi = await fetchOpenInterest(symbol, this.currentTime) ?? 0;
    const emaFast = calculateEMA(closes, 34);
    const emaSlow = calculateEMA(closes, 72);
    const emaFastCurr = emaFast[emaFast.length - 1] ?? 0;
    const emaSlowCurr = emaSlow[emaSlow.length - 1] ?? 0;

    const emaFastPrev = emaFast[emaFast.length - 2] ?? 0;
    const emaSlowPrev = emaSlow[emaSlow.length - 2] ?? 0;

    // retorna todos os campos obrigatórios da interface Indicators
    return {
      opens,
      highs,
      lows,
      closes,
      volumes,
      rsi,
      lsr,
      oi,
      emaFast: emaFastCurr,
      emaSlow: emaSlowCurr,
      emaFastPrev,
      emaSlowPrev
    };
  }
}