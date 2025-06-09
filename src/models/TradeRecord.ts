// src/robot/models/TradeRecord.ts

export interface TradeRecord {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  openTime: number;
  closeTime: number;
}
