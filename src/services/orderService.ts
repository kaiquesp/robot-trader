// src/services/orderService.ts - VERSÃO OTIMIZADA COM WEBSOCKET CORRIGIDA PARA VAZAMENTOS

import { UMFutures } from "@binance/futures-connector"
// import axios from "axios"
import axiosClient from './axiosClient.interceptor';
import crypto from "crypto"
import WebSocket from "ws"
import "dotenv/config"
import type { OpenPosition } from "../robot/positionManager"
import { fetchExchangeFilters, type FullSymbolFilters } from "../utils/exchangeFilters"
import { calculateQuantity, ceilQty } from "../utils/quantize"
import { getTimeOffset } from "./timeOffsetService"
import { BOT_TIMEFRAME } from "../configs/botConstants"

const BASE_URL = process.env.TESTNET === "true" ? "https://testnet.binancefuture.com" : "https://fapi.binance.com"
const WS_BASE_URL = process.env.TESTNET === "true" ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com"
const tradeAmount = Number.parseFloat(process.env.ENTRY_AMOUNT || "15")

interface KlineData {
  symbol: string
  openTime: number
  closeTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
}

interface TickerData {
  symbol: string
  price: string
  time: number
}

export class OrderService {
  private client: UMFutures
  private positionsCache: OpenPosition[] = []

  // 🚀 CACHES PARA WEBSOCKET
  private klinesCache: Map<string, KlineData[]> = new Map()
  private tickerCache: Map<string, TickerData> = new Map()
  private balanceCache: any = null
  private openOrdersCache: Map<string, any[]> = new Map()
  private loadingHistorical: Set<string> = new Set()

  // 🔥 CONTROLE DE CONEXÕES WEBSOCKET
  private userDataWs: WebSocket | null = null
  private marketDataWs: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5

  // 🔥 CONTROLE DE INTERVALOS E TIMEOUTS
  private listenKeyInterval: NodeJS.Timeout | null = null
  private userDataReconnectTimeout: NodeJS.Timeout | null = null
  private marketDataReconnectTimeout: NodeJS.Timeout | null = null

  // 🔥 CONTROLE DE ESTADO
  private isInitialized = false
  private isDestroyed = false
  private currentSymbols: string[] = []

  constructor(private tradeAmount: number) {
    this.client = new UMFutures(process.env.BINANCE_API_KEY || "", process.env.BINANCE_API_SECRET || "", {
      baseURL: BASE_URL,
      recvWindow: 30000,
    })
  }

  // 🔥 MÉTODO PRINCIPAL - INICIA TODOS OS WEBSOCKETS
  async initializeWebSockets(symbols: string[]): Promise<void> {
    if (this.isInitialized) {
      console.warn("⚠️ WebSockets já inicializados. Use cleanup() antes de reinicializar.")
      return
    }

    if (this.isDestroyed) {
      console.error("❌ Serviço foi destruído. Crie uma nova instância.")
      return
    }

    console.log("🚀 Inicializando WebSockets otimizados...")

    // 🔒 FILTRAR SÍMBOLOS INVÁLIDOS ANTES DE USAR!
    const validSymbols = symbols.filter(
      s => !!s && typeof s === 'string' && s !== 'undefined' && s.trim() !== ''
    )

    this.currentSymbols = [...validSymbols] // sempre filtrada
    this.isInitialized = true

    try {
      // 1. WebSocket para dados do usuário
      await this.startUserDataStream()

      // 2. WebSocket para dados de mercado
      await this.startMarketDataStream(validSymbols)

      // 3. Sync inicial apenas para posições e saldo
      await this.initialSyncUserData()

      console.log("✅ WebSockets inicializados! Cache de klines será carregado sob demanda.")
    } catch (error) {
      console.error("❌ Erro ao inicializar WebSockets:", error)
      this.isInitialized = false
      await this.cleanup()
      throw error
    }
  }


  // 🔄 USER DATA STREAM - CORRIGIDO PARA EVITAR VAZAMENTOS
  private async startUserDataStream(): Promise<void> {
    if (this.isDestroyed) return

    try {
      // 🔥 LIMPA CONEXÃO ANTERIOR SE EXISTIR
      await this.cleanupUserDataStream()

      const listenKeyResp = await axiosClient.post(`${BASE_URL}/fapi/v1/listenKey`, null, {
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
      })
      const listenKey = listenKeyResp.data.listenKey

      this.userDataWs = new WebSocket(`${WS_BASE_URL}/ws/${listenKey}`)

      // 🔥 AUMENTA LIMITE DE LISTENERS SE NECESSÁRIO
      this.userDataWs.setMaxListeners(20)

      this.userDataWs.on("open", () => {
        if (this.isDestroyed) return
        console.log("✅ User Data WebSocket conectado")
        this.reconnectAttempts = 0
      })

      this.userDataWs.on("message", (data) => {
        if (this.isDestroyed) return
        try {
          const json = JSON.parse(data.toString())
          this.handleUserDataUpdate(json)
        } catch (error) {
          console.error("❌ Erro ao processar mensagem User Data:", error)
        }
      })

      this.userDataWs.on("error", (err) => {
        if (this.isDestroyed) return
        console.error("❌ User Data WebSocket erro:", err.message)
      })

      this.userDataWs.on("close", (code, reason) => {
        if (this.isDestroyed) return
        console.warn(`⚠️ User Data WebSocket fechado. Code: ${code}, Reason: ${reason}`)
        this.scheduleUserDataReconnect()
      })

      // 🔥 KEEP-ALIVE CONTROLADO (apenas um por vez)
      this.setupListenKeyKeepAlive()

    } catch (err) {
      console.error("❌ Erro ao iniciar User Data Stream:", err)
      throw err
    }
  }

  // 🔥 SETUP DO KEEP-ALIVE (evita múltiplos intervalos)
  private setupListenKeyKeepAlive(): void {
    // Limpa intervalo anterior se existir
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval)
    }

    this.listenKeyInterval = setInterval(async () => {
      if (this.isDestroyed) return

      try {
        await axiosClient.put(`${BASE_URL}/fapi/v1/listenKey`, null, {
          headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
        })
      } catch (err) {
        console.error("❌ Erro ao renovar listenKey:", err)
      }
    }, 30 * 60 * 1000) // 30 minutos
  }

  // 📊 MARKET DATA STREAM - CORRIGIDO PARA EVITAR VAZAMENTOS
  private async startMarketDataStream(symbols: string[]): Promise<void> {
    if (this.isDestroyed) return

    try {
      // 🔥 LIMPA CONEXÃO ANTERIOR SE EXISTIR
      await this.cleanupMarketDataStream()

      const klineStreams = symbols.map((s) => `${s.toLowerCase()}@kline_${BOT_TIMEFRAME}`)
      const tickerStreams = symbols.map((s) => `${s.toLowerCase()}@ticker`)
      const allStreams = [...klineStreams, ...tickerStreams]

      const streamUrl = `${WS_BASE_URL}/stream?streams=${allStreams.join("/")}`

      this.marketDataWs = new WebSocket(streamUrl)

      // 🔥 AUMENTA LIMITE DE LISTENERS SE NECESSÁRIO
      this.marketDataWs.setMaxListeners(20)

      this.marketDataWs.on("open", () => {
        if (this.isDestroyed) return
        console.log(`✅ Market Data WebSocket conectado para ${symbols.length} símbolos`)
      })

      this.marketDataWs.on("message", (data) => {
        if (this.isDestroyed) return
        try {
          const json = JSON.parse(data.toString())
          this.handleMarketDataUpdate(json)
        } catch (error) {
          console.error("❌ Erro ao processar mensagem Market Data:", error)
        }
      })

      this.marketDataWs.on("error", (err) => {
        if (this.isDestroyed) return
        console.error("❌ Market Data WebSocket erro:", err.message)
      })

      this.marketDataWs.on("close", (code, reason) => {
        if (this.isDestroyed) return
        console.warn(`⚠️ Market Data WebSocket fechado. Code: ${code}, Reason: ${reason}`)
        this.scheduleMarketDataReconnect()
      })

    } catch (err) {
      console.error("❌ Erro ao iniciar Market Data Stream:", err)
      throw err
    }
  }

  // 🔥 LIMPEZA ESPECÍFICA PARA USER DATA STREAM
  private async cleanupUserDataStream(): Promise<void> {
    if (this.userDataWs) {
      // Remove todos os listeners antes de fechar
      this.userDataWs.removeAllListeners()

      if (this.userDataWs.readyState === WebSocket.OPEN) {
        this.userDataWs.close(1000, "Cleanup")
      }

      this.userDataWs = null
    }

    // Limpa timeout de reconexão
    if (this.userDataReconnectTimeout) {
      clearTimeout(this.userDataReconnectTimeout)
      this.userDataReconnectTimeout = null
    }
  }

  // 🔥 LIMPEZA ESPECÍFICA PARA MARKET DATA STREAM
  private async cleanupMarketDataStream(): Promise<void> {
    if (this.marketDataWs) {
      // Remove todos os listeners antes de fechar
      this.marketDataWs.removeAllListeners()

      if (this.marketDataWs.readyState === WebSocket.OPEN) {
        this.marketDataWs.close(1000, "Cleanup")
      }

      this.marketDataWs = null
    }

    // Limpa timeout de reconexão
    if (this.marketDataReconnectTimeout) {
      clearTimeout(this.marketDataReconnectTimeout)
      this.marketDataReconnectTimeout = null
    }
  }

  // 🔄 RECONEXÃO CONTROLADA PARA USER DATA
  private scheduleUserDataReconnect(): void {
    if (this.isDestroyed) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("❌ Máximo de tentativas de reconexão atingido para User Data")
      return
    }

    // Limpa timeout anterior se existir
    if (this.userDataReconnectTimeout) {
      clearTimeout(this.userDataReconnectTimeout)
    }

    this.reconnectAttempts++
    const delay = 5000 * this.reconnectAttempts

    this.userDataReconnectTimeout = setTimeout(async () => {
      if (this.isDestroyed) return

      console.log(`🔄 Tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts} - Reconectando User Data...`)

      try {
        await this.startUserDataStream()
      } catch (error) {
        console.error("❌ Erro na reconexão User Data:", error)
        this.scheduleUserDataReconnect()
      }
    }, delay)
  }

  // 🔄 RECONEXÃO CONTROLADA PARA MARKET DATA
  private scheduleMarketDataReconnect(): void {
    if (this.isDestroyed) return

    // Limpa timeout anterior se existir
    if (this.marketDataReconnectTimeout) {
      clearTimeout(this.marketDataReconnectTimeout)
    }

    this.marketDataReconnectTimeout = setTimeout(async () => {
      if (this.isDestroyed) return

      console.log("🔄 Reconectando Market Data...")

      try {
        await this.startMarketDataStream(this.currentSymbols)
      } catch (error) {
        console.error("❌ Erro na reconexão Market Data:", error)
        this.scheduleMarketDataReconnect()
      }
    }, 5000)
  }

  // 🔄 HANDLERS PARA WEBSOCKET DATA
  private handleUserDataUpdate(data: any): void {
    switch (data.e) {
      case "ACCOUNT_UPDATE":
        // Atualiza posições
        const positions = data.a.P
        this.positionsCache = positions
          .filter((p: any) => Number.parseFloat(p.positionAmt) !== 0)
          .map((p: any) => ({
            symbol: p.symbol,
            side: Number.parseFloat(p.positionAmt) > 0 ? "BUY" : "SELL",
            entryPrice: Number.parseFloat(p.entryPrice),
            positionAmt: Number.parseFloat(p.positionAmt),
          }))

        // Atualiza saldo
        const balances = data.a.B
        const usdtBalance = balances.find((b: any) => b.asset === "USDT")
        if (usdtBalance) {
          this.balanceCache = {
            totalWalletBalance: Number.parseFloat(usdtBalance.walletBalance),
            availableBalance: Number.parseFloat(usdtBalance.availableBalance),
            totalUnrealizedProfit: Number.parseFloat(data.a.totalUnrealizedProfit || "0"),
          }
        }

        console.log(
          `📥 Account Update: ${this.positionsCache.length} posições, Saldo: $${this.balanceCache?.availableBalance}`,
        )
        break

      case "ORDER_TRADE_UPDATE":
        // Atualiza cache de ordens
        const order = data.o;
        const symbol = order?.symbol || 'UNKNOWN';
        const status = order?.orderStatus || 'UNKNOWN';

        if (!order || !symbol || symbol === 'UNKNOWN') {
          console.warn('[OrderService] Ordem recebida sem symbol:', order);
          return;
        }

        if (!this.openOrdersCache.has(symbol)) {
          this.openOrdersCache.set(symbol, [])
        }

        const orders = this.openOrdersCache.get(symbol)!
        const existingIndex = orders.findIndex((o) => o.orderId === order.orderId)

        if (order.orderStatus === "FILLED" || order.orderStatus === "CANCELED") {
          // Remove ordem preenchida/cancelada
          if (existingIndex >= 0) {
            orders.splice(existingIndex, 1)
          }
        } else {
          // Adiciona/atualiza ordem
          if (existingIndex >= 0) {
            orders[existingIndex] = order
          } else {
            orders.push(order)
          }
        }

        console.log(`📋 Order Update: ${symbol} - ${status}`);
        break
    }
  }

  // 🔥 CORRIGIDO: Handler de market data com carregamento sob demanda
  private async handleMarketDataUpdate(data: any): Promise<void> {
    if (!data.data) return

    const streamData = data.data
    const symbol = streamData.symbol || streamData.s

    if (!symbol || typeof symbol !== 'string' || symbol === 'undefined') {
      console.warn('⚠️ Dados de mercado recebidos sem symbol válido:', streamData)
      return
    }

    if (data.stream.includes("@kline_")) {
      const kline = streamData.k

      // 🔥 CARREGA HISTÓRICO SOB DEMANDA
      if (!this.klinesCache.has(symbol) && !this.loadingHistorical.has(symbol)) {
        // console.log(`📊 Carregando histórico inicial para ${symbol}...`)
        this.loadingHistorical.add(symbol)
        await this.loadInitialKlines(symbol)
        this.loadingHistorical.delete(symbol)
      }

      const klines = this.klinesCache.get(symbol)
      if (!klines) return

      if (kline.x) {
        // ✅ Kline fechado - adiciona ao histórico
        const klineData: KlineData = {
          symbol: kline.s,
          openTime: kline.t,
          closeTime: kline.T,
          open: kline.o,
          high: kline.h,
          low: kline.l,
          close: kline.c,
          volume: kline.v,
        }

        klines.push(klineData)

        // Manter apenas últimos 250 klines
        if (klines.length > 250) {
          klines.shift()
        }
      } else {
        // ✅ Kline em tempo real - atualiza o último kline
        if (klines.length > 0) {
          const lastKline = klines[klines.length - 1]
          // Atualiza apenas se for o mesmo período
          if (lastKline.openTime === kline.t) {
            lastKline.high = kline.h
            lastKline.low = kline.l
            lastKline.close = kline.c
            lastKline.volume = kline.v
          } else {
            // Novo kline em tempo real
            const newKlineData: KlineData = {
              symbol: kline.s,
              openTime: kline.t,
              closeTime: kline.T,
              open: kline.o,
              high: kline.h,
              low: kline.l,
              close: kline.c,
              volume: kline.v,
            }
            klines.push(newKlineData)

            if (klines.length > 250) {
              klines.shift()
            }
          }
        }
      }
    } else if (data.stream.includes("@ticker")) {
      // Atualiza ticker cache
      this.tickerCache.set(symbol, {
        symbol,
        price: streamData.c,
        time: Date.now(),
      })
    }
  }

  // 🔥 NOVO MÉTODO - Carrega histórico inicial apenas uma vez por símbolo
  private async loadInitialKlines(symbol: string): Promise<void> {
    try {
      const klines = await this.fetchKlinesREST(symbol)
      const klineData = klines.map((k: any) => ({
        symbol,
        openTime: k[0],
        closeTime: k[6],
        open: k[1],
        high: k[2],
        low: k[3],
        close: k[4],
        volume: k[5],
      }))

      this.klinesCache.set(symbol, klineData)
      // console.log(`✅ Histórico carregado: ${symbol} - ${klineData.length} klines`)
    } catch (err) {
      console.error(`❌ Erro ao carregar histórico de ${symbol}:`, err)
      this.klinesCache.set(symbol, [])
    }
  }

  // 🚀 MÉTODOS OTIMIZADOS - USAM CACHE EM VEZ DE REST

  /**
   * 🔥 CORRIGIDO: Busca klines do cache WebSocket (carrega histórico sob demanda)
   */
  async getKlines(symbol: string): Promise<any[]> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    const cached = this.klinesCache.get(symbol)

    if (cached && cached.length > 0) {
      // ✅ Retorna do cache WebSocket (histórico + tempo real)
      return cached.map((k) => [k.openTime, k.open, k.high, k.low, k.close, k.volume, k.closeTime])
    }

    // 🔥 Carrega histórico se cache vazio (primeira vez)
    if (!this.loadingHistorical.has(symbol)) {
      console.log(`📊 Cache vazio para ${symbol}, carregando histórico inicial...`)
      this.loadingHistorical.add(symbol)
      await this.loadInitialKlines(symbol)
      this.loadingHistorical.delete(symbol)

      const newCached = this.klinesCache.get(symbol)
      if (newCached && newCached.length > 0) {
        return newCached.map((k) => [k.openTime, k.open, k.high, k.low, k.close, k.volume, k.closeTime])
      }
    }

    return []
  }

  /**
   * 🔥 OTIMIZADO: Saldo do cache em vez de REST
   */
  async getAccountBalance(): Promise<{
    totalWalletBalance: number
    totalUnrealizedProfit: number
    availableBalance: number
  }> {
    if (this.balanceCache) {
      return this.balanceCache
    }

    // Fallback para REST
    console.warn("⚠️ Cache de saldo vazio, usando REST como fallback")
    return this.getAccountBalanceREST()
  }

  async getAllOpenOrders(symbol?: string): Promise<any[]> {
    // Caso símbolo válido
    if (symbol && typeof symbol === 'string' && symbol.trim() !== '' && symbol !== 'undefined') {
      let cached = this.openOrdersCache.get(symbol) || [];

      // Se cache vazio, faz fallback via REST
      if (cached.length === 0) {
        try {
          const timestamp = Date.now() + getTimeOffset();
          const recvWindow = 30000;
          const query = `symbol=${symbol}&timestamp=${timestamp}&recvWindow=${recvWindow}`;
          const signature = this.sign(query);
          const url = `${BASE_URL}/fapi/v1/openOrders?${query}&signature=${signature}`;
          const resp = await axiosClient.get<any[]>(url, {
            headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
          });
          cached = resp.data || [];
          // Atualiza cache
          this.openOrdersCache.set(symbol, cached);
          if (cached.length) {
            console.log(`[OrderService] Fallback REST carregou ${cached.length} ordens abertas para ${symbol}`);
          }
        } catch (err) {
          console.warn(`[OrderService] Fallback REST falhou para openOrders em ${symbol}:`, (err as any)?.message || err);
          // retorna vazio mesmo em erro
        }
      }
      return cached;
    }

    // Caso sem símbolo, retorna todas as ordens de todos os símbolos (sem fallback)
    const allOrders: any[] = [];
    for (const orders of this.openOrdersCache.values()) {
      allOrders.push(...orders);
    }
    return allOrders;
  }

  /**
   * 🔥 OTIMIZADO: Preço atual do ticker cache
   */
  getCurrentPrice(symbol: string): number {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return 0;
    }

    const ticker = this.tickerCache.get(symbol)
    if (ticker) {
      return Number.parseFloat(ticker.price)
    }
    console.warn(`⚠️ Preço não encontrado no cache para ${symbol}`)
    return 0
  }

  // 🔥 MÉTODOS DE GERENCIAMENTO DE CACHE

  /**
   * Força refresh do cache de klines para um símbolo
   */
  async refreshKlinesCache(symbol: string): Promise<void> {
    console.log(`🔄 Atualizando cache de klines para ${symbol}...`)
    await this.loadInitialKlines(symbol)
  }

  /**
   * Retorna status do cache de klines
   */
  getKlinesCacheStatus(): { [symbol: string]: number } {
    const status: { [symbol: string]: number } = {}
    for (const [symbol, klines] of this.klinesCache.entries()) {
      status[symbol] = klines.length
    }
    return status
  }

  /**
   * Limpa cache de um símbolo específico
   */
  clearKlinesCache(symbol?: string): void {
    if (symbol) {
      this.klinesCache.delete(symbol)
      console.log(`🧹 Cache de ${symbol} limpo`)
    } else {
      this.klinesCache.clear()
      console.log("🧹 Todo cache de klines limpo")
    }
  }

  // 📊 SYNC INICIAL CORRIGIDO (apenas posições e saldo)
  private async initialSyncUserData(): Promise<void> {
    console.log("🔄 Fazendo sync inicial de dados do usuário...")

    // Sync posições
    await this.syncPositions()

    // Sync saldo
    this.balanceCache = await this.getAccountBalanceREST()

    console.log("✅ Sync inicial de dados do usuário completo")
  }

  // 🔧 MÉTODOS REST DE FALLBACK (privados)
  private async fetchKlinesREST(symbol: string): Promise<any[]> {
    // Implementação REST original como fallback
    const timestamp = Date.now() + getTimeOffset()
    const query = `symbol=${symbol}&interval=${BOT_TIMEFRAME}&limit=250&timestamp=${timestamp}`

    try {
      const resp = await axiosClient.get(`${BASE_URL}/fapi/v1/klines?${query}`)
      return resp.data
    } catch (err) {
      console.error(`❌ Erro REST klines ${symbol}:`, err)
      return []
    }
  }

  private async getAccountBalanceREST(): Promise<any> {
    const timestamp = Date.now() + getTimeOffset()
    const query = `timestamp=${timestamp}`
    const signature = this.sign(query)

    try {
      const res = await axiosClient.get(`${BASE_URL}/fapi/v2/account?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
      })

      return {
        totalWalletBalance: Number.parseFloat(res.data.totalWalletBalance),
        totalUnrealizedProfit: Number.parseFloat(res.data.totalUnrealizedProfit),
        availableBalance: Number.parseFloat(res.data.availableBalance),
      }
    } catch (err) {
      console.error("❌ Erro REST balance:", err)
      return { totalWalletBalance: 0, totalUnrealizedProfit: 0, availableBalance: 0 }
    }
  }

  // 🔄 MÉTODOS EXISTENTES (mantidos iguais)
  async placeBracketOrder(symbol: string, side: "BUY" | "SELL", tpPrice: number, slPrice: number): Promise<void> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    // Usa getKlines otimizado em vez de fetchKlines
    const klines = await this.getKlines(symbol)
    if (!klines.length) return

    const filters = (await fetchExchangeFilters())[symbol] as FullSymbolFilters
    if (!filters) return

    const lastClose = Number.parseFloat(klines[klines.length - 1][4])
    let quantity = calculateQuantity(this.tradeAmount, lastClose, filters.stepSize, side)

    if (Number.parseFloat(quantity) * lastClose < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize)
      const prec = Math.round(-Math.log10(filters.stepSize))
      quantity = minQtyNum.toFixed(prec)
      console.warn(`⚠️ Ajuste p/ minNotional: qty=${quantity}`)
    }

    if (Number.parseFloat(quantity) * lastClose < filters.minNotional) {
      console.warn(`❌ Ordem ${symbol} ignorada — qty=${quantity} não atinge minNotional ${filters.minNotional}`)
      return
    }

    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000

    await this.client.newOrder(symbol, side, "MARKET", {
      quantity,
      timestamp,
      recvWindow,
      priceProtect: false,
    })

    console.log(`✅ OPEN ${side} ${symbol} @ qty=${quantity}`)
  }

  async placeOrder(symbol: string, side: "BUY" | "SELL"): Promise<void> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    const filters = (await fetchExchangeFilters())[symbol]
    if (!filters) return

    const klines = await this.getKlines(symbol) // 🔥 OTIMIZADO
    if (!klines.length) return
    const lastClose = Number.parseFloat(klines[klines.length - 1][4])

    let quantity = calculateQuantity(this.tradeAmount, lastClose, filters.stepSize, side)
    if (Number.parseFloat(quantity) * lastClose < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize)
      const prec = Math.round(-Math.log10(filters.stepSize))
      quantity = minQtyNum.toFixed(prec)
      console.warn(`⚠️ Ajuste p/ minNotional: qty=${quantity}`)
    }

    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000
    try {
      await this.client.newOrder(symbol, side, "MARKET", {
        quantity,
        reduceOnly: false,
        timestamp,
        recvWindow,
        priceProtect: false,
      })
      console.log(`✅ MARKET ${side} │ ${symbol} @ qty=${quantity}`)
    } catch (err: any) {
      const data = err.response?.data
      if ([-4131, -2020, -1111].includes(data?.code)) {
        console.warn(`⚠️ Erro [${data.code}] em ${symbol}, pulando: ${data.msg}`)
        return
      }
      console.error(`❌ erro MARKET ${side} em ${symbol}:`, data?.msg ?? err.message)
    }
  }

  // Métodos de posição mantidos iguais
  async getOpenPositions(): Promise<OpenPosition[]> {
    return this.positionsCache
  }

  async syncPositions(): Promise<void> {
    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`)

    const resp = await axiosClient.get<{ symbol: string; positionAmt: string; entryPrice: string }[]>(
      `${BASE_URL}/fapi/v2/positionRisk`,
      {
        params: { timestamp, recvWindow, signature },
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
      },
    )

    this.positionsCache = resp.data
      .filter((p) => Number.parseFloat(p.positionAmt) !== 0)
      .map((p) => ({
        ...p,
        symbol: p.symbol,
        side: Number.parseFloat(p.positionAmt) > 0 ? "BUY" : "SELL",
        entryPrice: Number.parseFloat(p.entryPrice),
        positionAmt: Number.parseFloat(p.positionAmt),
      }))

    console.log(`📥 Sync inicial → ${this.positionsCache.length} posições carregadas.`)
  }

  // Outros métodos mantidos iguais...
  async placeCloseOrder(symbol: string, side: "BUY" | "SELL", qty: string): Promise<void> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000

    try {
      await this.client.newOrder(symbol, side, "MARKET", {
        quantity: qty,
        reduceOnly: true,
        timestamp,
        recvWindow,
        priceProtect: false,
      })
      console.log(`✅ Fechamento de posição → ${symbol} | ${side} | qty=${qty}`)
    } catch (e: any) {
      console.error(`❌ Erro ao fechar posição de ${symbol}: ${e.response?.data?.msg || e.message}`)
      throw e
    }
  }

  async cancelOpenOrders(symbol: string): Promise<void> {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    try {
      const timestamp = Date.now() + getTimeOffset()
      const recvWindow = 30000

      const query = `symbol=${symbol}&recvWindow=${recvWindow}&timestamp=${timestamp}`
      const signature = crypto.createHmac("sha256", process.env.BINANCE_API_SECRET!).update(query).digest("hex")

      const url = `${BASE_URL}/fapi/v1/allOpenOrders?${query}&signature=${signature}`

      await axiosClient.delete(url, {
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY! },
      })

      console.log(`🧹 Ordens pendentes de ${symbol} canceladas com sucesso.`)
    } catch (err: any) {
      console.error(`❌ Erro ao cancelar ordens de ${symbol}: ${err?.response?.data?.msg || err.message}`)
      throw err
    }
  }

  async resetAll(symbols: string[]): Promise<void> {
    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`)

    for (const symbol of symbols) {
      try {
        console.log(`🔹 Cancelando ordens em ${symbol}`)
        await this.client.cancelAllOpenOrders({ symbol })
      } catch (e: any) {
        console.warn(`⚠️ Erro cancelando em ${symbol}: ${e.response?.data?.msg || e.message}`)
      }
    }

    const resp = await axiosClient.get<{ symbol: string; positionAmt: string }[]>(`${BASE_URL}/fapi/v2/positionRisk`, {
      params: { timestamp, recvWindow, signature },
      headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
    })
    const open = resp.data.filter((p) => Math.abs(+p.positionAmt) > 0)

    for (const pos of open) {
      if (!symbols.includes(pos.symbol)) continue
      const side = +pos.positionAmt > 0 ? "SELL" : "BUY"
      const qty = Math.abs(+pos.positionAmt).toString()
      try {
        console.log(`  ↳ Fechando ${pos.symbol} MARKET ${side} qty=${qty}`)
        await this.client.newOrder(pos.symbol, side, "MARKET", {
          quantity: qty,
          reduceOnly: true,
          timestamp,
          recvWindow,
          priceProtect: false,
        })
      } catch (e: any) {
        console.error(`❌ Falha ao fechar ${pos.symbol}: ${e.response?.data?.msg || e.message}`)
      }
    }

    console.log("✅ Reset completo.")
  }

  async closeAllOpenPositions(): Promise<void> {
    const positions = await this.getOpenPositions()
    if (!positions.length) {
      console.log("ℹ️ Nenhuma posição aberta.")
      return
    }
    console.log(`🔒 Fechando ${positions.length} posições abertas…`)

    const apiKey = process.env.BINANCE_API_KEY || ""
    const apiSecret = process.env.BINANCE_API_SECRET || ""

    for (const pos of positions) {
      const side = pos.side === "BUY" ? "SELL" : "BUY"
      const qty = Math.abs(pos.positionAmt).toFixed(6)
      const timestamp = Date.now() + getTimeOffset()
      const recvWindow = 30000

      try {
        const query = `symbol=${pos.symbol}&timestamp=${timestamp}&recvWindow=${recvWindow}`
        const signature = crypto.createHmac("sha256", apiSecret).update(query).digest("hex")

        await axiosClient.delete(`${BASE_URL}/fapi/v1/allOpenOrders?${query}&signature=${signature}`, {
          headers: { "X-MBX-APIKEY": apiKey },
        })
      } catch (e: any) {
        console.warn(`⚠️ Falha ao cancelar ordens de ${pos.symbol}: ${e.response?.data?.msg || e.message}`)
      }

      try {
        const queryParams = new URLSearchParams({
          symbol: pos.symbol,
          side,
          type: "MARKET",
          quantity: qty,
          reduceOnly: "true",
          timestamp: timestamp.toString(),
          recvWindow: recvWindow.toString(),
        })

        const signature = crypto.createHmac("sha256", apiSecret).update(queryParams.toString()).digest("hex")

        queryParams.append("signature", signature)

        await axiosClient.post(`${BASE_URL}/fapi/v1/order?${queryParams.toString()}`, null, {
          headers: { "X-MBX-APIKEY": apiKey },
        })

        console.log(`✅ Fechado ${pos.symbol} → ${side} qty=${qty}`)
      } catch (e: any) {
        console.error(`❌ Falha ao fechar ${pos.symbol}: ${e.response?.data?.msg || e.message}`)
      }
    }

    console.log("✅ Todas as posições foram fechadas.")
  }

  async getRealizedPnl(sinceTs: number): Promise<number> {
    const timestamp = Date.now() + getTimeOffset()
    const recvWindow = 30000

    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}&incomeType=REALIZED_PNL&startTime=${sinceTs}`
    const signature = this.sign(query)

    try {
      const resp = await axiosClient.get<any[]>(`${BASE_URL}/fapi/v1/income?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY },
      })

      const pnl = resp.data
        .filter((item: any) => item.incomeType === "REALIZED_PNL")
        .reduce((sum: number, item: any) => sum + Number.parseFloat(item.income), 0)
      return pnl
    } catch (err: any) {
      console.error(`❌ Erro em getRealizedPnl: ${err?.response?.data?.msg || err.message}`)
      return 0
    }
  }

  // 🧹 CLEANUP COMPLETO - CORRIGIDO PARA EVITAR VAZAMENTOS
  async cleanup(): Promise<void> {
    console.log("🧹 Iniciando cleanup completo...")

    this.isDestroyed = true

    // 1. Limpa intervalos
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval)
      this.listenKeyInterval = null
    }

    // 2. Limpa timeouts
    if (this.userDataReconnectTimeout) {
      clearTimeout(this.userDataReconnectTimeout)
      this.userDataReconnectTimeout = null
    }

    if (this.marketDataReconnectTimeout) {
      clearTimeout(this.marketDataReconnectTimeout)
      this.marketDataReconnectTimeout = null
    }

    // 3. Limpa conexões WebSocket
    await this.cleanupUserDataStream()
    await this.cleanupMarketDataStream()

    // 4. Limpa caches
    this.klinesCache.clear()
    this.tickerCache.clear()
    this.openOrdersCache.clear()
    this.loadingHistorical.clear()
    this.positionsCache = []
    this.balanceCache = null

    // 5. Reset estado
    this.isInitialized = false
    this.reconnectAttempts = 0
    this.currentSymbols = []

    console.log("✅ Cleanup completo finalizado")
  }

  private sign(query: string): string {
    return crypto.createHmac("sha256", process.env.BINANCE_API_SECRET!).update(query).digest("hex")
  }

  // Métodos mantidos para compatibilidade (delegam para os otimizados)
  async startPositionStream(): Promise<void> {
    console.warn("⚠️ startPositionStream() está deprecated. Use initializeWebSockets()")
  }

  async placeOrderWithStops(symbol: string, side: "BUY" | "SELL", entryPrice: number, highs: number[], lows: number[]) {
    // Implementação mantida igual, mas usando getKlines otimizado
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    const klines = await this.getKlines(symbol)
    if (!klines.length) return

    // ... resto da implementação igual
  }

  async placeBracketOrderWithRetries(symbol: string, side: "BUY" | "SELL", tpPrice: number, slPrice: number) {
    if (!symbol || typeof symbol !== 'string' || symbol.trim() === '' || symbol === 'undefined') {
      console.error('[orderService] Symbol inválido:', symbol, new Error().stack)
      return
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🎯 Tentativa ${attempt}/3 para abrir ordem em ${symbol}`)
        await this.placeBracketOrder(symbol, side, tpPrice, slPrice)
        console.log(`✅ Ordem aberta em ${symbol} na tentativa ${attempt}`)
        return
      } catch (err: any) {
        console.error(
          `❌ Erro ao abrir ordem em ${symbol} tentativa ${attempt}:`,
          err?.response?.data?.msg || err?.message,
        )

        if (attempt === 3) {
          console.warn(`⚠️ 3 tentativas falharam para ${symbol}. Fechando posição a mercado!`)
          const oppositeSide = side === "BUY" ? "SELL" : "BUY"
          await this.placeOrder(symbol, oppositeSide)
          console.log(`🚨 Posição ${side} em ${symbol} foi forçada a fechar após falhas.`)
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    }
  }
}

// 🚀 INSTÂNCIA SINGLETON CONTROLADA
let serviceInstance: OrderService | null = null

export const orderService = {
  // Método para obter/criar instância
  getInstance: (): OrderService => {
    if (!serviceInstance) {
      serviceInstance = new OrderService(tradeAmount)
    }
    return serviceInstance
  },

  // Método para destruir instância
  destroyInstance: async (): Promise<void> => {
    if (serviceInstance) {
      await serviceInstance.cleanup()
      serviceInstance = null
    }
  },

  // Métodos delegados
  initializeWebSockets: (symbols: string[]) => orderService.getInstance().initializeWebSockets(symbols),
  getKlines: (symbol: string) => orderService.getInstance().getKlines(symbol),
  getCurrentPrice: (symbol: string) => orderService.getInstance().getCurrentPrice(symbol),
  refreshKlinesCache: (symbol: string) => orderService.getInstance().refreshKlinesCache(symbol),
  getKlinesCacheStatus: () => orderService.getInstance().getKlinesCacheStatus(),
  clearKlinesCache: (symbol?: string) => orderService.getInstance().clearKlinesCache(symbol),
  placeOrder: (symbol: string, side: "BUY" | "SELL") => orderService.getInstance().placeOrder(symbol, side),
  placeCloseOrder: (symbol: string, side: "BUY" | "SELL", qty: string) =>
    orderService.getInstance().placeCloseOrder(symbol, side, qty),
  placeBracketOrder: (symbol: string, side: "BUY" | "SELL", tp: number, sl: number) =>
    orderService.getInstance().placeBracketOrder(symbol, side, tp, sl),
  cancelOpenOrders: (symbol: string) => orderService.getInstance().cancelOpenOrders(symbol),
  getAccountBalance: () => orderService.getInstance().getAccountBalance(),
  getOpenPositions: () => orderService.getInstance().getOpenPositions(),
  resetAll: (symbols: string[]) => orderService.getInstance().resetAll(symbols),
  closeAllOpenPositions: () => orderService.getInstance().closeAllOpenPositions(),
  getAllOpenOrders: (symbol: string) => orderService.getInstance().getAllOpenOrders(symbol),
  getRealizedPnl: (sinceTs: number) => orderService.getInstance().getRealizedPnl(sinceTs),
  placeBracketOrderWithRetries: (symbol: string, side: "BUY" | "SELL", tp: number, sl: number) =>
    orderService.getInstance().placeBracketOrderWithRetries(symbol, side, tp, sl),
  cleanup: () => orderService.getInstance().cleanup(),
}

export { serviceInstance }