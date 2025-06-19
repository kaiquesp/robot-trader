// src/services/orderService.ts

import { UMFutures } from "@binance/futures-connector";
import axios from "axios";
import crypto from "crypto";
import "dotenv/config";
import { OpenPosition } from "../robot/positionManager";
import { fetchExchangeFilters, FullSymbolFilters } from "../utils/exchangeFilters";
import { calculateQuantity, ceilQty } from "../utils/quantize";
import { getTimeOffset } from "../utils/timeOffset";
import { BOT_TIMEFRAME } from "../configs/botConstants";
import { fetchKlines } from "./binanceService";
import { findRecentResistance, findRecentSupport } from "../utils/supportResistance";

const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

const tradeAmount = parseFloat(process.env.ENTRY_AMOUNT || '15');

export class OrderService {
  private client: UMFutures;

  constructor(private tradeAmount: number) {
    this.client = new UMFutures(
      process.env.BINANCE_API_KEY || "",
      process.env.BINANCE_API_SECRET || "",
      { baseURL: BASE_URL, recvWindow: 60000 }
    );
  }

  /**
   * Abre MARKET e em seguida dispara TAKE-PROFIT (LIMIT) e STOP-LOSS (STOP_MARKET), ambos reduceOnly.
   * @param symbol  Par, ex: "BTCUSDT"
   * @param side    "BUY" ou "SELL"
   * @param tpPrice Preço de take-profit
   * @param slPrice Preço de stop-loss
   */
  async placeBracketOrder(
    symbol: string,
    side: "BUY" | "SELL",
    tpPrice: number,
    slPrice: number
  ): Promise<void> {
    // 1) busca filtros
    const filters = (await fetchExchangeFilters())[symbol] as FullSymbolFilters;
    if (!filters) return;

    // 2) pega último close
    let klines: any[];
    try {
      klines = await fetchKlines(symbol, BOT_TIMEFRAME);
    } catch {
      klines = [];
    }
    if (!klines.length) return;
    const lastClose = parseFloat(klines[klines.length - 1][4]);

    // 3) calcula qty
    let quantity = calculateQuantity(this.tradeAmount, lastClose, filters.stepSize, side);
    if (parseFloat(quantity) * lastClose < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose;
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize);
      const prec = Math.round(-Math.log10(filters.stepSize));
      quantity = minQtyNum.toFixed(prec);
      console.warn(`⚠️ Ajuste p/ minNotional: qty=${quantity}`);
    }

    // 4) open MARKET
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;
    await this.client.newOrder(
      symbol,
      side,
      "MARKET",
      {
        quantity,
        timestamp,
        recvWindow,
        priceProtect: false
      }
    );
    console.log(`✅ OPEN  ${side}  ${symbol} @ qty=${quantity}`);

    // 5) direção oposta
    const exitSide = side === "BUY" ? "SELL" : "BUY";

    // 6) TAKE-PROFIT (LIMIT, reduceOnly)
    // await this.client.newOrder(
    //   symbol,
    //   exitSide,
    //   "LIMIT",
    //   {
    //     quantity,
    //     price: tpPrice.toFixed(Math.round(-Math.log10(filters.tickSize))),
    //     timeInForce: "GTC",
    //     reduceOnly: true,
    //     timestamp,
    //     recvWindow,
    //     priceProtect: false
    //   }
    // );
    // console.log(`🎯 TP     ${exitSide}  ${symbol} @ price=${tpPrice}`);

    // 7) STOP-LOSS (STOP_MARKET, reduceOnly) — precisa vir também o campo `price`
    await this.client.newOrder(
      symbol,
      exitSide,
      "STOP_MARKET",
      {
        quantity,
        stopPrice: slPrice.toFixed(Math.round(-Math.log10(filters.tickSize))),
        reduceOnly: true,
        timestamp,
        recvWindow,
        priceProtect: false
      }
    );
    console.log(`🛑 SL  ${exitSide} ${symbol} @ stopPrice=${slPrice}`);
  }

  async cancelOpenOrders(symbol: string): Promise<void> {
    try {
      const timestamp = Date.now() + getTimeOffset();
      const recvWindow = 10000; // tolerância de 10 segundos

      const query = `symbol=${symbol}&recvWindow=${recvWindow}&timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', process.env.BINANCE_API_SECRET!)
        .update(query)
        .digest('hex');

      const url = `${BASE_URL}/fapi/v1/allOpenOrders?${query}&signature=${signature}`;

      await axios.delete(url, {
        headers: {
          'X-MBX-APIKEY': process.env.BINANCE_API_KEY!
        }
      });

      console.log(`🧹 Ordens pendentes de ${symbol} canceladas com sucesso.`);
    } catch (err: any) {
      console.error(`❌ Erro ao cancelar ordens de ${symbol}: ${err?.response?.data?.msg || err.message}`);
      throw err;
    }
  }

  /**
   * Envia ordem MARKET simples (sem TP/SL).
   */
  async placeOrder(symbol: string, side: "BUY" | "SELL"): Promise<void> {
    const filters = (await fetchExchangeFilters())[symbol];
    if (!filters) return;

    // último candle
    let klines: any[];
    try {
      klines = await fetchKlines(symbol, BOT_TIMEFRAME);
    } catch {
      klines = [];
    }
    if (!klines.length) return;
    const lastClose = parseFloat(klines[0][4]);

    // calcula qty
    let quantity = calculateQuantity(this.tradeAmount, lastClose, filters.stepSize, side);
    if (parseFloat(quantity) * lastClose < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose;
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize);
      const prec = Math.round(-Math.log10(filters.stepSize));
      quantity = minQtyNum.toFixed(prec);
      console.warn(`⚠️ Ajuste p/ minNotional: qty=${quantity}`);
    }

    // envia MARKET
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;
    try {
      await this.client.newOrder(
        symbol,
        side,
        "MARKET",
        { quantity, reduceOnly: false, timestamp, recvWindow, priceProtect: false }
      );
      console.log(`✅ MARKET ${side} │ ${symbol} @ qty=${quantity}`);
    } catch (err: any) {
      const data = err.response?.data;
      if ([-4131, -2020, -1111].includes(data?.code)) {
        console.warn(`⚠️ Erro [${data.code}] em ${symbol}, pulando: ${data.msg}`);
        return;
      }
      console.error(`❌ erro MARKET ${side} em ${symbol}:`, data?.msg ?? err.message);
    }
  }

  /** Cancela ordens e zera posições nos símbolos informados */
  public async resetAll(symbols: string[]): Promise<void> {
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`);

    // 1) cancela REST
    for (const symbol of symbols) {
      try {
        console.log(`🔹 Cancelando ordens em ${symbol}`);
        await this.client.cancelAllOpenOrders({ symbol });
      } catch (e: any) {
        console.warn(`⚠️ Erro cancelando em ${symbol}: ${e.response?.data?.msg || e.message}`);
      }
    }

    // 2) fecha posições via REST
    const resp = await axios.get<{ symbol: string; positionAmt: string }[]>(
      `${BASE_URL}/fapi/v2/positionRisk`,
      {
        params: { timestamp, recvWindow, signature },
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
      }
    );
    const open = resp.data.filter(p => Math.abs(+p.positionAmt) > 0);

    for (const pos of open) {
      if (!symbols.includes(pos.symbol)) continue;
      const side = +pos.positionAmt > 0 ? "SELL" : "BUY";
      const qty = Math.abs(+pos.positionAmt).toString();
      try {
        console.log(`  ↳ Fechando ${pos.symbol} MARKET ${side} qty=${qty}`);
        await this.client.newOrder(
          pos.symbol,
          side,
          "MARKET",
          { quantity: qty, reduceOnly: true, timestamp, recvWindow, priceProtect: false }
        );
      } catch (e: any) {
        console.error(`❌ Falha ao fechar ${pos.symbol}: ${e.response?.data?.msg || e.message}`);
      }
    }

    console.log("✅ Reset completo.");
  }

  /** Retorna posições abertas */
  async getOpenPositions(): Promise<OpenPosition[]> {
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`);

    const resp = await axios.get<{ symbol: string; positionAmt: string; entryPrice: string }[]>(
      `${BASE_URL}/fapi/v2/positionRisk`,
      {
        params: { timestamp, recvWindow, signature },
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
      }
    );

    return resp.data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? "BUY" : "SELL",
        entryPrice: parseFloat(p.entryPrice),
        positionAmt: parseFloat(p.positionAmt)
      }));
  }

  /** Fecha todas as posições abertas (market + reduceOnly) */
  async closeAllOpenPositions(): Promise<void> {
    const positions = await this.getOpenPositions();
    if (!positions.length) {
      console.log("ℹ️ Nenhuma posição aberta.");
      return;
    }
    console.log(`🔒 Fechando ${positions.length} posições abertas…`);

    const apiKey = process.env.BINANCE_API_KEY || '';
    const apiSecret = process.env.BINANCE_API_SECRET || '';
    const baseUrl = process.env.TESTNET === "true"
      ? "https://testnet.binancefuture.com"
      : "https://fapi.binance.com";

    for (const pos of positions) {
      const side = pos.side === "BUY" ? "SELL" : "BUY";
      const qty = Math.abs(pos.positionAmt).toString();
      const timestamp = Date.now();
      const recvWindow = 60_000;

      // Cancelar todas as ordens abertas
      try {
        const query = `symbol=${pos.symbol}&timestamp=${timestamp}&recvWindow=${recvWindow}`;
        const signature = crypto
          .createHmac('sha256', apiSecret)
          .update(query)
          .digest('hex');

        await axios.delete(`${baseUrl}/fapi/v1/allOpenOrders?${query}&signature=${signature}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });
      } catch (e: any) {
        console.warn(`⚠️ Falha ao cancelar ordens de ${pos.symbol}: ${e.response?.data?.msg || e.message}`);
      }

      // Fechar posição com ordem MARKET reduceOnly
      try {
        const queryParams = new URLSearchParams({
          symbol: pos.symbol,
          side,
          type: 'MARKET',
          quantity: qty,
          reduceOnly: 'true',
          timestamp: timestamp.toString(),
          recvWindow: recvWindow.toString()
        });

        const signature = crypto
          .createHmac('sha256', apiSecret)
          .update(queryParams.toString())
          .digest('hex');

        queryParams.append('signature', signature);

        await axios.post(`${baseUrl}/fapi/v1/order?${queryParams.toString()}`, null, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });

        console.log(`✅ Fechado ${pos.symbol} → ${side} qty=${qty}`);
      } catch (e: any) {
        console.error(`❌ Falha ao fechar ${pos.symbol}: ${e.response?.data?.msg || e.message}`);
      }
    }

    console.log("✅ Todas as posições foram fechadas.");
  }

  async placeOrderWithStops(symbol: string, side: 'BUY' | 'SELL', entryPrice: number, highs: number[], lows: number[]) {
    const support = findRecentSupport(lows);
    const resistance = findRecentResistance(highs);

    let klines: any[];
    try {
      klines = await fetchKlines(symbol, BOT_TIMEFRAME);
    } catch {
      klines = [];
    }
    if (!klines.length) return;

    const filters = (await fetchExchangeFilters())[symbol] as FullSymbolFilters;
    if (!filters) return;

    const lastClose = parseFloat(klines[klines.length - 1][4]);

    let stopLoss = 0, takeProfit = 0;

    if (side === 'BUY') {
      stopLoss = support;
      takeProfit = entryPrice + 2 * (entryPrice - stopLoss);
    } else {
      stopLoss = resistance;
      takeProfit = entryPrice - 2 * (stopLoss - entryPrice);
    }

    const riskPct = Math.abs((entryPrice - stopLoss) / entryPrice);
    if (riskPct > 0.015) {
      console.log(`[${symbol}] STOP muito grande (${(riskPct * 100).toFixed(2)}%) — não abrir ordem.`);
      return;
    }

    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;

    const quantity = calculateQuantity(
      this.tradeAmount,
      lastClose,
      filters.stepSize,
      side
    );


    console.log(`[${symbol}] Abrindo ordem ${side}, Qty: ${quantity}, SL: ${stopLoss}, TP: ${takeProfit}`);

    // 1. MARKET
    await this.client.newOrder(
      symbol,
      side,
      "MARKET",
      {
        quantity,
        timestamp,
        recvWindow,
        priceProtect: false
      }
    );

    // 2. TAKE PROFIT
    await this.client.newOrder(
      symbol,
      side === 'BUY' ? 'SELL' : 'BUY',
      'TAKE_PROFIT_MARKET',
      {
        stopPrice: takeProfit.toFixed(4),
        closePosition: true,
        timestamp,
        recvWindow
      }
    );

    // 3. STOP LOSS
    await this.client.newOrder(
      symbol,
      side === 'BUY' ? 'SELL' : 'BUY',
      'STOP_MARKET',
      {
        stopPrice: stopLoss.toFixed(4),
        closePosition: true,
        timestamp,
        recvWindow
      }
    );

    console.log(`[${symbol}] Ordens SL/TP enviadas.`);
  }

  async placeBracketOrderWithRetries(symbol: string, side: 'BUY' | 'SELL', tpPrice: number, slPrice: number) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🎯 Tentativa ${attempt}/3 para abrir ordem em ${symbol}`);

        await this.placeBracketOrder(symbol, side, tpPrice, slPrice);

        console.log(`✅ Ordem aberta em ${symbol} na tentativa ${attempt}`);
        return; // sucesso → sai

      } catch (err: any) {
        console.error(`❌ Erro ao abrir ordem em ${symbol} tentativa ${attempt}:`, err?.response?.data?.msg || err?.message);

        if (attempt === 3) {
          console.warn(`⚠️ 3 tentativas falharam para ${symbol}. Fechando posição a mercado!`);

          const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';

          // Força fechamento imediato da posição
          await this.placeOrder(symbol, oppositeSide);

          console.log(`🚨 Posição ${side} em ${symbol} foi forçada a fechar após falhas.`);
        } else {
          // Espera um pouco antes de tentar de novo
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }


  async getAccountBalance(): Promise<{
    totalWalletBalance: number;
    totalUnrealizedProfit: number;
    availableBalance: number;
  }> {
    const apiKey = process.env.BINANCE_API_KEY || '';
    const apiSecret = process.env.BINANCE_API_SECRET || '';

    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(query)
      .digest('hex');

    const url = `${BASE_URL}/fapi/v2/account?${query}&signature=${signature}`;

    const res = await axios.get(url, {
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    });

    const data = res.data;

    const totalWalletBalance = parseFloat(data.totalWalletBalance);
    const totalUnrealizedProfit = parseFloat(data.totalUnrealizedProfit);
    const availableBalance = parseFloat(data.availableBalance);

    return {
      totalWalletBalance,
      totalUnrealizedProfit,
      availableBalance
    };
  }

  /** Retorna todas as ordens abertas (optionally por símbolo) */
  async getAllOpenOrders(symbol?: string): Promise<any[]> {
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;

    const params = symbol
      ? `symbol=${symbol}&timestamp=${timestamp}&recvWindow=${recvWindow}`
      : `timestamp=${timestamp}&recvWindow=${recvWindow}`;

    const signature = this.sign(params);

    try {
      const resp = await axios.get<any[]>(
        `${BASE_URL}/fapi/v1/openOrders?${params}&signature=${signature}`,
        {
          headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
        }
      );

      console.log(`📋 getAllOpenOrders → ${symbol || 'ALL'} → ${resp.data.length} ordens abertas.`);
      return resp.data;
    } catch (err: any) {
      console.error(`❌ Erro em getAllOpenOrders: ${err?.response?.data?.msg || err.message}`);
      return [];
    }
  }


  /** Consulta o PnL realizado (lucro/perda) desde uma data */
  async getRealizedPnl(sinceTs: number): Promise<number> {
    const timestamp = Date.now() + getTimeOffset();
    const recvWindow = 60_000;

    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}&incomeType=REALIZED_PNL&startTime=${sinceTs}`;
    const signature = this.sign(query);

    try {
      const resp = await axios.get<any[]>(
        `${BASE_URL}/fapi/v1/income?${query}&signature=${signature}`,
        {
          headers: {
            "X-MBX-APIKEY": process.env.BINANCE_API_KEY
          }
        }
      );

      const pnl = resp.data
        .filter((item: any) => item.incomeType === "REALIZED_PNL")
        .reduce((sum: number, item: any) => sum + parseFloat(item.income), 0);
      return pnl;
    } catch (err: any) {
      console.error(`❌ Erro em getRealizedPnl: ${err?.response?.data?.msg || err.message}`);
      return 0;
    }
  }


  /** Assina query string */
  private sign(query: string): string {
    return crypto
      .createHmac("sha256", process.env.BINANCE_API_SECRET!)
      .update(query)
      .digest("hex");
  }
}

const serviceInstance = new OrderService(tradeAmount);

export const orderService = {
  placeOrder: (symbol: string, side: 'BUY' | 'SELL') =>
    serviceInstance.placeOrder(symbol, side),

  placeBracketOrder: (symbol: string, side: 'BUY' | 'SELL', tp: number, sl: number) =>
    serviceInstance.placeBracketOrder(symbol, side, tp, sl),

  cancelOpenOrders: (symbol: string) =>
    serviceInstance.cancelOpenOrders(symbol),

  getAccountBalance: () =>
    serviceInstance.getAccountBalance(),

  getOpenPositions: () =>
    serviceInstance.getOpenPositions(),

  resetAll: (symbols: string[]) =>
    serviceInstance.resetAll(symbols),

  closeAllOpenPositions: () =>
    serviceInstance.closeAllOpenPositions(),

  placeOrderWithStops: (symbol: string, side: 'BUY' | 'SELL', entryPrice: number, highs: number[], lows: number[]) =>
    serviceInstance.placeOrderWithStops(symbol, side, entryPrice, highs, lows),

  placeBracketOrderWithRetries: (symbol: string, side: 'BUY' | 'SELL', tp: number, sl: number) =>
    serviceInstance.placeBracketOrderWithRetries(symbol, side, tp, sl),

  getAllOpenOrders: (symbol: string) =>
    serviceInstance.getAllOpenOrders(symbol),

  getRealizedPnl: (sinceTs: number) =>
    serviceInstance.getRealizedPnl(sinceTs),
};