// src/backtest/oneYearBacktest.ts

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
  calculateATR,
  calculateRSI
} from '../utils/indicators';
import { TradeDetail } from '../models/tradeDetail';

EventEmitter.defaultMaxListeners = 20;

const RSI_LONG_MIN  = parseInt(process.env.RSI_LONG_MIN  || '40', 10);
const RSI_LONG_MAX  = parseInt(process.env.RSI_LONG_MAX  || '70', 10);
const RSI_SHORT_MIN = parseInt(process.env.RSI_SHORT_MIN || '30', 10);
const RSI_SHORT_MAX = parseInt(process.env.RSI_SHORT_MAX || '60', 10);
const TP_ATR_MULT   = parseFloat(process.env.TP_ATR_MULT || '1.5');

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
    const SINGLE = process.env.SINGLE_TIMEFRAME || '15m';
    const frames = SINGLE
      ? [SINGLE]
      : (process.env.TIMEFRAMES || '5m,15m,1h,4h,1d').split(',');

    const aggregated: BacktestResult[] = [];
    for (const tf of frames) {
      console.log(`\n🚀 Iniciando backtest para timeframe ${tf}`);
      const start = Date.now();
      const res   = await this.runBacktestFor(tf);
      const took  = ((Date.now() - start) / 1000).toFixed(1);
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
    const NUM_SYMBOLS  = parseInt(process.env.NUM_SYMBOLS   || '15', 10);
    const LEVERAGE     = Number(process.env.LEVERAGE        || '20');
    const ENTRY_AMOUNT = Number(process.env.ENTRY_AMOUNT    || '200');
    const RSI_PERIOD   = parseInt(process.env.RSI_PERIOD   || '14', 10);
    const EMA_SHORT    = parseInt(process.env.EMA_SHORT    || '34', 10);
    const EMA_LONG     = parseInt(process.env.EMA_LONG     || '72', 10);

    let balance = 1000;
    const endTs   = Date.now();
    const startTs = endTs - 90 * 24 * 3600 * 1000;
    const lookback = Math.max(EMA_LONG, RSI_PERIOD + 1);

    const symbols = (await fetchAllSymbols()).map(s => s.symbol).slice(0, NUM_SYMBOLS);
    const tradesAll: TradeDetail[] = [];

    // processa em lotes de 3 símbolos para paralelismo simples
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
        const highs  = candles.map(c => c.high);
        const lows   = candles.map(c => c.low);

        // pré-cálculo de indicadores
        const emaShort = calculateEMA(closes, EMA_SHORT);
        const emaLong  = calculateEMA(closes, EMA_LONG);

        const atrArr: number[] = [];
        for (let i = RSI_PERIOD; i < closes.length; i++) {
          atrArr[i] = calculateATR(
            highs.slice(i - RSI_PERIOD, i),
            lows.slice(i - RSI_PERIOD, i),
            closes.slice(i - RSI_PERIOD, i)
          );
        }

        const rsiArr: number[] = [];
        for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
          rsiArr[i] = calculateRSI(closes.slice(i - RSI_PERIOD - 1, i), RSI_PERIOD);
        }

        const state = {
          position: 'FLAT' as 'FLAT' | 'LONG' | 'SHORT',
          entryPrice: 0,
          entryTime: 0,
          takeProfit: 0
        };

        for (let i = lookback; i < candles.length; i++) {
          const price = closes[i];
          const time  = candles[i].openTime;
          const prevS = emaShort[i - 1], prevL = emaLong[i - 1];
          const currS = emaShort[i],     currL = emaLong[i];
          const atr   = atrArr[i] || 0;
          const rsi   = rsiArr[i] || 0;

          // EMA crossover + filtro RSI
          if (state.position === 'FLAT' && currS > currL && prevS <= prevL && rsi > 50) {
            state.position   = 'LONG';
            state.entryPrice = price;
            state.entryTime  = time;
            state.takeProfit = price + atr * TP_ATR_MULT;
            const log = `🔄 [${symbol}] Entrada LONG @ ${new Date(time).toISOString()} (RSI=${rsi.toFixed(1)})`;
            console.log(log);
            fs.appendFileSync(this.logPath, log + '\n');
            continue;
          }
          if (state.position === 'FLAT' && currS < currL && prevS >= prevL && rsi < 50) {
            state.position   = 'SHORT';
            state.entryPrice = price;
            state.entryTime  = time;
            state.takeProfit = price - atr * TP_ATR_MULT;
            const log = `🔄 [${symbol}] Entrada SHORT @ ${new Date(time).toISOString()} (RSI=${rsi.toFixed(1)})`;
            console.log(log);
            fs.appendFileSync(this.logPath, log + '\n');
            continue;
          }

          // saída ou TP LONG
          if (state.position === 'LONG' && (currS < currL || price >= state.takeProfit)) {
            const pnl = (price - state.entryPrice) / state.entryPrice * ENTRY_AMOUNT * LEVERAGE;
            balance += pnl;
            const log = [
              `🔔 [${symbol}] Saída LONG @ ${new Date(time).toISOString()}`,
              `  • Entry: ${state.entryPrice.toFixed(2)} Exit: ${price.toFixed(2)}`,
              `  • PnL: ${pnl >= 0 ? '🟢 +' : '🔴 '}${pnl.toFixed(2)}`,
              `  • Balance: ${balance.toFixed(2)}`
            ].join('\n');
            console.log(log, '\n');
            fs.appendFileSync(this.logPath, log + '\n\n');
            tradesAll.push({
              side:       'LONG',
              symbol,
              entryTime:  state.entryTime,
              exitTime:   time,
              entryPrice: state.entryPrice,
              exitPrice:  price,
              pnl,
              entryDate:  new Date(state.entryTime).toISOString(),
              exitDate:   new Date(time).toISOString()
            });
            state.position = 'FLAT';
            continue;
          }

          // saída ou TP SHORT
          if (state.position === 'SHORT' && (currS > currL || price <= state.takeProfit)) {
            const pnl = (state.entryPrice - price) / state.entryPrice * ENTRY_AMOUNT * LEVERAGE;
            balance += pnl;
            const log = [
              `🔔 [${symbol}] Saída SHORT @ ${new Date(time).toISOString()}`,
              `  • Entry: ${state.entryPrice.toFixed(2)} Exit: ${price.toFixed(2)}`,
              `  • PnL: ${pnl >= 0 ? '🟢 +' : '🔴 '}${pnl.toFixed(2)}`,
              `  • Balance: ${balance.toFixed(2)}`
            ].join('\n');
            console.log(log, '\n');
            fs.appendFileSync(this.logPath, log + '\n\n');
            tradesAll.push({
              side:       'SHORT',
              symbol,
              entryTime:  state.entryTime,
              exitTime:   time,
              entryPrice: state.entryPrice,
              exitPrice:  price,
              pnl,
              entryDate:  new Date(state.entryTime).toISOString(),
              exitDate:   new Date(time).toISOString()
            });
            state.position = 'FLAT';
            continue;
          }

          // regras antigas stub
          console.log(
            `   → [${symbol}] progresso: trades=${tradesAll.filter(t => t.symbol === symbol).length}, balance=${balance.toFixed(2)}`
          );
        }
      }
    }

    // compila resultado
    const totalTrades = tradesAll.length;
    const wins        = tradesAll.filter(t => (t.pnl ?? 0) > 0).length;
    const losses      = totalTrades - wins;
    const profit      = tradesAll.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    return {
      timeframe,
      startDate: new Date(startTs).toISOString().split('T')[0],
      endDate:   new Date(endTs).toISOString().split('T')[0],
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
    const stats: Record<string,{trades:number;wins:number;losses:number}> = {};
    for (const t of res.trades) {
      const sym = t.symbol!;
      if (!stats[sym]) stats[sym] = { trades:0, wins:0, losses:0 };
      stats[sym].trades++;
      (t.pnl! > 0) ? stats[sym].wins++ : stats[sym].losses++;
    }
    const header = `# Backtest ${res.timeframe} (${res.endDate})\n\n`;
    const tableHeader = `| Ativo | Trades | Wins | Losses |\n|:-----:|:------:|:----:|:------:|\n`;
    const tableRows = Object.entries(stats)
      .map(([sym,st]) => `| ${sym} | ${st.trades} | ${st.wins} | ${st.losses} |`)
      .join('\n');
    const footer = `

**Resultado Geral**  
- Total Trades: **${res.totalTrades}**  
- Wins: **${res.wins}**  
- Losses: **${res.losses}**  
- Profit: **$${res.profit.toFixed(2)}**

**Parâmetros de Saída**  
- Stop Loss: ATR ×1  
- Take Profit: ATR ×${TP_ATR_MULT}
`;
    const md = header + tableHeader + tableRows + footer;
    const file = path.join(__dirname, '..', '..', 'data', 'md',
      `backtest-summary-${res.endDate}.md`
    );
    fs.writeFileSync(file, md);
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
