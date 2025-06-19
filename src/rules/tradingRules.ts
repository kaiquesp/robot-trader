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
};

type RuleFunction = (context: Context) => Action | null;

const ruleSets: Record<string, RuleFunction[]> = {
  basicRSIMACD: [
    (ctx) => ctx.rsi < 30 && ctx.macd > 0 ? 'BUY' : null,
    (ctx) => ctx.rsi > 70 && ctx.macd < 0 ? 'SELL' : null,
  ],

  improvedRSIMACD: [
    (ctx) => {
      const candleBody = Math.abs((ctx.price ?? 0) - (ctx.openPrice ?? 0));
      const candleRange = (ctx.high ?? 0) - (ctx.low ?? 0);
      const rejection = candleRange > 0 ? (candleBody / candleRange) < 0.4 : false;
      const nearSupport = ctx.price <= ctx.support * 1.01;

      if (
        ctx.rsi < 30 &&
        ctx.macd > 0 &&
        rejection &&
        nearSupport &&
        ctx.adx < 25
      ) {
        return 'BUY';
      }

      return null;
    },
    (ctx) => {
      const nearResistance = ctx.price >= ctx.resistance * 0.99;

      if (
        ctx.rsi > 70 &&
        ctx.macd < 0 &&
        nearResistance &&
        ctx.adx < 25
      ) {
        return 'SELL';
      }

      return null;
    }
  ],

  volumeTrend: [
    (ctx) => ctx.trend === 'UP' && ctx.volume > 1_000_000 ? 'BUY' : null,
    (ctx) => ctx.trend === 'DOWN' && ctx.volume > 1_000_000 ? 'SELL' : null,
  ],

  lsrOpenInterest: [
    (ctx) => ctx.lsr < 1.5 && ctx.openInterest > 0 ? 'BUY' : null,
    (ctx) => ctx.lsr > 2 && ctx.openInterest < 0 ? 'SELL' : null,
  ],

  fundingRate: [
    (ctx) => ctx.fundingRate < -0.01 ? 'BUY' : null,
    (ctx) => ctx.fundingRate > 0.01 ? 'SELL' : null,
  ],

  atrAdxStochastic: [
    (ctx) => ctx.atr > 2 && ctx.adx > 25 && ctx.stochasticK < 20 ? 'BUY' : null,
    (ctx) => ctx.atr > 2 && ctx.adx > 25 && ctx.stochasticK > 80 ? 'SELL' : null,
  ],

  vwapObvCmf: [
    (ctx) => ctx.price > ctx.vwap && ctx.obv > 0 && ctx.cmf > 0 ? 'BUY' : null,
    (ctx) => ctx.price < ctx.vwap && ctx.obv < 0 && ctx.cmf < 0 ? 'SELL' : null,
  ],

  supportResistanceCVD: [
    (ctx) => ctx.price <= ctx.support * 1.01 && ctx.cvd > 0 ? 'BUY' : null,
    (ctx) => ctx.price >= ctx.resistance * 0.99 && ctx.cvd < 0 ? 'SELL' : null,
  ],

  // ✅ Nova regra EMA crossover 34x72:
  emaCrossover34x72: [
    (ctx) => {
      // BUY → cruzamento de alta
      const crossedUp = ctx.emaFastPrev < ctx.emaSlowPrev && ctx.emaFast > ctx.emaSlow;

      if (crossedUp) {
        return 'BUY';
      }

      return null;
    },
    (ctx) => {
      // SELL → cruzamento de baixa
      const crossedDown = ctx.emaFastPrev > ctx.emaSlowPrev && ctx.emaFast < ctx.emaSlow;

      if (crossedDown) {
        return 'SELL';
      }

      return null;
    }
  ],
};

function determineAction(rule: TradingRule, context: Context): Action {
  const rules = ruleSets[rule];

  if (!rules) {
    throw new Error(`Regra "${rule}" não encontrada`);
  }

  for (const ruleFn of rules) {
    const result = ruleFn(context);
    if (result !== null) {
      return result;
    }
  }

  return 'HOLD';
}

export { ruleSets, determineAction, Context, Action };
