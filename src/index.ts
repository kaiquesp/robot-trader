import "dotenv/config"
import { BotController } from "./robot/botController"
import { PositionManager } from "./robot/positionManager"
import { indicatorService } from "./services/indicatorsService"
import { orderService } from "./services/orderService"
import { fileService } from "./services/fileService"
import { updateTimeOffset } from "./services/timeOffsetService"
import { PositionService } from "./services/positionService"

// 🔧 VARIÁVEIS GLOBAIS
let TRADING_SYMBOLS: string[] = []
let bot: BotController | null = null
let mainInterval: NodeJS.Timeout | null = null
let statsInterval: NodeJS.Timeout | null = null

const positionService = new PositionService(
  'https://fapi.binance.com',
  process.env.BINANCE_API_KEY!,
  process.env.BINANCE_API_SECRET!
)

// Instancia o positionManager
const positionManager = new PositionManager()

// Adapter para o orderService — métodos que o BotController espera
const orderServiceAdapter = {
  getKlines: orderService.getKlines,
  placeOrder: orderService.placeOrder,
  placeCloseOrder: orderService.placeCloseOrder,
  placeBracketOrder: orderService.placeBracketOrder,
  placeBracketOrderWithRetries: orderService.placeBracketOrderWithRetries,
  cancelOpenOrders: orderService.cancelOpenOrders,
  getAccountBalance: orderService.getAccountBalance,
  getAllOpenOrders: orderService.getAllOpenOrders,
  getRealizedPnl: orderService.getRealizedPnl,
}

// 🔧 FUNÇÃO PARA CARREGAR SÍMBOLOS
async function loadTradingSymbols(): Promise<string[]> {
  try {
    console.log("📋 Carregando símbolos de trading...")
    const symbols = await positionManager.getSymbols()

    if (!symbols || symbols.length === 0) {
      throw new Error("Nenhum símbolo encontrado no positionManager")
    }

    console.log(`   ✅ ${symbols.length} símbolos carregados: ${symbols.slice(0, 5).join(", ")}${symbols.length > 5 ? "..." : ""}`)
    return symbols
  } catch (error: any) {
    console.error("❌ Erro ao carregar símbolos:", error?.message || error)
    throw error
  }
}

// 🔧 FUNÇÃO DE INICIALIZAÇÃO OTIMIZADA
async function initializeBot(): Promise<BotController> {
  console.log(`\n🤖 Inicializando Bot com WebSockets otimizados...`)

  try {
    // 1. Carrega símbolos de trading
    TRADING_SYMBOLS = await loadTradingSymbols()

    // 2. Sincroniza o clock
    console.log("⏰ Sincronizando clock...")
    await updateTimeOffset()

    // 3. 🚀 INICIALIZA WEBSOCKETS OTIMIZADOS
    console.log(`📡 Inicializando WebSockets para ${TRADING_SYMBOLS.length} símbolos...`)
    await orderService.initializeWebSockets(TRADING_SYMBOLS)

    // Inicia PositionService WS
    console.log("📡 Iniciando WebSocket de posições (PositionService)...")
    await positionService.startPositionStream()

    // 4. Aguarda estabilização dos WebSockets
    console.log("⏳ Aguardando estabilização dos WebSockets...")
    await waitForWebSocketStabilization()

    // 5. Verifica se os dados estão chegando
    const positions = await orderService.getOpenPositions()
    const balance = await orderService.getAccountBalance()

    console.log(`✅ WebSockets inicializados:`)
    console.log(`   📈 Posições: ${positions.length}`)
    console.log(`   💰 Saldo: $${balance.availableBalance?.toFixed(2) || "0.00"}`)

    // 6. Instancia o bot
    const botInstance = new BotController(
      { getOpenPositions: () => positionService.getOpenPositions() },
      indicatorService,
      orderServiceAdapter,
      positionManager,
      fileService
    )

    console.log("🎯 Bot inicializado com sucesso!")
    return botInstance
  } catch (error: any) {
    console.error("❌ Erro na inicialização:", error?.response?.data?.msg || error?.message || error)
    throw error
  }
}

// ⏳ FUNÇÃO PARA AGUARDAR ESTABILIZAÇÃO DOS WEBSOCKETS
async function waitForWebSocketStabilization(): Promise<void> {
  let attempts = 0
  const maxAttempts = 10
  const delayMs = 1000

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    try {
      const balance = await orderService.getAccountBalance()

      // Verifica se pelo menos um preço está disponível
      let priceAvailable = false
      for (const symbol of TRADING_SYMBOLS.slice(0, 3)) { // Testa apenas os 3 primeiros
        const price = orderService.getCurrentPrice(symbol)
        if (price > 0) {
          priceAvailable = true
          break
        }
      }

      if (balance.availableBalance > 0 && priceAvailable) {
        console.log(`   ✅ WebSockets estabilizados após ${attempts + 1} tentativas`)
        return
      }
    } catch (error) {
      // Continua tentando
    }

    attempts++
    console.log(`   ⏳ Aguardando estabilização... (${attempts}/${maxAttempts})`)
  }

  console.warn("⚠️ WebSockets podem não estar totalmente estabilizados, continuando...")
}

// 🔄 FUNÇÃO PRINCIPAL DO BOT
async function runBotCycle(): Promise<void> {
  if (!bot) {
    console.error("❌ Bot não foi inicializado")
    return
  }

  try {
    // Atualiza offset de tempo
    await updateTimeOffset()

    // Executa o ciclo do bot
    await bot.run(TRADING_SYMBOLS)
  } catch (err: any) {
    console.error("❌ Erro no ciclo do bot:", err?.response?.data?.msg || err?.message || err)

    // Se for erro de WebSocket, tenta reconectar
    if (isWebSocketError(err)) {
      await handleWebSocketReconnection()
    }
  }
}

// 🔍 FUNÇÃO PARA DETECTAR ERROS DE WEBSOCKET
function isWebSocketError(error: any): boolean {
  const errorMsg = (error?.message || "").toLowerCase()
  const errorCode = error?.code

  return (
    errorMsg.includes("websocket") ||
    errorMsg.includes("connection") ||
    errorMsg.includes("econnreset") ||
    errorCode === "ECONNRESET" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "ETIMEDOUT"
  )
}

// 🔄 FUNÇÃO PARA RECONEXÃO DE WEBSOCKET
async function handleWebSocketReconnection(): Promise<void> {
  console.warn("🔄 Erro de conexão detectado, reinicializando WebSockets...")

  try {
    // Verifica se ainda temos os símbolos
    if (!TRADING_SYMBOLS || TRADING_SYMBOLS.length === 0) {
      console.log("📋 Recarregando símbolos...")
      TRADING_SYMBOLS = await loadTradingSymbols()
    }

    // Reinicializa WebSockets
    await orderService.initializeWebSockets(TRADING_SYMBOLS)

    // Aguarda estabilização
    await waitForWebSocketStabilization()

    console.log("✅ WebSockets reinicializados com sucesso")
  } catch (reconnectError: any) {
    console.error("❌ Falha ao reconectar WebSockets:", reconnectError?.message || reconnectError)
  }
}

// 📊 FUNÇÃO PARA MOSTRAR ESTATÍSTICAS
async function showBotStats(): Promise<void> {
  try {
    const positions = await orderService.getOpenPositions()
    const balance = await orderService.getAccountBalance()

    console.log("\n📊 Status do Bot:")
    console.log(`   📈 Posições abertas: ${positions.length}`)
    console.log(`   💰 Saldo disponível: $${balance.availableBalance?.toFixed(2) || "0.00"}`)
    console.log(`   📉 PnL não realizado: $${balance.totalUnrealizedProfit?.toFixed(2) || "0.00"}`)

    // Mostra preços atuais dos principais símbolos
    const mainSymbols = ["BTCUSDT", "ETHUSDT", "ADAUSDT"].filter(symbol =>
      TRADING_SYMBOLS.includes(symbol)
    )

    if (mainSymbols.length > 0) {
      console.log("   💱 Preços atuais:")
      for (const symbol of mainSymbols) {
        const price = orderService.getCurrentPrice(symbol)
        if (price > 0) {
          const pair = symbol.replace("USDT", "")
          console.log(`      ${pair}: $${price.toFixed(2)}`)
        }
      }
    }

    // Mostra posições abertas se houver
    if (positions.length > 0) {
      console.log("   📈 Posições abertas:")
      for (const pos of positions.slice(0, 5)) { // Mostra apenas as 5 primeiras
        const pnlPercent = ((orderService.getCurrentPrice(pos.symbol) - pos.entryPrice) / pos.entryPrice * 100)
        const side = pos.side === "BUY" ? "🟢" : "🔴"
        console.log(`      ${side} ${pos.symbol}: ${pos.positionAmt.toFixed(4)} @ $${pos.entryPrice.toFixed(2)} (${pnlPercent > 0 ? "+" : ""}${pnlPercent.toFixed(2)}%)`)
      }
      if (positions.length > 5) {
        console.log(`      ... e mais ${positions.length - 5} posições`)
      }
    }
  } catch (error: any) {
    console.error("❌ Erro ao obter estatísticas:", error?.message || error)
  }
}

// 🧹 FUNÇÃO DE CLEANUP
async function cleanup(): Promise<void> {
  console.log("\n🛑 Encerrando bot...")

  try {
    // Limpa intervals
    if (mainInterval) {
      clearInterval(mainInterval)
      mainInterval = null
    }
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }

    await positionService.stopPositionStream()
    console.log("✅ WS de posições fechado")

    // Fecha todas as conexões WebSocket
    await orderService.cleanup()
    console.log("✅ WebSockets fechados")

    // Opcional: Fechar todas as posições abertas
    const shouldClosePositions = process.env.CLOSE_POSITIONS_ON_EXIT === "true"
    if (shouldClosePositions) {
      console.log("🔒 Fechando posições abertas...")
      await orderService.closeAllOpenPositions()
      console.log("✅ Posições fechadas")
    }
  } catch (error: any) {
    console.error("❌ Erro no cleanup:", error?.message || error)
  }

  console.log("👋 Bot encerrado com sucesso")
  process.exit(0)
}

// 🚀 FUNÇÃO PRINCIPAL
// ; (async () => {
//   try {
//     // Inicializa o bot
//     bot = await initializeBot()

//     // Executa a primeira vez
//     console.log("\n🎯 Executando primeiro ciclo...")
//     await runBotCycle()

//     // Configura intervalo de execução (5 minutos)
//     console.log("\n⏰ Bot configurado para executar a cada 5 minutos")
//     mainInterval = setInterval(
//       async () => {
//         await runBotCycle()
//       },
//       5 * 60 * 1000,
//     )

//     // 📊 ESTATÍSTICAS PERIÓDICAS (a cada 15 minutos)
//     statsInterval = setInterval(
//       async () => {
//         await showBotStats()
//       },
//       15 * 60 * 1000,
//     )

//     // Mostra estatísticas iniciais
//     setTimeout(async () => {
//       await showBotStats()
//     }, 10000) // Após 10 segundos

//     console.log("✅ Bot está rodando! Use Ctrl+C para parar.")

//   } catch (error: any) {
//     console.error("❌ Falha crítica na inicialização:", error?.message || error)
//     process.exit(1)
//   }
// })()

// 🔧 HANDLERS DE ENCERRAMENTO
process.on("SIGINT", async () => {
  console.log("\n📡 Sinal SIGINT recebido (Ctrl+C)")
  await cleanup()
})

process.on("SIGTERM", async () => {
  console.log("\n📡 Sinal SIGTERM recebido")
  await cleanup()
})

// Tratamento de erros não capturados
process.on("uncaughtException", async (error) => {
  console.error("❌ Erro não capturado:", error)
  await cleanup()
})

process.on("unhandledRejection", async (reason, promise) => {
  console.error("❌ Promise rejeitada não tratada:", reason)
  console.error("Promise:", promise)
  await cleanup()
})

// 📊 HANDLER PARA MOSTRAR STATUS (opcional)
process.on("SIGUSR1", async () => {
  console.log("\n📊 Status solicitado via SIGUSR1:")
  await showBotStats()
})

export {
  initializeBot,
  showBotStats,
  cleanup
};

// Só executa main se rodar diretamente "npm run start" ou "ts-node index.ts"
if (require.main === module) {
  (async () => {
    bot = await initializeBot();
    await runBotCycle();

    mainInterval = setInterval(async () => {
      await runBotCycle();
    }, 5 * 60 * 1000);

    statsInterval = setInterval(async () => {
      await showBotStats();
    }, 15 * 60 * 1000);

    console.log('✅ Bot está rodando! Use Ctrl+C para parar.');
  })();
}