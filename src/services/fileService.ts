import fs from 'fs';

export class FileService {
  private tradesPath = './data/trades.json';
  private openOrdersPath = './data/openOrders.json';
  private logPath = './data/trade-events-log.json';

  constructor() {
    const dataDir = './data';
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  readTrades() {
    if (fs.existsSync(this.tradesPath)) {
      const data = fs.readFileSync(this.tradesPath, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  }

  saveTrades(trades: any) {
    fs.writeFileSync(this.tradesPath, JSON.stringify(trades, null, 2), 'utf-8');
  }

  readOpenOrders() {
    if (fs.existsSync(this.openOrdersPath)) {
      const data = fs.readFileSync(this.openOrdersPath, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  }

  saveOpenOrders(openOrders: any) {
    fs.writeFileSync(this.openOrdersPath, JSON.stringify(openOrders, null, 2), 'utf-8');
  }

  readTradeEvents() {
    if (fs.existsSync(this.logPath)) {
      const data = fs.readFileSync(this.logPath, 'utf-8');
      return JSON.parse(data);
    }
    return [];
  }

  saveTradeEvent(entry: {
    type: 'TP_EXECUTED' | 'SL_EXECUTED' | 'ORDER_CANCELED';
    symbol: string;
    side?: 'BUY' | 'SELL';
    pnl?: number;
    pnlDollar?: number;
    price?: number;
    date: string;
  }) {
    const logs = this.readTradeEvents();
    logs.push(entry);
    fs.writeFileSync(this.logPath, JSON.stringify(logs, null, 2), 'utf-8');
  }
}

export const fileService = new FileService();