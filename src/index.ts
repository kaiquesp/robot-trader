// src/index.ts
import 'dotenv/config';
import { BotController } from './robot/botController';
import { PositionManager } from './robot/positionManager';

import { IndicatorService as RawIndicatorService } from './services/indicatorsService';
import { OrderService as RawOrderService }       from './services/orderService';
import { PositionService as RawPositionService } from './services/positionService';
import { OpenPosition }                          from './services/positionService';
import { Indicators } from './models/Indicators';

(async () => {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    throw new Error("❌ Defina BINANCE_API_KEY e BINANCE_API_SECRET no seu .env");
  }

  const BASE_URL = process.env.TESTNET === 'true'
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';

  // instâncias “reais”
  const rawIndicator = new RawIndicatorService();
  const rawOrder     = new RawOrderService(15); // 15 USDT por ordem
  const rawPosition  = new RawPositionService(
    BASE_URL,
    process.env.BINANCE_API_KEY!,
    process.env.BINANCE_API_SECRET!
  );
  const positionManager = new PositionManager();

  // adapter para IndicatorService — só fetchIndicators
  const indicatorService = {
  fetchIndicators: async (symbol: string): Promise<Indicators> => {
    const ind = await rawIndicator.fetchIndicators(symbol);
    if (ind == null) {
      // fallback: ou lança erro, ou retorna um objeto “neutro”
      // aqui usamos valores neutros para não travar o bot
      return { rsi: 50, lsr: 1, oi: 0 };
    }
    return ind;
  }
};

  // adapter para PositionService — só getOpenPositions
  const positionService = {
    getOpenPositions: (): Promise<OpenPosition[]> =>
      rawPosition.getOpenPositions()
  };

  // adapter para OrderService — só placeOrder
  const orderService = {
    placeOrder: (symbol: string, side: 'BUY' | 'SELL'): Promise<void> =>
      rawOrder.placeOrder(symbol, side)
  };

  const bot = new BotController(
    positionService,
    indicatorService,
    orderService,
    positionManager
  );

  console.log('🤖 Bot iniciado. Executando a cada 5 minutos…');
  setInterval(async () => {
    try {
      await bot.run();
    } catch (err) {
      console.error('❌ Erro no bot:', err);
    }
  }, 0.25 * 60 * 1000);
})();
