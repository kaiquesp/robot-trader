// src/index.ts
import 'dotenv/config';
import { syncTimeOffset } from './utils/timeOffset';
import { BotController } from './robot/botController';
import { PositionManager } from './robot/positionManager';
import { indicatorService } from './services/indicatorsService';
import { orderService } from './services/orderService';
import { fileService } from './services/fileService';

// instancia o positionManager
const positionManager = new PositionManager();

// adapter para o positionService (getOpenPositions)
const positionService = {
  getOpenPositions: () => orderService.getOpenPositions()
};

// adapter para o orderService — métodos que o BotController espera
const orderServiceAdapter = {
  placeOrder: orderService.placeOrder,
  placeBracketOrder: orderService.placeBracketOrder,
  placeBracketOrderWithRetries: orderService.placeBracketOrderWithRetries,
  cancelOpenOrders: orderService.cancelOpenOrders,
  getAccountBalance: orderService.getAccountBalance,
  getOpenPositions: orderService.getOpenPositions,
  getAllOpenOrders: orderService.getAllOpenOrders,
  getRealizedPnl: orderService.getRealizedPnl
};

// função principal
(async () => {
  console.log(`\n🤖 Bot iniciado. Executando a cada 15 minutos...`);

  // Garante que o clock está sincronizado
  await syncTimeOffset();

  // instancia o bot com os services necessários
  const bot = new BotController(
    positionService,
    indicatorService,
    orderServiceAdapter,
    positionManager,
    fileService
  );

  // executa a primeira vez
  await bot.run();

  // executa a cada 15 minutos
  setInterval(async () => {
    try {
      await syncTimeOffset();
      await bot.run();
    } catch (err: any) {
      console.error('❌ Erro no ciclo do bot:', err?.response?.data?.msg || err?.message || err);
    }
  }, 5 * 60 * 1000);
})();
