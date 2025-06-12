export interface TradeDetail {
  side?: 'LONG' | 'SHORT';
  entryTime?: number;
  entryDate?: string;
  entryPrice?: number;
  entryRsi?: number;
  entryLsRatio?: number;
  entryOi?: number;
  exitTime?: number;
  exitDate?: string;
  exitPrice?: number;
  exitRsi?: number;
  exitLsRatio?: number;
  exitOi?: number;
  symbol?: string;
  margin?: number;
  pnl?: number;
  pnlPercent?: number;
}