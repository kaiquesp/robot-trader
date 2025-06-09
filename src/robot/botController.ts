// src/robot/botController.ts

import { IndicatorService } from "../services/indicatorsService";
import { OrderService } from "../services/orderService";
import { OpenPosition, PositionService } from "../services/positionService";
import { PositionManager } from "./positionManager";


export class BotController {
  constructor(
    private positionService: PositionService,
    private indicatorService: IndicatorService,
    private orderService: OrderService,
    private positionManager: PositionManager
  ) {}

  async run() {
    // 1) busca posições abertas
    const openPositions: OpenPosition[] = await this.positionService.getOpenPositions();

    // 2) percore símbolos que estão *ou não* em posição
    const symbols = await this.positionManager.getSymbols(); // se estiver em outro lugar
    for (const symbol of symbols) {
      // primeiro, se já tiver posição aberta, avalia se deve fechar
      const existing = openPositions.find(p => p.symbol === symbol);
      if (existing) {
        // decide pela regra de fechamento baseada em indicadores...
        const ind = await this.indicatorService.fetchIndicators(symbol);
        if (ind && this.positionManager.shouldClosePosition(existing, ind)) {
          await this.orderService.placeOrder(symbol, existing.side === 'BUY' ? 'SELL' : 'BUY');
          console.log(`⚠️ Fechando posição ${existing.side} em ${symbol}`);
        }
        continue;
      }

      // se não tiver, decide abertura
      const ind = await this.indicatorService.fetchIndicators(symbol);
      if (ind) {
        const action = this.positionManager.determineAction(symbol, ind);
        if (action) {
          await this.orderService.placeOrder(symbol, action);
          console.log(`✅ Abrindo ${action} em ${symbol}`);
        }
      }
    }
  }
}
