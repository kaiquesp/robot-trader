import 'dotenv/config';
import { BotController } from './robot/botController';
import { OpenPosition, PositionManager } from './robot/positionManager';
import { IndicatorService } from './services/indicatorsService';
import { OrderService } from './services/orderService';
import { PositionService } from './services/positionService';

(async () => {
  const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

  const pm  = new PositionManager();
  const is  = new IndicatorService();
  const os  = new OrderService(15); // 15 USDT por ordem
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be defined in environment variables.");
  }
  const ps  = new PositionService(
    BASE_URL,
    process.env.BINANCE_API_KEY,
    process.env.BINANCE_API_SECRET
  ); // 15 USDT por ordem
  const bot = new BotController(ps, is, os, pm);

  // Loop a cada 5 minutos
  setInterval(async () => {
    // busque posições abertas via API ou arquivo
    await bot.run();
  }, 5 * 60 * 1000);
})();
