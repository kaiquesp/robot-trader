import type { Indicators } from "../models/Indicators"
import type { OpenPosition } from "./positionManager"
import type { PositionManager } from "./positionManager"
import { calculateATR } from "../utils/indicators"
import type { FileService } from "../services/fileService"
import { AxiosError } from "axios"
import { countTP_SL } from "../services/tradeStatsService"
import { TradingRule } from "../enum/tradingRule"
const path = require("path")

export class BotController {
  // Global lock para prevenir processamento simultâneo do mesmo símbolo
  private static processingSymbols: Set<string> = new Set()
  private positionCache: Map<string, { position: OpenPosition | null; timestamp: number }> = new Map()
  private readonly CACHE_TTL = 10000 // Reduzido para 10 segundos
  private readonly ORDER_PROCESSING_DELAY = 3000 // Aumentado para 3 segundos

  constructor(
    private positionService: {
      getOpenPositions(): Promise<OpenPosition[]>
    },
    private indicatorService: {
      fetchIndicators(symbol: string): Promise<Indicators>
      setCurrentTime?(ts: number): void
    },
    private orderService: {
      placeOrder(symbol: string, side: "BUY" | "SELL"): Promise<void>
      placeCloseOrder(symbol: string, side: "BUY" | "SELL", qty: string): Promise<void>
      placeBracketOrder(symbol: string, side: "BUY" | "SELL", tpPrice: number, slPrice: number): Promise<void>
      placeBracketOrderWithRetries(
        symbol: string,
        side: "BUY" | "SELL",
        tpPrice: number,
        slPrice: number,
      ): Promise<void>
      cancelOpenOrders(symbol: string): Promise<void>
      getAllOpenOrders(symbol?: string): Promise<any[]>
      getRealizedPnl(sinceTs: number): Promise<number>
      getAccountBalance(): Promise<any>
    },
    private positionManager: PositionManager,
    private fileService: FileService,
  ) { }

  private async getPositionSafe(symbol: string, forceRefresh = false): Promise<OpenPosition | null> {
    const cached = this.positionCache.get(symbol)
    const now = Date.now()

    if (!forceRefresh && cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.position
    }

    const positions = await this.positionService.getOpenPositions()
    const position = positions.find((p) => p.symbol === symbol) || null

    this.positionCache.set(symbol, { position, timestamp: now })
    return position
  }

  private clearPositionCache(symbol?: string) {
    if (symbol) {
      this.positionCache.delete(symbol)
    } else {
      this.positionCache.clear()
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async canOpenPosition(symbol: string): Promise<{ canOpen: boolean; reason?: string }> {
    // // 1. Verificar se já está sendo processado
    if (BotController.processingSymbols.has(symbol)) {
      return { canOpen: false, reason: "Símbolo já está sendo processado" }
    }

    // 2. Verificar posições existentes (sempre fresh)
    const position = await this.getPositionSafe(symbol, true)
    if (position) {
      return { canOpen: false, reason: "Posição já existe" }
    }

    // 3. Verificar ordens pendentes
    const existingOrders = await this.orderService.getAllOpenOrders(symbol)
    if (existingOrders.length > 0) {
      return { canOpen: false, reason: `${existingOrders.length} ordens pendentes` }
    }

    // 4. Verificar limite de posições
    const allPositions = await this.positionService.getOpenPositions()
    const maxPositions = 7
    if (allPositions.length >= maxPositions) {
      return { canOpen: false, reason: `Limite de ${maxPositions} posições atingido` }
    }

    return { canOpen: true }
  }

  async run(symbols: string[] = []) {
    const hoursBack = 24
    const sinceTs = Date.now() - hoursBack * 3600 * 1000

    console.log(`\n🚀 Iniciando ciclo do bot... as ${new Date().toISOString()} `)

    // Clear position cache at start of each cycle
    this.clearPositionCache()

    const positionsStart = await this.positionService.getOpenPositions()
    console.log(`📊 Posições abertas na Binance: ${positionsStart.length}`)
    console.log(`🔒 Símbolos em processamento: ${Array.from(BotController.processingSymbols).join(", ") || "Nenhum"}`)

    console.log(`📋 Total de símbolos para avaliar: ${symbols.length}`)

    const openedThisCycle = new Set<string>()

    for (const symbol of symbols) {
      try {
        // Verificar se já está sendo processado globalmente
        if (BotController.processingSymbols.has(symbol)) {
          console.log(`🔒 ${symbol} já está sendo processado por outra instância, pulando...`)
          continue
        }

        // Use cached position check first
        const existing = await this.getPositionSafe(symbol)
        const ind = await this.indicatorService.fetchIndicators(symbol)

        if (!ind.closes || !ind.highs || !ind.lows) {
          console.warn(`⚠️ Indicadores incompletos para ${symbol}, pulando...`)
          continue
        }

        const { closes, highs, lows } = ind
        const n = closes.length - 1

        // 📉 FECHAMENTO
        if (existing) {
          // Recalcula ATR para o símbolo
          const ATR_PERIOD = Number.parseInt(process.env.ATR_PERIOD || "14", 10)
          if (closes.length < ATR_PERIOD || highs.length < ATR_PERIOD || lows.length < ATR_PERIOD) {
            console.warn(`📉 Dados insuficientes para ATR em ${symbol}`)
            continue
          }
          const atr = calculateATR(
            highs.slice(n - ATR_PERIOD, n),
            lows.slice(n - ATR_PERIOD, n),
            closes.slice(n - ATR_PERIOD, n),
          )

          // Calcula o stoploss para a posição aberta
          const SL_ATR_MULT = Number.parseFloat(process.env.SL_ATR_MULT || "1")
          const stopLoss =
            existing.side === "BUY" ? existing.entryPrice - atr * SL_ATR_MULT : existing.entryPrice + atr * SL_ATR_MULT

          // Agora passa o stopLoss para o método
          const mapIndicatorsToContext = this.positionManager.mapIndicatorsToContext(ind)
          if (this.positionManager.shouldClosePosition(symbol, existing, mapIndicatorsToContext)) {
            const side = existing.side === "BUY" ? "SELL" : "BUY"
            const qty = Math.abs(existing.positionAmt).toFixed(6)

            await this.orderService.placeCloseOrder(symbol, side, qty)
            console.log(`✅ Fechando ${existing.side} em ${symbol} com qty=${qty}`)

            // Clear cache after closing position
            this.clearPositionCache(symbol)

            const lastPrice = closes[n]
            const pnl =
              existing.side === "BUY"
                ? (lastPrice - existing.entryPrice) / existing.entryPrice
                : (existing.entryPrice - lastPrice) / existing.entryPrice

            const leverage = Number.parseInt(process.env.LEVERAGE || "1", 10)
            const amount = Number.parseFloat(process.env.ENTRY_AMOUNT || "200")
            const pnlDollar = pnl * amount * leverage

            const isTP = pnl > 0

            this.fileService.saveTradeEvent({
              type: isTP ? "TP_EXECUTED" : "SL_EXECUTED",
              symbol,
              side: existing.side,
              pnl: Number.parseFloat((pnl * 100).toFixed(2)),
              pnlDollar: Number.parseFloat(pnlDollar.toFixed(2)),
              price: lastPrice,
              date: new Date().toISOString(),
            })

            await this.orderService.cancelOpenOrders(symbol)

            this.fileService.saveTradeEvent({
              type: "ORDER_CANCELED",
              symbol,
              date: new Date().toISOString(),
            })

            const positionsAfterClose = await this.positionService.getOpenPositions()
            console.log(`♻️ Posições atualizadas após fechamento. Agora: ${positionsAfterClose.length}`)

            const balanceInfo = await this.orderService.getAccountBalance()
            const balance = balanceInfo.totalWalletBalance
            const availableBalance = balanceInfo.availableBalance

            const logMsg = [
              `🔔 [${symbol}] Saída ${existing.side} @ ${new Date().toISOString()}`,
              `  • Entry: ${existing.entryPrice.toFixed(2)} Exit: ${lastPrice.toFixed(2)}`,
              `  • PnL: ${isTP ? "🟢 +" : "🔴 "}${(pnlDollar).toFixed(2)}`,
              `  • Balance: ${balance.toFixed(2)}`,
              `  • Available: ${availableBalance.toFixed(2)}`,
            ].join("\n")

            console.log(logMsg)
            this.appendTradeLog(logMsg)
          }

          continue
        }

        // 📈 AVALIAR ENTRADA
        const action = await this.positionManager.processSymbol(symbol, TradingRule.emaCrossover34x72)

        if (!action || action === "HOLD") {
          continue
        }

        // Verificar se já foi aberto neste ciclo
        if (openedThisCycle.has(symbol)) {
          console.log(`⚠️ ${symbol} já foi aberto neste ciclo, pulando...`)
          continue
        }

        // VERIFICAÇÃO COMPLETA ANTES DE ABRIR POSIÇÃO
        const canOpenResult = await this.canOpenPosition(symbol)
        if (!canOpenResult.canOpen) {
          console.log(`⚠️ ${symbol} não pode ser aberto: ${canOpenResult.reason}`)
          continue
        }

        // LOCK o símbolo para prevenir processamento simultâneo
        BotController.processingSymbols.add(symbol)
        console.log(`🔒 Bloqueando ${symbol} para processamento...`)

        try {
          // VERIFICAÇÃO FINAL antes de abrir (double-check após lock)
          const finalCheck = await this.canOpenPosition(symbol)
          if (!finalCheck.canOpen) {
            console.log(`⚠️ ${symbol} falhou na verificação final: ${finalCheck.reason}`)
            continue
          }

          const ATR_PERIOD = Number.parseInt(process.env.ATR_PERIOD || "14", 10)
          if (closes.length < ATR_PERIOD || highs.length < ATR_PERIOD || lows.length < ATR_PERIOD) {
            console.warn(`📉 Dados insuficientes para ATR em ${symbol}`)
            continue
          }

          const atr = calculateATR(
            highs.slice(n - ATR_PERIOD, n),
            lows.slice(n - ATR_PERIOD, n),
            closes.slice(n - ATR_PERIOD, n),
          )

          const lastPrice = closes[n]
          const TP_ATR_MULT = Number.parseFloat(process.env.TP_ATR_MULT || "1.5")
          const SL_ATR_MULT = Number.parseFloat(process.env.SL_ATR_MULT || "1")

          const tpPrice = action === "BUY" ? lastPrice + atr * TP_ATR_MULT : lastPrice - atr * TP_ATR_MULT
          const slPrice = action === "BUY" ? lastPrice - atr * SL_ATR_MULT : lastPrice + atr * SL_ATR_MULT

          await this.orderService.cancelOpenOrders(symbol)

          console.log(`🔔 Sinal ${action} em ${symbol}`)
          console.log(`   ATR: ${atr.toFixed(4)}`)
          console.log(`   TP: ${tpPrice.toFixed(4)}`)
          console.log(`   SL: ${slPrice.toFixed(4)}`)

          // Tenta abrir com retries (3 tentativas)
          await this.orderService.placeBracketOrderWithRetries(symbol, action, tpPrice, slPrice)

          console.log(`✅ Ordem ${action} aberta em ${symbol}`)

          // Marcar como aberto APENAS após sucesso
          openedThisCycle.add(symbol)

          // Clear position cache for this symbol to force fresh data next time
          this.clearPositionCache(symbol)

          const entryLog = `🔄 [${symbol}] Entrada ${action} @ ${new Date().toISOString()} (RSI=${ind.rsi?.toFixed(1)})`

          console.log(entryLog)
          this.appendTradeLog(entryLog)

          // Refresh positions after successful order
          const positionsAfterOpen = await this.positionService.getOpenPositions()
          console.log(`♻️ Posições atualizadas. Total agora: ${positionsAfterOpen.length}`)

          // Add delay to allow exchange to process the order
          await this.sleep(this.ORDER_PROCESSING_DELAY)
        } finally {
          // SEMPRE remover o lock, mesmo em caso de erro
          BotController.processingSymbols.delete(symbol)
          console.log(`🔓 Desbloqueando ${symbol}`)
        }
      } catch (err) {
        // Garantir que o lock seja removido em caso de erro
        BotController.processingSymbols.delete(symbol)

        if (err instanceof AxiosError) {
          console.error(`❌ Erro ao processar ${symbol}:`, err.response?.data?.msg || err.message)
        } else {
          console.error(`❌ Erro ao processar ${symbol}:`, (err as any)?.message || err)
        }
      }
    }

    // ============================
    // VERIFICA POSIÇÕES ORFÃS e ORDENS ORFÃS
    // ============================

    console.log("\n🧹 Verificando consistência de ordens e posições...")

    const positionsNow = await this.positionService.getOpenPositions()
    const openOrdersNow = await this.orderService.getAllOpenOrders()

    for (const pos of positionsNow) {
      const ordersForSymbol = openOrdersNow.filter((o) => o.symbol === pos.symbol)

      if (ordersForSymbol.length === 0) {
        console.warn(`⚠️ Posição em ${pos.symbol} sem ordens! Fechando imediatamente.`)

        const side = pos.side === "BUY" ? "SELL" : "BUY"
        const qty = Math.abs(pos.positionAmt).toFixed(6)
        await this.orderService.placeCloseOrder(pos.symbol, side, qty)

        console.log(`🚨 Posição ${pos.side} em ${pos.symbol} foi fechada (sem ordens).`)
        this.clearPositionCache(pos.symbol)
      }
    }

    for (const order of openOrdersNow) {
      const stillOpenPosition = positionsNow.find((p) => p.symbol === order.symbol)

      if (!stillOpenPosition) {
        console.warn(`⚠️ Ordem pendente em ${order.symbol} mas sem posição. Cancelando...`)

        await this.orderService.cancelOpenOrders(order.symbol)

        console.log(`🗑️ Ordens de ${order.symbol} canceladas (sem posição).`)
      }
    }

    // ============================
    // PNL REALIZADO + CONTAGEM TP/SL via API
    // ============================

    const realizedPnl = await this.orderService.getRealizedPnl(sinceTs)
    const balanceInfo = await this.orderService.getAccountBalance()
    const balance = balanceInfo.totalWalletBalance
    const positionsNow2 = await this.positionService.getOpenPositions()
    const availableBalance = balanceInfo.availableBalance

    let totalTP = 0
    let totalSL = 0

    for (const symbol of symbols) {
      const { tpCount: tps, slCount: sls } = await countTP_SL(symbol, sinceTs)
      totalTP += tps
      totalSL += sls
    }

    const totalClosed = totalTP + totalSL
    const tpPct = totalClosed > 0 ? (totalTP / totalClosed) * 100 : 0
    const slPct = totalClosed > 0 ? (totalSL / totalClosed) * 100 : 0

    const cycleSummary = [
      `🏁 Fim do ciclo. Total posições abertas: ${positionsNow2.length}`,
      `💰 PnL realizado ${new Date(sinceTs).toISOString()} no ciclo: ${realizedPnl >= 0 ? "🟢" : "🔴"} ${realizedPnl.toFixed(2)} USDT`,
      `🎯 TP: ${totalTP} (${tpPct.toFixed(1)}%)  🛑 SL: ${totalSL} (${slPct.toFixed(1)}%)`,
      `💰 Balance: ${balance.toFixed(2)}`,
      `  • Available: ${availableBalance.toFixed(2)}`,
      `🔄 Ordens abertas neste ciclo: ${Array.from(openedThisCycle).join(", ") || "Nenhuma"}`,
      `🔒 Símbolos ainda em processamento: ${Array.from(BotController.processingSymbols).join(", ") || "Nenhum"}`,
      "---------------------------------------\n",
    ].join("\n")

    console.log(cycleSummary)
    this.appendTradeLog(cycleSummary)
  }

  private appendTradeLog(message: string) {
    const fs = require("fs")
    const logPath = path.join(__dirname, "../logs/trades.log")

    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, message + "\n")
  }
}
