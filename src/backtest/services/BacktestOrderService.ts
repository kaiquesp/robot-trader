// src/backtest/services/BacktestOrderService.ts

import { InMemoryPositionService } from "./InMemoryPositionService";
import { Candle } from "../../services/binanceService";
import { OpenPosition } from "../../services/positionService";

/**
 * Registro de trade para relatório
 */
export interface TradeRecord {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  entryTime: number;
  exitTime?: number;
  profit?: number;
}

/**
 * OrderService para backtest: registra trades e atualiza saldo.
 * Não implementa OrderService original para evitar conflitos.
 */
export class BacktestOrderService {
  private trades: TradeRecord[] = [];
  private balance = 1000;

  constructor(
    private positionService: InMemoryPositionService,
    private candles: Candle[]
  ) {}

  /** Simula execução de ordem: abre/fecha posição e registra trade */
  async placeOrder(symbol: string, side: 'BUY' | 'SELL'): Promise<void> {
    const ts = this.positionService.getCurrentTime();
    const candle = this.candles.find(c => c.openTime === ts);
    if (!candle) return;
    const price = candle.close;

    const openPositions: OpenPosition[] = await this.positionService.getOpenPositions();
    const existing = openPositions.find(p => p.symbol === symbol);

    if (existing) {
      // fechamento
      const entryPrice = existing.entryPrice!;
      const entryTime  = existing.entryTime!;
      const profit = side === 'SELL'
        ? price - entryPrice
        : entryPrice - price;
      this.balance += profit;
      this.trades.push({ symbol, side, entryPrice, exitPrice: price, entryTime, exitTime: ts, profit });
      this.positionService.closePosition(symbol);
    } else {
      // abertura
      this.positionService.openPosition(symbol, side, price);
      this.trades.push({ symbol, side, entryPrice: price, entryTime: ts });
    }
  }

  getResults(): { trades: TradeRecord[]; finalBalance: number } {
    return { trades: this.trades, finalBalance: this.balance };
  }
}
