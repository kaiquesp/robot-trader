import fs from 'fs';

export class FileService {
  private tradesPath = './data/trades.json';
  private openOrdersPath = './data/openOrders.json';

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
}
