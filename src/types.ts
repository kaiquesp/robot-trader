import { TradeDetail } from "./models/tradeDetail";

declare module 'qrcode-terminal';

// ------------------------------
// types.ts
// ------------------------------

/**
 * Ao receber do WS combinado, montamos este objeto:
 */
export interface CombinedMessage {
  symbol: string;                // Ex: "BTCUSDT"
  BUYSELLRatio?: number;       // quando @BUYSELLRatio
  openInterest?: number;         // quando @openInterest
  kline5m?: {
    isFinal: boolean;            // true se fechamento de candle 5m
    close: string;               // preço de fechamento (string)
  };
}

/**
 * Armazena em memória, para cada símbolo, os indicadores mais recentes:
 */
export interface InMemoryIndicators {
  [symbol: string]: {
    lsr: number;                 // BUY-SELL Ratio atual
    oi: number;                  // Open Interest atual
    lastClose5m: number;         // Último close de candle 5m
    rsi: number;                 // RSI calculado para esses últimos valores
    funding?: number;            // Funding Rate mais recente (via REST)
    prev?: PreviousIndicators;   // valores “anteriores” (para comparação)
  };
}

/**
 * Guarda o snapshot ANTERIOR de cada indicador (para comparar subida/queda):
 */
export interface PreviousIndicators {
  lsr: number;
  oi: number;
  funding: number;
  rsi: number;
}

/**
 * Representa uma ordem aberta no nosso próprio controle:
 */
export interface OpenOrder {
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  qty: number;
  openTime: number;
}

/**
 * Guarda o histórico de uma trade (quando fechamos, registramos aqui):
 */
export interface TradeRecord {
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  openTime: number;
  closeTime: number;
}

/**
 * Estrutura retornada por fetchExchangeFilters()
 */
export interface ExchangeFilter {
  stepSize: number;
  minQty: number;
}

/**
 * Estrutura retornada por fetchPriceFilters()
 */
export interface PriceFilter {
  tickSize: number;
  minPrice: number;
}

export interface BacktestResult {
  startDate: string;
  endDate: string;
  totalTrades: number;
  wins: number;
  losses: number;
  profit: number;
  maxDrawdown: number;
  trades: TradeDetail[];
}

export {
  TradeDetail // quando @openInterest
};
