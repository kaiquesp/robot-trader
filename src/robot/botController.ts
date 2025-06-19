import { Indicators } from "../models/Indicators";
import { OpenPosition } from "./positionManager";
import { PositionManager } from "./positionManager";
import { calculateATR } from "../utils/indicators";
import { FileService } from "../services/fileService";
import { AxiosError } from "axios";
import { determineAction } from "../rules/tradingRules";
import { countTP_SL } from "../services/tradeStatsService";
import { TradingRule } from "../enum/tradingRule";
const path = require('path');

export class BotController {
  constructor(
    private positionService: {
      getOpenPositions(): Promise<OpenPosition[]>
    },
    private indicatorService: {
      fetchIndicators(symbol: string): Promise<Indicators>;
      setCurrentTime?(ts: number): void;
    },
    private orderService: {
      placeOrder(symbol: string, side: 'BUY' | 'SELL'): Promise<void>;
      placeBracketOrder(symbol: string, side: 'BUY' | 'SELL', tpPrice: number, slPrice: number): Promise<void>;
      placeBracketOrderWithRetries(symbol: string, side: 'BUY' | 'SELL', tpPrice: number, slPrice: number): Promise<void>;
      cancelOpenOrders(symbol: string): Promise<void>;
      getAllOpenOrders(symbol?: string): Promise<any[]>;
      getRealizedPnl(sinceTs: number): Promise<number>;
      getAccountBalance(): Promise<any>;
    },
    private positionManager: PositionManager,
    private fileService: FileService
  ) { }

  async run() {
    console.log(`\n🚀 Iniciando ciclo do bot...`);

    // const cycleStartTs = Date.now();

    let tpCount = 0;
    let slCount = 0;

    let openPositions: OpenPosition[] = await this.positionService.getOpenPositions();
    console.log(`📊 Posições abertas na Binance: ${openPositions.length}`);

    const symbols = await this.positionManager.getSymbols();
    console.log(`📋 Total de símbolos para avaliar: ${symbols.length}`);

    const maxPositions = 7;
    const openedThisCycle = new Set<string>();

    for (const symbol of symbols) {
      try {
        const existing = openPositions.find(p => p.symbol === symbol);
        const ind = await this.indicatorService.fetchIndicators(symbol);

        if (!ind.closes || !ind.highs || !ind.lows) {
          console.warn(`⚠️ Indicadores incompletos para ${symbol}, pulando...`);
          continue;
        }

        const { closes, highs, lows } = ind;
        const n = closes.length - 1;

        // 📉 FECHAMENTO
        if (existing) {
          // Recalcula ATR para o símbolo
          const ATR_PERIOD = parseInt(process.env.ATR_PERIOD || '14', 10);
          if (closes.length < ATR_PERIOD || highs.length < ATR_PERIOD || lows.length < ATR_PERIOD) {
            console.warn(`📉 Dados insuficientes para ATR em ${symbol}`);
            continue;
          }
          const atr = calculateATR(
            highs.slice(n - ATR_PERIOD, n),
            lows.slice(n - ATR_PERIOD, n),
            closes.slice(n - ATR_PERIOD, n)
          );

          // Calcula o stoploss para a posição aberta
          const SL_ATR_MULT = parseFloat(process.env.SL_ATR_MULT || '1');
          const stopLoss = existing.side === 'BUY'
            ? existing.entryPrice - atr * SL_ATR_MULT
            : existing.entryPrice + atr * SL_ATR_MULT;

          // Agora passa o stopLoss para o método
          if (this.positionManager.shouldClosePosition(existing, ind, stopLoss)) {
            const side = existing.side === 'BUY' ? 'SELL' : 'BUY';
            await this.orderService.placeOrder(symbol, side);
            console.log(`✅ Fechando ${existing.side} em ${symbol}`);

            const lastPrice = closes[n];
            const pnl = existing.side === 'BUY'
              ? (lastPrice - existing.entryPrice) / existing.entryPrice
              : (existing.entryPrice - lastPrice) / existing.entryPrice;

            const leverage = parseInt(process.env.LEVERAGE || '1', 10);
            const amount = parseFloat(process.env.ENTRY_AMOUNT || '200');
            const pnlDollar = pnl * amount * leverage;

            const isTP = pnl > 0;

            this.fileService.saveTradeEvent({
              type: isTP ? 'TP_EXECUTED' : 'SL_EXECUTED',
              symbol,
              side: existing.side,
              pnl: parseFloat((pnl * 100).toFixed(2)),
              pnlDollar: parseFloat(pnlDollar.toFixed(2)),
              price: lastPrice,
              date: new Date().toISOString()
            });

            // incrementa contadores
            if (isTP) {
              tpCount++;
            } else {
              slCount++;
            }

            await this.orderService.cancelOpenOrders(symbol);

            this.fileService.saveTradeEvent({
              type: 'ORDER_CANCELED',
              symbol,
              date: new Date().toISOString()
            });

            openPositions = await this.positionService.getOpenPositions();
            console.log(`♻️ Posições atualizadas após fechamento. Agora: ${openPositions.length}`);

            const balanceInfo = await this.orderService.getAccountBalance();
            const balance = balanceInfo.availableBalance;

            const logMsg = [
              `🔔 [${symbol}] Saída ${existing.side} @ ${new Date().toISOString()}`,
              `  • Entry: ${existing.entryPrice.toFixed(2)} Exit: ${lastPrice.toFixed(2)}`,
              `  • PnL: ${isTP ? '🟢 +' : '🔴 '}${(pnlDollar).toFixed(2)}`,
              `  • Balance: ${balance.toFixed(2)}`
            ].join('\n');

            console.log(logMsg);
            this.appendTradeLog(logMsg);
          }

          continue;
        }

        // 📈 AVALIAR ENTRADA
        // const action = this.positionManager.determineAction(symbol, ind);
        const action = await this.positionManager.processSymbol(symbol, TradingRule.emaCrossover34x72);

        if (!action || action === 'HOLD') {
          continue;
        }

        openPositions = await this.positionService.getOpenPositions();

        if (openPositions.find(p => p.symbol === symbol)) {
          console.log(`⚠️ ${symbol} já tem posição aberta na Binance, pulando...`);
          continue;
        }

        if (openedThisCycle.has(symbol)) {
          console.log(`⚠️ ${symbol} já foi aberto neste ciclo, pulando...`);
          continue;
        }

        if (openPositions.length >= maxPositions) {
          console.warn(`❌ Limite de ${maxPositions} posições atingido. Ignorando ${symbol} - direção que iria abrir: ${action}`);
          continue;
        }

        const ATR_PERIOD = parseInt(process.env.ATR_PERIOD || '14', 10);
        if (closes.length < ATR_PERIOD || highs.length < ATR_PERIOD || lows.length < ATR_PERIOD) {
          console.warn(`📉 Dados insuficientes para ATR em ${symbol}`);
          continue;
        }

        const atr = calculateATR(
          highs.slice(n - ATR_PERIOD, n),
          lows.slice(n - ATR_PERIOD, n),
          closes.slice(n - ATR_PERIOD, n)
        );

        const lastPrice = closes[n];
        const TP_ATR_MULT = parseFloat(process.env.TP_ATR_MULT || '1.5');
        const SL_ATR_MULT = parseFloat(process.env.SL_ATR_MULT || '1');

        const tpPrice = action === 'BUY'
          ? lastPrice + atr * TP_ATR_MULT
          : lastPrice - atr * TP_ATR_MULT;

        const slPrice = action === 'BUY'
          ? lastPrice - atr * SL_ATR_MULT
          : lastPrice + atr * SL_ATR_MULT;

        await this.orderService.cancelOpenOrders(symbol);

        console.log(`🔔 Sinal ${action} em ${symbol}`);
        console.log(`   ATR: ${atr.toFixed(4)}`);
        console.log(`   TP: ${tpPrice.toFixed(4)}`);
        console.log(`   SL: ${slPrice.toFixed(4)}`);

        // Tenta abrir com retries (3 tentativas)
        await this.orderService.placeBracketOrderWithRetries(symbol, action, tpPrice, slPrice);

        console.log(`✅ Ordem ${action} aberta em ${symbol}`);

        openedThisCycle.add(symbol);

        const entryLog = `🔄 [${symbol}] Entrada ${action} @ ${new Date().toISOString()} (RSI=${ind.rsi?.toFixed(1)})`;

        console.log(entryLog);
        this.appendTradeLog(entryLog);

        openPositions = await this.positionService.getOpenPositions();
        console.log(`♻️ Posições atualizadas. Total agora: ${openPositions.length}`);
      } catch (err) {
        if (err instanceof AxiosError) {
          console.error(`❌ Erro ao processar ${symbol}:`, err.response?.data?.msg || err.message);
        } else {
          console.error(`❌ Erro ao processar ${symbol}:`, (err as any)?.message || err);
        }
      }
    }

    // ============================
    // VERIFICA POSIÇÕES ORFÃS e ORDENS ORFÃS
    // ============================

    console.log('\n🧹 Verificando consistência de ordens e posições...');

    const positionsNow = await this.positionService.getOpenPositions();
    const openOrdersNow = await this.orderService.getAllOpenOrders();

    for (const pos of positionsNow) {
      const ordersForSymbol = openOrdersNow.filter(o => o.symbol === pos.symbol);

      if (ordersForSymbol.length === 0) {
        console.warn(`⚠️ Posição em ${pos.symbol} sem ordens! Fechando imediatamente.`);

        const side = pos.side === 'BUY' ? 'SELL' : 'BUY';
        await this.orderService.placeOrder(pos.symbol, side);

        console.log(`🚨 Posição ${pos.side} em ${pos.symbol} foi fechada (sem ordens).`);
      }
    }

    for (const order of openOrdersNow) {
      const stillOpenPosition = positionsNow.find(p => p.symbol === order.symbol);

      if (!stillOpenPosition) {
        console.warn(`⚠️ Ordem pendente em ${order.symbol} mas sem posição. Cancelando...`);

        await this.orderService.cancelOpenOrders(order.symbol);

        console.log(`🗑️ Ordens de ${order.symbol} canceladas (sem posição).`);
      }
    }

    // ============================
    // PNL REALIZADO + CONTAGEM TP/SL via API
    // ============================

    const hoursBack = 24;
    const sinceTs = Date.now() - hoursBack * 3600 * 1000;
    const realizedPnl = await this.orderService.getRealizedPnl(sinceTs);
    const balanceInfo = await this.orderService.getAccountBalance();
    const balance = balanceInfo.availableBalance;

    let totalTP = 0;
    let totalSL = 0;

    for (const symbol of symbols) {
      const { tpCount: tps, slCount: sls } = await countTP_SL(symbol, sinceTs);
      totalTP += tps;
      totalSL += sls;
    }

    const totalClosed = totalTP + totalSL;
    const tpPct = totalClosed > 0 ? (totalTP / totalClosed) * 100 : 0;
    const slPct = totalClosed > 0 ? (totalSL / totalClosed) * 100 : 0;

    const cycleSummary = [
      `🏁 Fim do ciclo. Total posições abertas: ${positionsNow.length}`,
      `💰 PnL realizado ${new Date(sinceTs).toISOString()} no ciclo: ${realizedPnl >= 0 ? '🟢' : '🔴'} ${realizedPnl.toFixed(2)} USDT`,
      `🎯 TP: ${totalTP} (${tpPct.toFixed(1)}%)  🛑 SL: ${totalSL} (${slPct.toFixed(1)}%)`,
      `💰 Balance: ${balance})`,
      '---------------------------------------\n'
    ].join('\n');

    console.log(cycleSummary);
    this.appendTradeLog(cycleSummary);
  }

  private appendTradeLog(message: string) {
    const fs = require('fs');
    const logPath = path.join(__dirname, '../../logs/trades.log');

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, message + '\n');
  }
}
