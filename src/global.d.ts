// src/global.d.ts

declare module '@binance/futures-connector' {
  // Parâmetros aceitos pelo método newOrder
  interface NewOrderParams {
    quantity: string;
    price?: string;
    timeInForce?: string;
    reduceOnly?: boolean;
    timestamp: number;
    recvWindow?: number;
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
      type: 'MARKET' | 'LIMIT',
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
  }
}