import "dotenv/config"
import fs from "fs"
import path from "path"
import { EventEmitter } from "events"
import WebSocket from "ws"
import type { TradeDetail } from "../models/tradeDetail"

EventEmitter.defaultMaxListeners = 20

interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface BacktestResult {
  timeframe: string
  startDate: string
  endDate: string
  totalTrades: number
  wins: number
  losses: number
  profit: number
  maxDrawdown: number
  profitFactor: number
  winRatePct: number
  trades: TradeDetail[]
  equityCurve: { time: number; equity: number }[]
}

interface WebSocketKlineData {
  e: string
  E: number
  s: string
  k: {
    t: number
    T: number
    s: string
    i: string
    f: number
    L: number
    o: string
    c: string
    h: string
    l: string
    v: string
    n: number
    x: boolean
    q: string
    V: string
    Q: string
  }
}

export class WebSocketBacktest {
  private symbolData: Map<string, Candle[]> = new Map()
  private connections: Map<string, WebSocket> = new Map()
  private readonly BINANCE_WS_BASE = "wss://fstream.binance.com/ws/"

  public async run(): Promise<void> {
    console.log("🚀 Iniciando WebSocket Backtest OTIMIZADO...")

    // Configurações ajustadas para coletar mais dados
    const timeframe = "1m"
    const collectionMinutes = 15 // Aumentado para 15 minutos
    const maxSymbols = 5 // Mais símbolos
    const minCandles = 5 // Reduzido requisito mínimo

    console.log("⚙️ Configurações:")
    console.log(`  • Timeframe: ${timeframe}`)
    console.log(`  • Tempo coleta: ${collectionMinutes} minutos`)
    console.log(`  • Símbolos: ${maxSymbols}`)
    console.log(`  • Mínimo candles: ${minCandles}`)

    const res = await this.runBacktestFor(timeframe, collectionMinutes, maxSymbols, minCandles)

    console.log(`\n✅ Backtest concluído!`)
    console.log(`🔢 Trades: ${res.totalTrades} | ✅ ${res.wins} | ❌ ${res.losses} | 💰 $${res.profit.toFixed(2)}`)
    console.log(`📈 WinRate: ${res.winRatePct.toFixed(1)}% | 📉 Max Drawdown: $${res.maxDrawdown.toFixed(2)}`)

    this.saveJson(res)
    console.log("🏁 Processamento concluído!")
  }

  private async fetchSymbolsViaRest(maxSymbols: number): Promise<string[]> {
    try {
      console.log("📡 Buscando símbolos da Binance...")

      // Símbolos mais ativos e líquidos
      const topSymbols = [
        "BTCUSDT",
        "ETHUSDT",
        "BNBUSDT",
        "ADAUSDT",
        "SOLUSDT",
        "XRPUSDT",
        "DOGEUSDT",
        "AVAXUSDT",
        "DOTUSDT",
        "MATICUSDT",
      ]

      const response = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo")
      const data = (await response.json()) as { symbols: any[] }

      const symbols = data.symbols
        .filter((s: any) => s.status === "TRADING" && s.contractType === "PERPETUAL")
        .map((s: any) => s.symbol)
        .filter((symbol: string) => topSymbols.includes(symbol))
        .slice(0, maxSymbols)

      console.log(`✅ ${symbols.length} símbolos selecionados: ${symbols.join(", ")}`)
      return symbols
    } catch (error) {
      console.error("❌ Erro ao buscar símbolos:", error)
      return ["BTCUSDT", "ETHUSDT", "ADAUSDT", "BNBUSDT", "SOLUSDT"].slice(0, maxSymbols)
    }
  }

  private createWebSocketConnection(symbol: string, timeframe: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const streamName = `${symbol.toLowerCase()}@kline_${timeframe}`
      const wsUrl = `${this.BINANCE_WS_BASE}${streamName}`

      console.log(`🔌 Conectando WebSocket: ${symbol}`)

      const ws = new WebSocket(wsUrl)
      let candleCount = 0
      let lastLogTime = 0

      ws.on("open", () => {
        console.log(`✅ WebSocket conectado: ${symbol}`)
        this.connections.set(symbol, ws)
        resolve()
      })

      ws.on("message", (data: Buffer) => {
        try {
          const message: WebSocketKlineData = JSON.parse(data.toString())

          if (message.e === "kline") {
            const candle: Candle = {
              openTime: message.k.t,
              open: Number.parseFloat(message.k.o),
              high: Number.parseFloat(message.k.h),
              low: Number.parseFloat(message.k.l),
              close: Number.parseFloat(message.k.c),
              volume: Number.parseFloat(message.k.v),
            }

            if (!this.symbolData.has(symbol)) {
              this.symbolData.set(symbol, [])
            }

            const symbolCandles = this.symbolData.get(symbol)!
            const existingIndex = symbolCandles.findIndex((c) => c.openTime === candle.openTime)

            if (existingIndex >= 0) {
              symbolCandles[existingIndex] = candle
            } else {
              symbolCandles.push(candle)
              candleCount++
            }

            // Log progresso a cada 30 segundos
            const now = Date.now()
            if (now - lastLogTime > 30000) {
              const isClosedKline = message.k.x ? "FECHADO" : "ABERTO"
              console.log(
                `📊 ${symbol}: ${candleCount} candles (${isClosedKline}) - Preço: $${candle.close.toFixed(2)}`,
              )
              lastLogTime = now
            }
          }
        } catch (error) {
          console.error(`Erro ao processar mensagem ${symbol}:`, error)
        }
      })

      ws.on("error", (error) => {
        console.error(`❌ Erro WebSocket ${symbol}:`, error)
        reject(error)
      })

      ws.on("close", () => {
        console.log(`🔌 WebSocket fechado: ${symbol} (${candleCount} candles coletados)`)
        this.connections.delete(symbol)
      })
    })
  }

  private async collectDataViaWebSocket(symbols: string[], timeframe: string, durationMs: number): Promise<void> {
    console.log(`📡 Coletando dados via WebSocket...`)

    // Conectar WebSockets sequencialmente para evitar sobrecarga
    for (const symbol of symbols) {
      try {
        await this.createWebSocketConnection(symbol, timeframe)
        await new Promise((resolve) => setTimeout(resolve, 500)) // 500ms entre conexões
      } catch (error) {
        console.error(`Falha ao conectar ${symbol}:`, error)
      }
    }

    const connectedSymbols = Array.from(this.connections.keys())
    console.log(`✅ ${connectedSymbols.length}/${symbols.length} conexões estabelecidas`)

    if (connectedSymbols.length === 0) {
      throw new Error("Nenhuma conexão WebSocket foi estabelecida")
    }

    console.log(`⏳ Coletando dados por ${Math.round(durationMs / 1000)} segundos...`)
    console.log(`📈 Aguarde... dados sendo coletados em tempo real`)

    // Mostrar progresso durante coleta
    const progressInterval = setInterval(() => {
      console.log("\n📊 Progresso atual:")
      for (const symbol of connectedSymbols) {
        const candles = this.symbolData.get(symbol) || []
        console.log(`  • ${symbol}: ${candles.length} candles`)
      }
    }, 60000) // A cada minuto

    // Aguardar coleta
    await new Promise((resolve) => setTimeout(resolve, durationMs))

    clearInterval(progressInterval)

    // Fechar conexões
    console.log("\n🔌 Fechando conexões...")
    for (const [symbol, ws] of this.connections) {
      ws.close()
    }

    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Mostrar estatísticas finais
    console.log("\n📊 Dados coletados (FINAL):")
    for (const symbol of symbols) {
      const candles = this.symbolData.get(symbol) || []
      console.log(`  • ${symbol}: ${candles.length} candles`)
    }
  }

  private getJsonPath(endDate: string, tf: string) {
    return path.join(__dirname, "..", "..", "data", "json", `backtest-ws-optimized-${tf}-${endDate}.json`)
  }

  private saveJson(res: BacktestResult): void {
    const file = this.getJsonPath(res.endDate, res.timeframe)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(res, null, 2))
    console.log(`💾 Resultado salvo em ${file}`)
  }

  public async runBacktestFor(
    timeframe: string,
    collectionMinutes: number,
    maxSymbols: number,
    minCandles: number,
  ): Promise<BacktestResult> {
    const startingBalance = 1000
    let equity = startingBalance
    const equityCurve: { time: number; equity: number }[] = []

    const endTs = Date.now()
    const startTs = endTs - collectionMinutes * 60 * 1000

    // Buscar símbolos
    const symbols = await this.fetchSymbolsViaRest(maxSymbols)

    // Coletar dados
    await this.collectDataViaWebSocket(symbols, timeframe, collectionMinutes * 60 * 1000)

    const tradesAll: TradeDetail[] = []

    // Processar dados com estratégia simples
    for (const symbol of symbols) {
      const candles = this.symbolData.get(symbol) || []

      if (candles.length < minCandles) {
        console.log(`⚠️ ${symbol} — candles insuficientes: ${candles.length} (mín: ${minCandles})`)
        continue
      }

      console.log(`✅ ${symbol} — processando ${candles.length} candles`)

      // Ordenar por tempo
      candles.sort((a, b) => a.openTime - b.openTime)

      // Estratégia simples: comprar em baixa, vender em alta
      for (let i = 1; i < candles.length - 1; i++) {
        const prevCandle = candles[i - 1]
        const currentCandle = candles[i]
        const nextCandle = candles[i + 1]

        // Sinal de compra: preço caiu e depois subiu
        const priceDrop = (currentCandle.low - prevCandle.close) / prevCandle.close
        const priceRise = (nextCandle.close - currentCandle.low) / currentCandle.low

        if (priceDrop < -0.001 && priceRise > 0.001) {
          // 0.1% movimento
          const entryPrice = currentCandle.low * 1.001 // Slippage
          const exitPrice = nextCandle.close * 0.999 // Slippage

          const pnlPct = (exitPrice - entryPrice) / entryPrice
          const positionSize = 100 // $100 por trade
          const pnl = pnlPct * positionSize

          tradesAll.push({
            side: "LONG",
            symbol,
            entryTime: currentCandle.openTime,
            exitTime: nextCandle.openTime,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            pnl: pnl,
            entryDate: new Date(currentCandle.openTime).toISOString(),
            exitDate: new Date(nextCandle.openTime).toISOString(),
          })

          equity += pnl
          equityCurve.push({ time: nextCandle.openTime, equity })

          console.log(`💰 Trade ${symbol}: ${pnl > 0 ? "✅" : "❌"} $${pnl.toFixed(2)}`)
        }
      }
    }

    this.symbolData.clear()

    const totalTrades = tradesAll.length
    const wins = tradesAll.filter((t) => (t.pnl ?? 0) > 0).length
    const losses = totalTrades - wins
    const profit = tradesAll.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
    const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0
    const maxDrawdown = Math.max(0, startingBalance - Math.min(...equityCurve.map((e) => e.equity), startingBalance))

    const grossWin = tradesAll.filter((t) => (t.pnl ?? 0) > 0).reduce((sum, t) => sum + t.pnl!, 0)
    const grossLoss = Math.abs(tradesAll.filter((t) => (t.pnl ?? 0) < 0).reduce((sum, t) => sum + t.pnl!, 0))
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : 0

    return {
      timeframe,
      startDate: new Date(startTs).toISOString().split("T")[0],
      endDate: new Date(endTs).toISOString().split("T")[0],
      totalTrades,
      wins,
      losses,
      profit,
      maxDrawdown,
      profitFactor,
      winRatePct,
      trades: tradesAll,
      equityCurve,
    }
  }
}

// Execução
if (require.main === module) {
  ;(async () => {
    try {
      const backtester = new WebSocketBacktest()
      await backtester.run()
    } catch (error) {
      console.error("❌ Erro:", error)
      process.exit(1)
    }
  })()
}
