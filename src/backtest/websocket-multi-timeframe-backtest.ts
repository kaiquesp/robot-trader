import path from "path"
import fs from "fs"
import { generateMultiEquityHtmlReport } from "../reports/generateMultiEquityReport"
import { WebSocketBacktest } from "./websocket-backtest";

// timeframes que você quer testar
const TIMEFRAMES = ["1h", "4h", "1d"]
;(async () => {
  const backtester = new WebSocketBacktest()

  const jsonFiles: string[] = []

  for (const tf of TIMEFRAMES) {
    console.log(`\n===========================`)
    console.log(`⏳ Backtest WebSocket para ${tf}`)
    console.log(`===========================`)

    // Defina os valores desejados para collectionMinutes, maxSymbols e minCandles
    const collectionMinutes = 1440 // exemplo: 1 dia
    const maxSymbols = 10 // exemplo: 10 símbolos
    const minCandles = 100 // exemplo: mínimo de 100 candles

    const res = await backtester.runBacktestFor(tf, collectionMinutes, maxSymbols, minCandles)

    const jsonPath = path.join(__dirname, "..", "..", "data", "json", `backtest-ws-${tf}-${res.endDate}.json`)
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify(res, null, 2))

    console.log(`💾 Salvo JSON em: ${jsonPath}`)

    jsonFiles.push(jsonPath)

    // Delay entre timeframes para evitar sobrecarga
    if (TIMEFRAMES.indexOf(tf) < TIMEFRAMES.length - 1) {
      console.log("⏳ Aguardando 30 segundos antes do próximo timeframe...")
      await new Promise((resolve) => setTimeout(resolve, 30000))
    }
  }

  // gera gráfico HTML comparativo
  console.log(`\n🎨 Gerando gráfico comparativo multi-timeframe...`)

  generateMultiEquityHtmlReport(jsonFiles)

  console.log(`✅ Comparativo gerado em ./data/html/multi-equity-report.html`)
})()
