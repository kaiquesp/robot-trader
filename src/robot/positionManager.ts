// src/robot/positionManager.ts

import { calculateEMA } from '../utils/indicators';
import { Indicators } from '../models/Indicators';
import { fetchAllSymbols, SymbolInfo } from '../services/binanceService';
import { Context, determineAction } from '../rules/tradingRules';
import { indicatorService } from '../services/indicatorsService';
import { TradingRule } from '../enum/tradingRule';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryDate?: string;
  exitPrice?: number;
  positionAmt: number;
}

const EMA_SHORT = parseInt(process.env.EMA_SHORT || '34', 10);
const EMA_LONG = parseInt(process.env.EMA_LONG || '72', 10);

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
      emaSlowPrev: ind.emaSlowPrev ?? 0,
      lastPrices: ind.closes?.slice(-20) ?? []  // <<< ESTE CAMPO é o que precisa estar aqui!
    };
  }

  shouldClosePosition(symbol: string, pos: OpenPosition, ind: Indicators): boolean {
    const { closes } = ind;
    if (!closes || closes.length < EMA_LONG + 2) return false;

    const emaShort = calculateEMA(closes, EMA_SHORT);
    const emaLong = calculateEMA(closes, EMA_LONG);

    const n = closes.length - 1;

    // Usamos os candles fechados (n-1 e n-2)
    const prevShort = emaShort[n - 2];
    const prevLong = emaLong[n - 2];
    const currShort = emaShort[n - 1];
    const currLong = emaLong[n - 1];

    const emaDiffPct = Math.abs(currShort - currLong) / currLong;
    const crossedDown = currShort < currLong && prevShort >= prevLong;
    const crossedUp = currShort > currLong && prevShort <= prevLong;
    const minDiffPct = 0; // 0.2%

    if (pos.side === 'BUY') {
      if (crossedDown && emaDiffPct > minDiffPct) {
        console.log(`🟥 Symbol: ${symbol} Fechando BUY: crossedDown=${crossedDown}, emaDiffPct=${(emaDiffPct * 100).toFixed(2)}%`);
        return true;
      }
    } else {
      if (crossedUp && emaDiffPct > minDiffPct) {
        console.log(`🟦 Symbol: ${symbol} Fechando SELL: crossedUp=${crossedUp}, emaDiffPct=${(emaDiffPct * 100).toFixed(2)}%`);
        return true;
      }
    }

    console.log(`🟩 Symbol: ${symbol} Mantendo posição: side=${pos.side}, emaDiffPct=${(emaDiffPct * 100).toFixed(2)}%`);
    return false;
  }

}

function fetchVolume(symbol: string): number | PromiseLike<number> {
  throw new Error('Function not implemented.');
}
