import { Indicators } from "../models/Indicators";
import { OpenPosition } from "../services/positionService";
import { PositionManager } from "./positionManager";

/**
 * Controller do robô de trading, genérico para live e backtest.
 */
export class BotController {
  constructor(
    /**
     * Serviço de posições, precisa apenas de getOpenPositions().
     */
    private positionService: { getOpenPositions(): Promise<OpenPosition[]> },

    /**
     * Serviço de indicadores, precisa apenas de fetchIndicators().
     */
    private indicatorService: {
      fetchIndicators(symbol: string): Promise<Indicators>;
      setCurrentTime?(ts: number): void;
    },

    /**
     * Serviço de ordens, precisa apenas de placeOrder().
     */
    private orderService: {
      placeOrder(symbol: string, side: 'BUY' | 'SELL'): Promise<void>;
    },

    private positionManager: PositionManager
  ) {}

  async run() {
    // 1) busca posições abertas
    const openPositions: OpenPosition[] = await this.positionService.getOpenPositions();

    // 2) itera símbolos (live ou backtest)
    const symbols = await this.positionManager.getSymbols();
    for (const symbol of symbols) {
      const existing = openPositions.find(p => p.symbol === symbol);
      const ind = await this.indicatorService.fetchIndicators(symbol);

      if (!ind.closes) {
        console.warn(`Indicadores para ${symbol} não possuem 'closes', pulando...`);
        continue;
      }

      if (existing) {
        // regra de fechamento
        if (ind.closes) {
          // Type assertion is safe here because of the check above
          if (this.positionManager.shouldClosePosition(existing, ind as any)) {
            const side = existing.side === 'BUY' ? 'SELL' : 'BUY';
            await this.orderService.placeOrder(symbol, side);
            console.log(`⚠️ Fechando ${existing.side} em ${symbol}`);
          }
        }
      } else {
        // regra de abertura
        if (ind.closes) {
          const action = this.positionManager.determineAction(symbol, ind as any);
          if (action) {
            await this.orderService.placeOrder(symbol, action);
            console.log(`✅ Abrindo ${action} em ${symbol}`);
          }
        }
      }
    }
  }
}