// src/robot/runTradingBot.ts

import { IndicatorService } from "../services/indicatorsService";
import { OrderService } from "../services/orderService";
import { PositionService as LivePositionService } from "../services/positionService";
import { BotController } from "./botController";
import { PositionManager } from "./positionManager";

const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

/**
 * Executa o bot em ambiente live, adaptando serviços para BotController.
 */
export async function runTradingBot() {
  const tradeAmount = 15;
  const rawIndicator = new IndicatorService();
  const rawOrder     = new OrderService(tradeAmount);
  const rawPosition  = new LivePositionService(
    BASE_URL,
    process.env.BINANCE_API_KEY!,
    process.env.BINANCE_API_SECRET!
  );
  const positionManager = new PositionManager();

  // Adapter: indicador
  const indicatorService = {
    fetchIndicators: async (symbol: string) => {
      const result = await rawIndicator.fetchIndicators(symbol);
      if (result === null) {
        throw new Error(`No indicators found for symbol: ${symbol}`);
      }
      return result;
    },
    // live não usa setCurrentTime, mas BotController aceita opcional
    setCurrentTime: (ts: number) => {}
  };

  // Adapter: posição
  const positionService = {
    getOpenPositions: () => rawPosition.getOpenPositions()
  };

  // Adapter: ordens
  const orderService = {
    placeOrder: (symbol: string, side: 'BUY' | 'SELL') => rawOrder.placeOrder(symbol, side),
    getOpenPositions: () => rawPosition.getOpenPositions()
  };

  // Verifica credenciais
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be defined");
  }

  // Cria controller desacoplado
  const botController = new BotController(
    positionService,
    indicatorService,
    orderService,
    positionManager
  );

  // Loop principal sem memory leak
  async function tradingLoop() {
    while (true) {
      try {
        await botController.run();
      } catch (err) {
        console.error("Erro no bot:", err);
      }
      await new Promise(res => setTimeout(res, 5 * 60 * 1000));
    }
  }

  // Inicia o loop principal
  tradingLoop();
}