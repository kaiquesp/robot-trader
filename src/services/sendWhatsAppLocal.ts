// src/backtest/oneYearBacktest.ts

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  fetchAllSymbols,
  fetchAllKlines,
  Candle,
  fetchLongShortRatio,
  fetchOpenInterest,
  fetchFundingRate
} from '../services/binanceService';
import {
  calculateRSI,
  calculateMACD,
  calculateVWAP,
  calculateATR,
  calculateEMA
} from '../utils/indicators';
import { TradeDetail } from '../models/tradeDetail';
import { Client, LocalAuth, MessageSendOptions } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

// Evita warning de EventEmitter
EventEmitter.defaultMaxListeners = 20;

/**
 * Executa o backtest e retorna resultados detalhados e summary.
 */
async function runBacktest() {
  const NUM_SYMBOLS = parseInt(process.env.NUM_SYMBOLS || '5', 10);
  const LEVERAGE = Number(process.env.LEVERAGE || '20');
  const ENTRY_AMOUNT = Number(process.env.ENTRY_AMOUNT || '200');

  const endTs = Date.now();
  const startTs = endTs - 180 * 24 * 3600 * 1000; // últimos 15 dias

  // diretórios de saída
  const baseData = path.join(__dirname, '..', '..', 'data');
  const jsonDir = path.join(baseData, 'json');
  const mdDir = path.join(baseData, 'md');
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(mdDir, { recursive: true });

  // parâmetros de lookback
  const lbEMA = 200;
  const lbMACD = 26;
  const lbRSI = 14;
  const lbVWAP = 20;
  const startIndex = Math.max(lbEMA, lbMACD, lbRSI + 1, lbVWAP);

  // coleta símbolos
  const symbols = (await fetchAllSymbols().catch(() => [])).map(s => s.symbol).slice(0, NUM_SYMBOLS);
  const results: { symbol: string; finalBalance: number; trades: TradeDetail[] }[] = [];

  for (const symbol of symbols) {
    console.log(`🔄 Backtest para ${symbol}`);
    const candles = await fetchAllKlines(symbol, '4h', startTs, endTs).catch(() => []);
    if (candles.length < startIndex) continue;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const vols = candles.map(c => c.volume);
    const ema34 = calculateEMA(closes, 34);
    const ema72 = calculateEMA(closes, 72);

    let balance = 1000;
    let position: 'FLAT' | 'LONG' | 'SHORT' = 'FLAT';
    let entryPrice = 0, entryTime = 0, entryRsi = 0, entryLs = 0, entryOi = 0;
    const trades: TradeDetail[] = [];

    for (let i = startIndex; i < candles.length; i++) {
      const price = closes[i];
      const time = candles[i].openTime;
      const rsiWindow = closes.slice(i - (lbRSI + 1), i);
      const rsiArr = calculateRSI(rsiWindow, lbRSI);
      const rsi = Array.isArray(rsiArr) ? rsiArr[rsiArr.length - 1] : rsiArr;
      const { macd, signal } = calculateMACD(closes.slice(i - lbMACD, i));
      const vwap = calculateVWAP(highs.slice(i - lbVWAP, i), lows.slice(i - lbVWAP, i), closes.slice(i - lbVWAP, i), vols.slice(i - lbVWAP, i));
      const atr = calculateATR(highs.slice(i - lbRSI, i), lows.slice(i - lbRSI, i), closes.slice(i - lbRSI, i));
      const vol = vols[i];
      const avgVol = vols.slice(i - lbVWAP, i).reduce((sum, v) => sum + v, 0) / lbVWAP;
      const lsRatio = await fetchLongShortRatio(symbol, time).catch(() => 0);
      const oi = await fetchOpenInterest(symbol, time).catch(() => 0);
      const funding = (await fetchFundingRate(symbol).catch(() => null)) ?? 0;
      const uptrend = ema34[i] > ema72[i];

      // ENTRY LONG (RSI entre 40-70, funding <= 0)
      if (position === 'FLAT'
        && uptrend
        && rsi > 40 && rsi < 70
        && macd > signal
        && price > vwap
        && vol > avgVol
        && lsRatio <= 1 && oi > 0
        && funding <= 0
      ) {
        position = 'LONG';
        entryPrice = price;
        entryTime = time;
        entryRsi = rsi;
        entryLs = lsRatio;
        entryOi = oi;
        continue;
      }

      // STOP-LOSS e EXIT LONG
      const slLong = entryPrice - atr;
      if (position === 'LONG' && (price < slLong || macd < signal || rsi > 70)) {
        const exitPrice = price;
        const exitTime = time;
        const exitRsi = rsi;
        const exitLsRatio = lsRatio;
        const exitOi = oi;
        const capitalBefore = balance;
        const margin = ENTRY_AMOUNT > 0
          ? Math.min(capitalBefore, ENTRY_AMOUNT)
          : capitalBefore / LEVERAGE;
        const profit = (exitPrice - entryPrice) / entryPrice * margin * LEVERAGE;
        balance += profit;
        trades.push({
          side: 'LONG',
          entryTime, entryDate: new Date(entryTime).toISOString(),
          entryPrice, entryRsi, entryLsRatio: entryLs, entryOi,
          exitTime, exitDate: new Date(exitTime).toISOString(),
          exitPrice, exitRsi, exitLsRatio, exitOi,
          margin, pnl: profit, pnlPercent: profit / capitalBefore * 100
        });
        position = 'FLAT';
        continue;
      }

      // ENTRY SHORT (RSI entre 30-60, funding >= 0)
      if (position === 'FLAT'
        && !uptrend
        && rsi < 60 && rsi > 30
        && macd < signal
        && price < vwap
        && vol > avgVol
        && lsRatio > 1 && oi > 0
        && funding >= 0
      ) {
        position = 'SHORT';
        entryPrice = price;
        entryTime = time;
        entryRsi = rsi;
        entryLs = lsRatio;
        entryOi = oi;
        continue;
      }

      // STOP-LOSS e EXIT SHORT
      const slShort = entryPrice + atr;
      if (position === 'SHORT' && (price > slShort || macd > signal || rsi < 30)) {
        const exitPrice = price;
        const exitTime = time;
        const exitRsi = rsi;
        const exitLsRatio = lsRatio;
        const exitOi = oi;
        const capitalBefore = balance;
        const margin = ENTRY_AMOUNT > 0
          ? Math.min(capitalBefore, ENTRY_AMOUNT)
          : capitalBefore / LEVERAGE;
        const profit = (entryPrice - exitPrice) / entryPrice * margin * LEVERAGE;
        balance += profit;
        trades.push({
          side: 'SHORT',
          entryTime, entryDate: new Date(entryTime).toISOString(),
          entryPrice, entryRsi, entryLsRatio: entryLs, entryOi,
          exitTime, exitDate: new Date(exitTime).toISOString(),
          exitPrice, exitRsi, exitLsRatio, exitOi,
          margin, pnl: profit, pnlPercent: profit / capitalBefore * 100
        });
        position = 'FLAT';
      }
    }

    results.push({ symbol, finalBalance: balance, trades });
    console.log(`✅ ${symbol}: ${trades.length} trades, final balance ${balance.toFixed(2)}`);
  }

  // grava JSON e MD summary (idem anterior)
  // ...
  return {
    // devolve estatísticas resumidas para envio
    startDate: new Date(startTs).toISOString().split('T')[0],
    endDate: new Date(endTs).toISOString().split('T')[0],
    totalTrades: results.reduce((sum, r) => sum + r.trades.length, 0),
    wins: results.reduce((sum, r) =>
      sum + r.trades.filter(t => (t.pnl ?? 0) > 0).length, 0
    ),
    losses: results.reduce((sum, r) =>
      sum + r.trades.filter(t => (t.pnl ?? 0) <= 0).length, 0
    ),
    profit: results.reduce((sum, r) =>
      sum + r.trades.reduce((s, t) => s + (t.pnl ?? 0), 0), 0
    ),
    maxDrawdown: 0, // placeholder
    trades: results.flatMap(r => r.trades)
  } as any;
}

// -------- WhatsApp Integration --------
// Inicializa client WhatsApp
const client = new Client({ authStrategy: new LocalAuth() });
client.on('qr', qr => { qrcode.generate(qr, { small: true }); console.log('Escaneie QR:'); });
client.on('ready', () => console.log('WhatsApp pronto.'));

function formatBacktestMarkdown(result: any): string {
  const { startDate, endDate, totalTrades, wins, losses, profit, maxDrawdown, trades } = result;
  let md = `*📊 Backtest Summary*\n\n`;
  md += `• *Período:* ${startDate} → ${endDate}\n`;
  md += `• *Total Trades:* ${totalTrades}\n`;
  md += `• *Wins:* ${wins} (${((wins / totalTrades) * 100).toFixed(1)}%)\n`;
  md += `• *Losses:* ${losses} (${((losses / totalTrades) * 100).toFixed(1)}%)\n`;
  md += `• *Profit Total:* ${profit.toFixed(2)} USD\n`;
  md += `• *Max Drawdown:* ${maxDrawdown.toFixed(2)} USD\n\n`;
  md += '*Últimas trades:*\n```markdown\n';
  md += '| # | Side  | Entry  | Exit   | P&L    |\n';
  md += '|---|-------|--------|--------|--------|\n';
  trades.slice(-5).forEach((t: any, i: number) => {
    const pnl = ((t.exitPrice - t.entryPrice) * (t.side === 'LONG' ? 1 : -1)).toFixed(2);
    md += `| ${i + 1} | ${t.side} | ${t.entryPrice.toFixed(2)} | ${t.exitPrice.toFixed(2)} | ${pnl} |\n`;
  });
  md += '```\n';
  return md;
}

async function sendMarkdown(result: any) {
  await client.initialize();
  const markdown = formatBacktestMarkdown(result);
  const to = process.env.WHATSAPP_TARGET;
  if (!to) throw new Error('Defina WHATSAPP_TARGET');
  const opts: MessageSendOptions = { sendMediaAsSticker: false };
  await client.sendMessage(to + '@c.us', markdown, opts);
  console.log('Mensagem enviada para', to);
}

// Função que une backtest e notificação
async function runBacktestAndNotify() {
  const summary = await runBacktest();
  await sendMarkdown(summary);
  process.exit(0);
}

runBacktestAndNotify().catch(err => { console.error(err); process.exit(1); });
