// src/global.d.ts

declare module '@binance/futures-connector' {
  // Parâmetros aceitos pelo método newOrder
  interface NewOrderParams {
    quantity?: string;
    price?: string;           // opcional
    stopPrice?: string;       // opcional
    timeInForce?: string;
    reduceOnly?: boolean;
    priceProtect?: boolean;   // opcional agora
    timestamp: number;
    recvWindow?: number;
    closePosition?: boolean; // para ordens de fechamento
  }

  // Parâmetros para cancelar todas as ordens abertas
  interface CancelAllParams {
    symbol: string;
  }

  // Parâmetros de filtro para getOpenOrders (se quiser filtrar por símbolo)
  interface GetOpenOrdersParams {
    symbol?: string;
  }

  export class UMFutures {
    /**
     * Construtor padrão. Você passa API Key, Secret e um objeto de opções.
     * @param apiKey    - sua chave (string)
     * @param apiSecret - seu segredo (string)
     * @param opts      - { baseURL: string; recvWindow: number }
     */
    constructor(
      apiKey: string,
      apiSecret: string,
      opts: { baseURL: string; recvWindow: number }
    );

    /**
     * Abre uma nova ordem (market ou limit) no Binance Futures.
     * @param symbol - o par, ex: "BTCUSDT"
     * @param side   - "BUY" ou "SELL"
     * @param type   - "MARKET" ou "LIMIT"
     * @param params - parâmetros detalhados (quantidade, preço, reduceOnly etc)
     */
    newOrder(
      symbol: string,
      side: 'BUY' | 'SELL',
      type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET',
      params: NewOrderParams
    ): Promise<any>;

    /**
     * Retorna todas as ordens abertas na conta. 
     * Se passar { symbol: 'BTCUSDT' }, retorna só as abertas nesse símbolo.
     * Se passar objeto vazio ou nada, traz **todas** as ordens abertas.
     *
     * @param params - opcional, ex: { symbol: 'ETHUSDT' }
     */
    getOpenOrders(params?: GetOpenOrdersParams): Promise<any>;

    getOpenPositions(): Promise<OpenPosition[]>

    /** Cancela todas as ordens abertas (pode filtrar por symbol) */
    cancelAllOpenOrders(params?: OrderFilterParams): Promise<any>;

    /** (opcional) Se você precisar de cancelOrder individual */
    cancelOrder(
      symbol: string,
      orderId: string,
      params?: { timestamp: number; recvWindow?: number }
    ): Promise<any>;

    cancelAllOpenOrders(symbol: string): Promise<any>;

    getAccountInformation(): Promise<any>;
  }
}