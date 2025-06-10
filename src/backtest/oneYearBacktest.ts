// src/backtest/oneYearBacktest.ts

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { fetchAllSymbols, fetchAllKlines, Candle, fetchLongShortRatio, fetchOpenInterest } from '../services/binanceService';
import { calculateRSI } from '../utils/indicators';

// Aumenta limite de listeners para evitar warnings
EventEmitter.defaultMaxListeners = 20;

// Detalhes de cada trade
interface TradeDetail {
  side: 'LONG' | 'SHORT';
  entryTime: number;
  entryDate: string;
  entryPrice: number;
  entryRsi: number;
  entryLsRatio: number;
  entryOi: number;       // open interest no momento da entrada
  exitTime: number;
  exitDate: string;
  exitPrice: number;
  exitRsi: number;
  exitLsRatio: number;
  exitOi: number;        // open interest no momento da saída
  margin: number;
  pnl: number;
  pnlPercent: number;
}

async function runBacktest() {
  const NUM_SYMBOLS  = parseInt(process.env.NUM_SYMBOLS || '1', 10);
  const LEVERAGE     = Number(process.env.LEVERAGE    || '20');
  const ENTRY_AMOUNT = Number(process.env.ENTRY_AMOUNT || '200');
  const endTs        = Date.now();
  const startTs      = endTs - 2 * 24 * 60 * 60 * 1000;

  const allInfo = await fetchAllSymbols().catch(() => []);
  const symbols = allInfo.map(s => s.symbol).slice(0, NUM_SYMBOLS);

  const results: { symbol: string; finalBalance: number; trades: TradeDetail[] }[] = [];

  for (const symbol of ['AXSUSDT']) {
    console.log(`🔄 Backtest para ${symbol}`);
    let candles: Candle[];
    try {
      candles = await fetchAllKlines(symbol, '5m', startTs, endTs);
    } catch {
      console.warn(`⚠️ Falha ao carregar candles de ${symbol}`);
      continue;
    }

    const closesAll = candles.map(c => c.close);
    const oiAll: number[] = [];

    let balance     = 1000;
    let position: 'FLAT' | 'LONG' | 'SHORT' = 'FLAT';
    let entryPrice = 0, entryRsi = 0, entryLsRatio = 0, entryOi = 0;
    const tradeDetails: TradeDetail[] = [];

    for (let i = 20; i < candles.length; i++) {
      const slice = closesAll.slice(i - 20, i);
      const rsi   = calculateRSI(slice);
      const lsRatio = await fetchLongShortRatio(symbol, candles[i].openTime).catch(() => 0);
      const oi    = await fetchOpenInterest(symbol, candles[i].openTime).catch(() => 0);
      oiAll.push(oi);
      const price = candles[i].close;

      // calcula open interest médio dos últimos 20 candles
      const avgOi = oiAll.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;

      // abre LONG se confirma LSR e OI
      if (position === 'FLAT' && lsRatio <= 1 && rsi > 30 && oi >= avgOi) {
        entryPrice   = price;
        entryRsi     = rsi;
        entryLsRatio = lsRatio;
        entryOi      = oi;
        position     = 'LONG';
        continue;
      }

      // fecha LONG
      if (position === 'LONG' && (rsi > 70 || price < entryPrice * 0.98)) {
        const exitPrice   = price;
        const exitRsi     = rsi;
        const exitLsRatio = lsRatio;
        const exitOi      = oi;
        const exitTime    = candles[i].openTime;
        const entryTime   = candles[i - 1].openTime;

        const capitalBefore = balance;
        const margin        = ENTRY_AMOUNT > 0
          ? Math.min(capitalBefore, ENTRY_AMOUNT)
          : capitalBefore / LEVERAGE;
        const profit        = (exitPrice - entryPrice) / entryPrice * margin * LEVERAGE;
        const profitPercent = profit / capitalBefore * 100;
        balance = capitalBefore + profit;

        tradeDetails.push({
          side: 'LONG',
          entryTime,
          entryDate: new Date(entryTime).toISOString(),
          entryPrice,
          entryRsi,
          entryLsRatio,
          entryOi,
          exitTime,
          exitDate: new Date(exitTime).toISOString(),
          exitPrice,
          exitRsi,
          exitLsRatio,
          exitOi,
          margin,
          pnl: profit,
          pnlPercent: profitPercent
        });

        position = 'FLAT';
        continue;
      }

      // abre SHORT se confirma LSR e OI
      if (position === 'FLAT' && lsRatio > 1 && rsi < 70 && oi >= avgOi) {
        entryPrice   = price;
        entryRsi     = rsi;
        entryLsRatio = lsRatio;
        entryOi      = oi;
        position     = 'SHORT';
        continue;
      }

      // fecha SHORT
      if (position === 'SHORT' && (rsi < 30 || price > entryPrice * 1.02)) {
        const exitPrice   = price;
        const exitRsi     = rsi;
        const exitLsRatio = lsRatio;
        const exitOi      = oi;
        const exitTime    = candles[i].openTime;
        const entryTime   = candles[i - 1].openTime;

        const capitalBefore = balance;
        const margin        = ENTRY_AMOUNT > 0
          ? Math.min(capitalBefore, ENTRY_AMOUNT)
          : capitalBefore / LEVERAGE;
        const profit        = (entryPrice - exitPrice) / entryPrice * margin * LEVERAGE;
        const profitPercent = profit / capitalBefore * 100;
        balance = capitalBefore + profit;

        tradeDetails.push({
          side: 'SHORT',
          entryTime,
          entryDate: new Date(entryTime).toISOString(),
          entryPrice,
          entryRsi,
          entryLsRatio,
          entryOi,
          exitTime,
          exitDate: new Date(exitTime).toISOString(),
          exitPrice,
          exitRsi,
          exitLsRatio,
          exitOi,
          margin,
          pnl: profit,
          pnlPercent: profitPercent
        });

        position = 'FLAT';
      }
    }

    results.push({ symbol, finalBalance: balance, trades: tradeDetails });
    console.log(`✅ ${symbol}: ${tradeDetails.length} trades, saldo final ${balance.toFixed(2)}`);
  }

  // salvar resultados com timestamp
  const runDate = new Date().toISOString().split('T')[0];
  const baseData = path.join(__dirname, '..', '..', 'data');
  const jsonName = `detailed-backtest-results-${runDate}.json`;
  const jsonDir = path.join(baseData, 'json');
  const jsonPath = path.join(jsonDir, jsonName);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  const mdName = `backtest-summary-${runDate}.md`;
  const mdDir   = path.join(baseData, 'md');
  const mdPath = path.join(mdDir, mdName);
  const header = '| Symbol | Trades | Wins | Losses | Win Rate (%) | Total PnL | Avg PnL | Max Profit | Max Loss |';
  const separator = '|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  const rowsMd = results.map(res => {
    const count = res.trades.length;
    const wins = res.trades.filter(t => t.pnl > 0).length;
    const losses = count - wins;
    const winRate = count ? (wins / count * 100).toFixed(2) : '0.00';
    const totalPnl = res.trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2);
    const avgPnl = count ? (res.trades.reduce((sum, t) => sum + t.pnl, 0) / count).toFixed(2) : '0.00';
    const maxProf = count ? Math.max(...res.trades.map(t => t.pnl)).toFixed(2) : '0.00';
    const maxLoss = count ? Math.min(...res.trades.map(t => t.pnl)).toFixed(2) : '0.00';
    return `| ${res.symbol} | ${count} | ${wins} | ${losses} | ${winRate} | ${totalPnl} | ${avgPnl} | ${maxProf} | ${maxLoss} |`;
  });
  const mdContent = ['## Backtest Summary', '', header, separator, ...rowsMd].join('\n');
  fs.writeFileSync(mdPath, mdContent);

  console.log(`🎉 Backtest concluído!\n- JSON: ${jsonPath}\n- MD: ${mdPath}`);
}

runBacktest().catch(err => {
  console.error('❌ Erro no backtest:', err);
  process.exit(1);
});
