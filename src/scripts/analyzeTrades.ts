import { FileService } from '../services/fileService';

type Trade = {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  entryDate: string;
  exitDate: string;
};

type TradeWithPnL = Trade & { pnl: number };

function calculatePnL(entry: number, exit: number, side: 'BUY' | 'SELL') {
  return side === 'BUY'
    ? ((exit - entry) / entry) * 100
    : ((entry - exit) / entry) * 100;
}

function analyzeTrades(startDate?: string, endDate?: string) {
  const fileService = new FileService();
  const trades = fileService.readTrades();

interface FilteredTrade extends Trade {}

const filtered: FilteredTrade[] = trades.filter((t: Trade): t is FilteredTrade => {
    const entry: Date = new Date(t.entryDate);
    const startOk: boolean = startDate ? entry >= new Date(startDate) : true;
    const endOk: boolean = endDate ? entry <= new Date(endDate) : true;
    return startOk && endOk;
});

const results: TradeWithPnL[] = filtered.map((t: Trade): TradeWithPnL => {
    const pnl: number = calculatePnL(t.entryPrice, t.exitPrice, t.side);
    return { ...t, pnl };
});

  const total = results.length;
const wins = results.filter((r: TradeWithPnL) => r.pnl > 0).length;
  const losses = total - wins;
const totalPnL = results.reduce((acc: number, r: TradeWithPnL) => acc + r.pnl, 0);
  const avgPnL = totalPnL / total;

  console.table(results.map(r => ({
    Symbol: r.symbol,
    Side: r.side,
    Entry: r.entryPrice.toFixed(2),
    Exit: r.exitPrice.toFixed(2),
    PnL: `${r.pnl.toFixed(2)}%`,
    EntryDate: r.entryDate,
    ExitDate: r.exitDate
  })));

  console.log('\nResumo Geral:');
  console.log(`Total Trades: ${total}`);
  console.log(`Wins: ${wins}`);
  console.log(`Losses: ${losses}`);
  console.log(`Total PnL: ${totalPnL.toFixed(2)}%`);
  console.log(`Média PnL: ${avgPnL.toFixed(2)}%`);
}

analyzeTrades(); // ou analyzeTrades('2025-06-01', '2025-06-14');
