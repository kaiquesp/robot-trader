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
          (!s.contractType || s.contractType === 'PERPETUAL') &&
          !!s.symbol && typeof s.symbol === 'string' &&
          s.symbol !== 'undefined' &&
          s.symbol.trim() !== '' &&
          /[A-Z0-9]+USDT$/.test(s.symbol)
        )
        .map(s => s.symbol);
    } catch (error: any) {
      console.error('❌ Erro ao buscar símbolos da API:', error.message ?? error);
      return [];
    }
  }

  async processSymbol(symbol: string, ruleSet: TradingRule) {
    if (!symbol || typeof symbol !== 'string' || symbol === 'undefined' || symbol.trim() === '') {
      throw new Error(`Símbolo inválido em processSymbol: ${symbol}`);
    }

    const indicators = await indicatorService.fetchIndicators(symbol);
    const context = this.mapIndicatorsToContext(indicators, symbol);
    const action = determineAction(ruleSet, context);

    return action;
  }

  mapIndicatorsToContext(ind: Indicators, symbol: string,): Context {
    const n = ind.closes?.length ? ind.closes.length - 1 : 0;

    // Corrigido: pega o último valor do array do RSI, se existir
    const latestRsi =
      Array.isArray(ind.rsi) && ind.rsi.length > 0
        ? ind.rsi[ind.rsi.length - 1]
        : typeof ind.rsi === "number"
          ? ind.rsi
          : 50; // fallback neutro

    return {
      symbol: symbol,
      rsi: latestRsi,
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
      lastPrices: ind.closes?.slice(-20) ?? []
    };
  }

  shouldClosePosition(symbol: string, pos: OpenPosition, ctx: Context): boolean {
    const crossedDown = ctx.emaFast < ctx.emaSlow && ctx.emaFastPrev >= ctx.emaSlowPrev;
    const crossedUp = ctx.emaFast > ctx.emaSlow && ctx.emaFastPrev <= ctx.emaSlowPrev;

    const distanceToSupportPct = ((ctx.price - ctx.support) / ctx.price) * 100;
    const distanceToResistancePct = ((ctx.resistance - ctx.price) / ctx.price) * 100;
    const thresholdPct = 1; // %

    const minDeltaPct = 0.05; // % distância mínima entre EMAs após cruzamento (histerese)
    const deltaPct = Math.abs(ctx.emaFast - ctx.emaSlow) / ctx.price * 100;

    if (!ctx.price) {
      console.warn(`[${symbol}] Preço zero ou inválido em shouldClosePosition, pulando...`);
      return false;
    }

    if (pos.side === 'BUY') {
      if (crossedDown && ctx.trend === 'DOWN' && deltaPct >= minDeltaPct) {
        console.log(
          `✅ [${symbol}] Fechando BUY → Crossover DOWN + resistência perto (${distanceToResistancePct.toFixed(2)}%) + delta ${deltaPct.toFixed(2)}%`
        );
        return true;
      }
    }
    else if (pos.side === 'SELL') {
      if (crossedUp && ctx.trend === 'UP' && deltaPct >= minDeltaPct) {
        console.log(
          `✅ [${symbol}] Fechando SELL → Crossover UP + suporte perto (${distanceToSupportPct.toFixed(2)}%) + delta ${deltaPct.toFixed(2)}%`
        );
        return true;
      }
    }

    console.log(`➡️  [${symbol}] Mantendo posição ${pos.side} — delta EMA: ${deltaPct.toFixed(2)}%`);
    return false;
  }
}

function fetchVolume(symbol: string): number | PromiseLike<number> {
  throw new Error('Function not implemented.');
}
