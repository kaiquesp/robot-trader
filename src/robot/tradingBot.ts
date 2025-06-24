// src/robot/runTradingBot.ts

import { FileService } from "../services/fileService";
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
 * Esta função executa UMA iteração do bot.
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
    setCurrentTime: (ts: number) => {}
  };

  // Adapter: posição
  const positionService = {
    getOpenPositions: () => rawPosition.getOpenPositions()
  };

  // Adapter: ordens
  const orderService = {
    placeOrder: (symbol: string, side: 'BUY' | 'SELL') => rawOrder.placeOrder(symbol, side),
    placeCloseOrder: (symbol: string, side: 'BUY' | 'SELL', qtd: string) => rawOrder.placeCloseOrder(symbol, side, qtd),
    placeBracketOrder: (symbol: string, side: 'BUY' | 'SELL', tpPrice: number, slPrice: number) => rawOrder.placeBracketOrder(symbol, side, tpPrice, slPrice),
    placeBracketOrderWithRetries: (symbol: string, side: 'BUY' | 'SELL', tpPrice: number, slPrice: number) => rawOrder.placeBracketOrderWithRetries(symbol, side, tpPrice, slPrice),
    cancelOpenOrders: (symbol: string) => rawOrder.cancelOpenOrders(symbol),
    getAccountBalance: () => rawOrder.getAccountBalance(),
    getOpenPositions: () => rawPosition.getOpenPositions(),
    getAllOpenOrders: (symbol?: string) => rawOrder.getAllOpenOrders(symbol),
    getRealizedPnl: (sinceTs: number) => rawOrder.getRealizedPnl(sinceTs),
    startPositionStream: () => rawOrder.startPositionStream(),
  };

  const fileService = new FileService();

  // Verifica credenciais
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("BINANCE_API_KEY and BINANCE_API_SECRET must be defined");
  }

  // Cria controller desacoplado
  const botController = new BotController(
    positionService,
    indicatorService,
    orderService,
    positionManager,
    fileService 
  );
  await botController.run();
}
