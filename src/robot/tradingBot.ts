import { IndicatorService } from "../services/indicatorsService";
import { OrderService } from "../services/orderService";
import { PositionService } from "../services/positionService";
import { BotController } from "./botController";
import { PositionManager } from "./positionManager";

const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

// Executa o bot
export async function runTradingBot() {
  const tradeAmount = 15;
  const indicatorService = new IndicatorService();
  const orderService = new OrderService(tradeAmount);
  const positionManager = new PositionManager();
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be defined in environment variables.");
  }
  const positionService = new PositionService(
    BASE_URL,
    process.env.BINANCE_API_KEY,
    process.env.BINANCE_API_SECRET
  );
  const botController = new BotController(positionService, indicatorService, orderService, positionManager)

  // Loop do trading bot
 setInterval(async () => {
    await botController.run();
  }, 0.25 * 60 * 1000); // A cada 5 minutos
}