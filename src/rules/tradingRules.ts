// src/rules/tradingRules.ts

import { TradingRule } from "../enum/tradingRule";

/**
 * Tipo para ações possíveis de negociação.
 */
type Action = 'BUY' | 'SELL' | 'HOLD';

/**
 * Contexto: todos os indicadores e valores do candle/símbolo para tomada de decisão.
 */
type Context = {
  symbol: string;
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

/**
 * Parametrização dos thresholds para facilitar ajustes finos em tempo de execução.
 */
const THRESHOLDS = {
  emaCrossover: 0.5,           // distância % máxima para considerar suporte/resistência "perto"
  minEmaDeltaPct: 0.1,       // distância mínima % entre EMAs após cruzamento
  volume: 1_000_000,         // volume mínimo para considerar entrada por volume
  lsrBuy: 1.5,
  lsrSell: 2,
  supportDelta: 0.01         // % para checar proximidade do suporte/resistência
};

/**
 * Helpers para simplificar lógica de cruzamento de EMAs.
 */
function isEmaCrossUp(ctx: Context) {
  return ctx.emaFast > ctx.emaSlow && ctx.emaFastPrev <= ctx.emaSlowPrev;
}
function isEmaCrossDown(ctx: Context) {
  return ctx.emaFast < ctx.emaSlow && ctx.emaFastPrev >= ctx.emaSlowPrev;
}
function emaDeltaPct(ctx: Context) {
  return Math.abs(ctx.emaFast - ctx.emaSlow) / ctx.price * 100;
}

/**
 * Regras modulares agrupadas por estratégia/indicador.
 * Adicione comentários para documentar cada regra e seu racional.
 */
const ruleSets: Record<TradingRule, ((context: Context) => Action | null)[]> = {
  /**
   * EMA crossover 34x72:
   * - Compra quando EMAs cruzam para cima, tendência de alta e próximo ao suporte.
   * - Venda quando EMAs cruzam para baixo, tendência de baixa e próximo à resistência.
   */
  [TradingRule.emaCrossover34x72]: [
  (ctx) => {
    const crossedUp = isEmaCrossUp(ctx);
    const distanceToSupportPct = ((ctx.price - ctx.support) / ctx.price) * 100;
    const deltaPct = emaDeltaPct(ctx);

    if (
      crossedUp &&
      ctx.trend === 'UP' &&
      distanceToSupportPct <= THRESHOLDS.emaCrossover &&
      deltaPct >= THRESHOLDS.minEmaDeltaPct
    ) {
      console.log(
        `📈 [${ctx.symbol}] BUY signal:
        • EMA Cross Up:        ${crossedUp}
        • Trend:               ${ctx.trend}
        • Price:               ${ctx.price}
        • Support:             ${ctx.support}
        • Distance to Support: ${distanceToSupportPct.toFixed(2)}%
        • EMA Delta:           ${deltaPct.toFixed(2)}%
        `
      );
      console.log('-------------------------------');
      return 'BUY';
    }

    console.log(
      `🟡 [${ctx.symbol}] No BUY:
      • EMA Cross Up:        ${crossedUp}
      • Trend:               ${ctx.trend}
      • Distance to Support: ${distanceToSupportPct.toFixed(2)}%
      • EMA Delta:           ${deltaPct.toFixed(2)}%
      `
    );
    console.log('-------------------------------');
    return null;
  },
  (ctx) => {
    const crossedDown = isEmaCrossDown(ctx);
    const distanceToResistancePct = ((ctx.resistance - ctx.price) / ctx.price) * 100;
    const deltaPct = emaDeltaPct(ctx);

    if (
      crossedDown &&
      ctx.trend === 'DOWN' &&
      distanceToResistancePct <= THRESHOLDS.emaCrossover &&
      deltaPct >= THRESHOLDS.minEmaDeltaPct
    ) {
      console.log(
        `📉 [${ctx.symbol}] SELL signal:
        • EMA Cross Down:         ${crossedDown}
        • Trend:                  ${ctx.trend}
        • Price:                  ${ctx.price}
        • Resistance:             ${ctx.resistance}
        • Distance to Resistance: ${distanceToResistancePct.toFixed(2)}%
        • EMA Delta:              ${deltaPct.toFixed(2)}%
        `
      );
      console.log('-------------------------------');
      return 'SELL';
    }

    console.log(
      `🟡 [${ctx.symbol}] No SELL:
      • EMA Cross Down:         ${crossedDown}
      • Trend:                  ${ctx.trend}
      • Distance to Resistance: ${distanceToResistancePct.toFixed(2)}%
      • EMA Delta:              ${deltaPct.toFixed(2)}%
      `
    );
    console.log('-------------------------------');
    return null;
  }
],

  /**
   * Estratégia básica RSI + MACD:
   * - Compra: RSI < 30 e MACD > 0
   * - Venda: RSI > 70 e MACD < 0
   */
  [TradingRule.basicRSIMACD]: [
    (ctx) => ctx.rsi < 30 && ctx.macd > 0 ? 'BUY' : null,
    (ctx) => ctx.rsi > 70 && ctx.macd < 0 ? 'SELL' : null,
  ],

  /**
   * Volume + tendência:
   * - Compra: tendência de alta e volume elevado.
   * - Venda: tendência de baixa e volume elevado.
   */
  [TradingRule.volumeTrend]: [
    (ctx) => ctx.trend === 'UP' && ctx.volume > THRESHOLDS.volume ? 'BUY' : null,
    (ctx) => ctx.trend === 'DOWN' && ctx.volume > THRESHOLDS.volume ? 'SELL' : null,
  ],

  /**
   * Long-short ratio e Open Interest:
   * - Compra: LSR < 1.5 e OI positivo
   * - Venda: LSR > 2 e OI negativo
   */
  [TradingRule.lsrOpenInterest]: [
    (ctx) => ctx.lsr < THRESHOLDS.lsrBuy && ctx.openInterest > 0 ? 'BUY' : null,
    (ctx) => ctx.lsr > THRESHOLDS.lsrSell && ctx.openInterest < 0 ? 'SELL' : null,
  ],

  /**
   * Suporte/Resistência + CVD:
   * - Compra: preço próximo ao suporte e CVD positivo
   * - Venda: preço próximo à resistência e CVD negativo
   */
  [TradingRule.supportResistanceCVD]: [
    (ctx) => ctx.price <= ctx.support * (1 + THRESHOLDS.supportDelta) && ctx.cvd > 0 ? 'BUY' : null,
    (ctx) => ctx.price >= ctx.resistance * (1 - THRESHOLDS.supportDelta) && ctx.cvd < 0 ? 'SELL' : null,
  ],

  [TradingRule.improvedRSIMACD]: [],
  [TradingRule.fundingRate]: [],
  [TradingRule.atrAdxStochastic]: [],
  [TradingRule.vwapObvCmf]: [],
};

/**
 * Retorna a primeira ação válida do rule set. (padrão: 'HOLD')
 */
function determineAction(ruleSetName: TradingRule, context: Context): Action {
  const rules = ruleSets[ruleSetName];
  if (!rules) throw new Error(`Regra "${ruleSetName}" não encontrada`);
  for (const rule of rules) {
    const result = rule(context);
    if (result !== null) return result;
  }
  return 'HOLD';
}

/**
 * (Opcional) Retorna todas as ações disparadas, útil para logs/analytics.
 */
function allTriggeredActions(ruleSetName: TradingRule, context: Context): Action[] {
  const rules = ruleSets[ruleSetName] || [];
  return rules.map(rule => rule(context)).filter(x => x !== null) as Action[];
}

export { ruleSets, determineAction, allTriggeredActions, Context, Action, THRESHOLDS };
