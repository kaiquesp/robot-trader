// src/robot/models/OpenOrder.ts

export interface OpenOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  qty: number;
  openTime: number;
}
