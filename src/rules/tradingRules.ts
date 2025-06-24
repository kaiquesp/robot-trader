// src/rules/tradingRules.ts

import { TradingRule } from "../enum/tradingRule";

type Action = 'BUY' | 'SELL' | 'HOLD';

type Context = {
  rsi: number;
  macd: number;
  volume: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  lsr: number;
  openInterest: number;
  fundingRate: number;
  atr: number;
  adx: number;
  stochasticK: number;
  stochasticD: number;
  vwap: number;
  obv: number;
  cmf: number;
  support: number;
  resistance: number;
  price: number;
  cvd: number;
  openPrice?: number;
  high?: number;
  low?: number;
  emaFast: number;
  emaSlow: number;
  emaFastPrev: number;
  emaSlowPrev: number;
  lastPrices: number[];
};

type RuleFunction = (context: Context) => Action | null;

const ruleSets: Record<TradingRule, RuleFunction[]> = {
  [TradingRule.emaCrossover34x72]: [
    (ctx) => {
      const crossedUp = ctx.emaFast > ctx.emaSlow && ctx.emaFastPrev <= ctx.emaSlowPrev;
      const distanceToSupportPct = ((ctx.price - ctx.support) / ctx.price) * 100;
      const thresholdPct = 1; // % — pode parametrizar se quiser

       if (crossedUp && ctx.trend === 'UP' && distanceToSupportPct <= thresholdPct) {
        console.log(`📈 Crossover UP + perto do suporte (${distanceToSupportPct.toFixed(2)}%) → BUY`);
        return 'BUY';
      }
      return null;
    },
    (ctx) => {
      const crossedDown = ctx.emaFast < ctx.emaSlow && ctx.emaFastPrev >= ctx.emaSlowPrev;
      const distanceToResistancePct = ((ctx.resistance - ctx.price) / ctx.price) * 100;
      const thresholdPct = 1; // % — pode parametrizar se quiser

      if (crossedDown && ctx.trend === 'DOWN' && distanceToResistancePct <= thresholdPct) {
        console.log(`📉 Crossover DOWN + perto da resistência (${distanceToResistancePct.toFixed(2)}%) → SELL`);
        return 'SELL';
      }
      return null;
    }
  ],

  [TradingRule.basicRSIMACD]: [
    (ctx) => ctx.rsi < 30 && ctx.macd > 0 ? 'BUY' : null,
    (ctx) => ctx.rsi > 70 && ctx.macd < 0 ? 'SELL' : null,
  ],

  [TradingRule.volumeTrend]: [
    (ctx) => ctx.trend === 'UP' && ctx.volume > 1_000_000 ? 'BUY' : null,
    (ctx) => ctx.trend === 'DOWN' && ctx.volume > 1_000_000 ? 'SELL' : null,
  ],

  [TradingRule.lsrOpenInterest]: [
    (ctx) => ctx.lsr < 1.5 && ctx.openInterest > 0 ? 'BUY' : null,
    (ctx) => ctx.lsr > 2 && ctx.openInterest < 0 ? 'SELL' : null,
  ],

  [TradingRule.supportResistanceCVD]: [
    (ctx) => ctx.price <= ctx.support * 1.01 && ctx.cvd > 0 ? 'BUY' : null,
    (ctx) => ctx.price >= ctx.resistance * 0.99 && ctx.cvd < 0 ? 'SELL' : null,
  ],

  [TradingRule.improvedRSIMACD]: [],
  [TradingRule.fundingRate]: [],
  [TradingRule.atrAdxStochastic]: [],
  [TradingRule.vwapObvCmf]: [],
};

function determineAction(ruleSetName: TradingRule, context: Context): Action {
  const rules = ruleSets[ruleSetName];
  if (!rules) {
    throw new Error(`Regra "${ruleSetName}" não encontrada`);
  }

  for (const rule of rules) {
    const result = rule(context);
    if (result !== null) {
      return result;
    }
  }

  return 'HOLD';
}

export { ruleSets, determineAction, Context, Action };
