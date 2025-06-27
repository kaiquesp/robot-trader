import type { OpenPosition } from "../robot/positionManager";

export interface AccountBalance {
  totalWalletBalance: number;
  availableBalance: number;
  totalUnrealizedProfit: number;
}

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  // ... outros campos, se desejar
}

export interface Order {
  symbol: string;
  orderId: number;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  type: string;
  side: "BUY" | "SELL";
  // ... outros campos conforme necessário
}

/**
 * Adapter de serviços de ordem para permitir múltiplas implementações (Binance, mock, etc)
 */
export interface OrderServiceAdapter {
  /** Busca os klines/histórico para o símbolo */
  getKlines(symbol: string): Promise<Kline[]>;

  /** Inicializa todos os websockets necessários para os símbolos */
  initializeWebSockets(symbols: string[]): Promise<void>;

  /** Abre ordem de mercado */
  placeOrder(symbol: string, side: "BUY" | "SELL"): Promise<void>;

  /** Fecha posição (reduceOnly) */
  placeCloseOrder(symbol: string, side: "BUY" | "SELL", qty: string): Promise<void>;

  /** Abre ordem bracket (TP/SL automáticos) */
  placeBracketOrder(symbol: string, side: "BUY" | "SELL", tpPrice: number, slPrice: number): Promise<void>;

  /** Abre bracket order, com até 3 tentativas */
  placeBracketOrderWithRetries(symbol: string, side: "BUY" | "SELL", tpPrice: number, slPrice: number): Promise<void>;

  /** Cancela todas as ordens abertas de um símbolo */
  cancelOpenOrders(symbol: string): Promise<void>;

  /** Retorna o saldo da conta */
  getAccountBalance(): Promise<AccountBalance>;

  /** Retorna posições abertas */
  getOpenPositions(): Promise<OpenPosition[]>;

  /** Retorna ordens abertas (de um símbolo, ou de todos se símbolo omitido) */
  getAllOpenOrders(symbol?: string): Promise<Order[]>;

  /** Retorna PnL realizado desde o timestamp */
  getRealizedPnl(sinceTs: number): Promise<number>;

  /** Cleanup de conexões/caches */
  cleanup(): Promise<void>;

  /** Preço atual do ticker do cache (ou 0 se não encontrado) */
  getCurrentPrice(symbol: string): number;
}
