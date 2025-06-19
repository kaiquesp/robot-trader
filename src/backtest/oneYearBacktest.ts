import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  fetchAllSymbols,
  fetchAllKlines,
  Candle
} from '../services/binanceService';
import {
  calculateEMA,
  calculateATR
} from '../utils/indicators';
import { TradeDetail } from '../models/tradeDetail';

EventEmitter.defaultMaxListeners = 20;

const TP_ATR_MULT = parseFloat(process.env.TP_ATR_MULT || '1.5');

interface BacktestResult {
  timeframe: string;
  startDate: string;
  endDate: string;
  totalTrades: number;
  wins: number;
  losses: number;
  profit: number;
  maxDrawdown: number;
  trades: TradeDetail[];
}

export class OneYearBacktest {
  private logPath: string;

  constructor() {
    const dataDir = path.join(__dirname, '..', '..', 'data');
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
    this.logPath = path.join(dataDir, 'logs', 'backtest.log');
  }

  public async run(): Promise<void> {
    const SINGLE = process.env.SINGLE_TIMEFRAME || '1h';
    const frames = SINGLE
      ? [SINGLE]
      : (process.env.TIMEFRAMES || '5m,15m,1h,4h,1d').split(',');

    const aggregated: BacktestResult[] = [];
    for (const tf of frames) {
      console.log(`\n🚀 Iniciando backtest para timeframe ${tf}`);
      const start = Date.now();
      const res = await this.runBacktestFor(tf);
      const took = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`\n✅ Concluído ${tf} em ${took}s`);
      console.log(`🔢 Trades: ${res.totalTrades} | ✅ ${res.wins} | ❌ ${res.losses} | 💰 $${res.profit.toFixed(2)}\n`);

      this.saveDetailedJson(res);
      this.saveMdSummary(res);
      aggregated.push(res);
    }

    this.saveAggregatedResults(aggregated);
    console.log('🏁 Todos os timeframes processados. Saindo.');
  }

  public async runBacktestFor(timeframe: string): Promise<BacktestResult> {
    const NUM_SYMBOLS = parseInt(process.env.NUM_SYMBOLS || '15', 10);
    const LEVERAGE = Number(process.env.LEVERAGE || '20');
    const ENTRY_AMOUNT = Number(process.env.ENTRY_AMOUNT || '200');

    let balance = 1000;
    const endTs = Date.now();
    const startTs = endTs - 90 * 24 * 3600 * 1000;
    const lookback = 200;

    const symbols = (await fetchAllSymbols()).map(s => s.symbol).slice(0, NUM_SYMBOLS);
    const tradesAll: TradeDetail[] = [];

    const BATCH_SIZE = 3;
    for (let j = 0; j < symbols.length; j += BATCH_SIZE) {
      const batch = symbols.slice(j, j + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(sym =>
          fetchAllKlines(sym, timeframe, startTs, endTs)
            .then(candles => ({ symbol: sym, candles }))
            .catch(() => ({ symbol: sym, candles: [] as Candle[] }))
        )
      );

      for (const { symbol, candles } of results) {
        console.log(`\n🕵️ Testando ${symbol} em ${timeframe}`);
        if (candles.length < lookback) {
          console.log(`⚠️  Candles insuficientes: ${candles.length} < ${lookback}`);
          continue;
        }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const opens = candles.map(c => c.open);
        const volumes = candles.map(c => c.volume);

        const ema21 = calculateEMA(closes, 21);
        const ema100 = calculateEMA(closes, 100);
        const ema200 = calculateEMA(closes, 200);

        const atrArr: number[] = [];
        for (let i = 21; i < closes.length; i++) {
          atrArr[i] = calculateATR(
            highs.slice(i - 14, i),
            lows.slice(i - 14, i),
            closes.slice(i - 14, i)
          );
        }

        const state = {
          position: 'FLAT' as 'FLAT' | 'LONG' | 'SHORT',
          entryPrice: 0,
          entryTime: 0,
          takeProfit: 0
        };

        for (let i = lookback; i < candles.length; i++) {
          const price = closes[i];
          const time = candles[i].openTime;

          const candleBody = Math.abs(closes[i] - opens[i]);
          const candleRange = highs[i] - lows[i];
          const isBullish = closes[i] > opens[i];
          const isBearish = closes[i] < opens[i];
          const rejection = candleBody / candleRange < 0.4;

          const start = Math.max(0, i - 20);
          const volumeAvg = volumes.slice(start, i).reduce((a, b) => a + b, 0) / (i - start);
          const highVolume = volumes[i] > volumeAvg * 1.2;

          const trendUp = ema100[i] > ema200[i];
          const trendDown = ema100[i] < ema200[i];

          if (state.position === 'FLAT') {
            if (trendUp && lows[i] < ema21[i] && isBullish && rejection && highVolume) {
              state.position = 'LONG';
              state.entryPrice = price;
              state.entryTime = time;
              state.takeProfit = price + atrArr[i] * TP_ATR_MULT;
              console.log(`🔄 [${symbol}] Entrada LONG @ ${new Date(time).toISOString()}`);
              continue;
            }

            if (trendDown && highs[i] > ema21[i] && isBearish && rejection && highVolume) {
              state.position = 'SHORT';
              state.entryPrice = price;
              state.entryTime = time;
              state.takeProfit = price - atrArr[i] * TP_ATR_MULT;
              console.log(`🔄 [${symbol}] Entrada SHORT @ ${new Date(time).toISOString()}`);
              continue;
            }
          }

          if (state.position === 'LONG' && (ema100[i] < ema200[i] || price >= state.takeProfit)) {
            const pnl = (price - state.entryPrice) / state.entryPrice * ENTRY_AMOUNT * LEVERAGE;
            balance += pnl;
            tradesAll.push({
              side: 'LONG',
              symbol,
              entryTime: state.entryTime,
              exitTime: time,
              entryPrice: state.entryPrice,
              exitPrice: price,
              pnl,
              entryDate: new Date(state.entryTime).toISOString(),
              exitDate: new Date(time).toISOString()
            });
            state.position = 'FLAT';
            continue;
          }

          if (state.position === 'SHORT' && (ema100[i] > ema200[i] || price <= state.takeProfit)) {
            const pnl = (state.entryPrice - price) / state.entryPrice * ENTRY_AMOUNT * LEVERAGE;
            balance += pnl;
            tradesAll.push({
              side: 'SHORT',
              symbol,
              entryTime: state.entryTime,
              exitTime: time,
              entryPrice: state.entryPrice,
              exitPrice: price,
              pnl,
              entryDate: new Date(state.entryTime).toISOString(),
              exitDate: new Date(time).toISOString()
            });
            state.position = 'FLAT';
            continue;
          }
        }
      }
    }

    const totalTrades = tradesAll.length;
    const wins = tradesAll.filter(t => (t.pnl ?? 0) > 0).length;
    const losses = totalTrades - wins;
    const profit = tradesAll.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    return {
      timeframe,
      startDate: new Date(startTs).toISOString().split('T')[0],
      endDate: new Date(endTs).toISOString().split('T')[0],
      totalTrades,
      wins,
      losses,
      profit,
      maxDrawdown: 0,
      trades: tradesAll
    };
  }

  private saveDetailedJson(res: BacktestResult): void {
    const file = path.join(__dirname, '..', '..', 'data', 'json',
      `detailed-backtest-results-${res.endDate}.json`
    );
    fs.writeFileSync(file, JSON.stringify(res, null, 2));
  }

  private saveMdSummary(res: BacktestResult): void {
    const file = path.join(__dirname, '..', '..', 'data', 'md',
      `backtest-summary-${res.endDate}.md`
    );
    fs.writeFileSync(file, JSON.stringify(res, null, 2));
  }

  private saveAggregatedResults(all: BacktestResult[]): void {
    const file = path.join(__dirname, '..', '..', 'data',
      'detailed-backtest-results.json'
    );
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
  }
}

(async () => {
  const backtester = new OneYearBacktest();
  await backtester.run();
})();
