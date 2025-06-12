// src/services/orderService.ts

import { UMFutures } from "@binance/futures-connector";
import axios from "axios";
import crypto from "crypto";
import "dotenv/config";
import { OpenPosition } from "../robot/positionManager";
import {
  fetchExchangeFilters
} from "../utils/exchangeFilters";
import {
  calculateQuantity,
  ceilQty
} from "../utils/quantize";
import { getTimeOffset } from "../utils/timeOffset";
import { BOT_TIMEFRAME } from "../configs/botConstants";
import { fetchKlines } from "./binanceService";

const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

export class OrderService {
  private client: UMFutures;

  constructor(private tradeAmount: number) {
    this.client = new UMFutures(
      process.env.BINANCE_API_KEY || "",
      process.env.BINANCE_API_SECRET || "",
      { baseURL: BASE_URL, recvWindow: 60000 }
    );
  }

  async placeOrder(symbol: string, side: "BUY" | "SELL"): Promise<void> {
    const filters = (await fetchExchangeFilters())[symbol];
    if (!filters) return;

    // 1) pega só o último candle de 5m
    let klines: any[] = [];
    try {
      klines = await fetchKlines(symbol, BOT_TIMEFRAME);
    } catch {
      klines = [];
    }

    if (!klines.length) return;
    const lastClose = parseFloat(klines[0][4]);

    // 2) calcula quantidade
    let quantity = calculateQuantity(this.tradeAmount, lastClose, filters.stepSize, side);
    let notional = parseFloat(quantity) * lastClose;
    if (notional < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose;
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize);
      const prec = Math.round(-Math.log10(filters.stepSize));
      quantity = minQtyNum.toFixed(prec);
      console.warn(
        `⚠️ Ajuste p/ minNotional: ${symbol} (${notional.toFixed(2)} < ${filters.minNotional}) → qty=${quantity}`
      );
    }

    // 3) envia MARKET
    const offset = await getTimeOffset();
    const timestamp = Date.now() + offset;
    const recvWindow = 60_000;

    try {
      const result = await this.client.newOrder(
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



  /**
   * Cancela todas as ordens abertas e zera posições para cada símbolo passado.
   */
  public async resetAll(symbols: string[]): Promise<void> {
    const offset = await getTimeOffset();
    const timestamp = Date.now() + offset;
    const recvWindow = 60_000;
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`);

    // 1) Cancelar todas as ordens abertas via REST
    for (const symbol of symbols) {
      try {
        console.log(`🔹 Cancelando ordens abertas em ${symbol}`);
        await this.client.cancelAllOpenOrders({ symbol });
      } catch (err: any) {
        console.warn(`⚠️ Erro ao cancelar ordens em ${symbol}: ${err.response?.data?.msg || err.message}`);
      }
    }

    // 2) Pegar posições abertas e fechar com MARKET + reduceOnly
    const resp = await axios.get<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
    }[]>(
      `${BASE_URL}/fapi/v2/positionRisk`,
      {
        params: { timestamp, recvWindow, signature },
        headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY }
      }
    );

    const openPositions = resp.data
      .filter(p => Math.abs(parseFloat(p.positionAmt)) > 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? "BUY" : "SELL",
        positionAmt: Math.abs(parseFloat(p.positionAmt))
      }));

    for (const pos of openPositions) {
      if (!symbols.includes(pos.symbol)) continue;
      const closeSide = pos.side === "BUY" ? "SELL" : "BUY";
      const qty = pos.positionAmt.toString();

      try {
        console.log(`  ↳ Fechando ${pos.symbol} via MARKET ${closeSide} qty=${qty}`);
        await this.client.newOrder(
          pos.symbol,
          closeSide,
          "MARKET",
          {
            quantity: qty,
            reduceOnly: true,
            timestamp,
            priceProtect: false,
            recvWindow
          }
        );
      } catch (err: any) {
        console.error(`❌ Falha ao fechar ${pos.symbol}: ${err.response?.data?.msg || err.message}`);
      }
    }

    console.log("✅ Reset completo.");
  }

  /** Assina query string para endpoints privados */
  private sign(query: string): string {
    const secret = process.env.BINANCE_API_SECRET!;
    return crypto.createHmac("sha256", secret).update(query).digest("hex");
  }

  /**
   * Busca todas as posições abertas (positionAmt ≠ 0) na conta Futures.
   */
  async getOpenPositions(): Promise<OpenPosition[]> {
    const offset = await getTimeOffset();
    const timestamp = Date.now() + offset;
    const recvWindow = 60_000;
    const signature = this.sign(`timestamp=${timestamp}&recvWindow=${recvWindow}`);

    const resp = await axios.get<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
    }[]>(
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

  async closeAllOpenPositions(): Promise<void> {
    const positions = await this.getOpenPositions();
    if (!positions.length) {
      console.log("ℹ️ Nenhuma posição aberta encontrada.");
      return;
    }

    console.log(`🔒 ZERANDO ${positions.length} posição(ões) e cancelando ordens…`);
    for (const pos of positions) {
      // antes: await this.client.cancelAllOpenOrders({ symbol: pos.symbol });
      try {
        await this.client.cancelAllOpenOrders(pos.symbol);
        console.log(`🗑️  Ordens abertas em ${pos.symbol} canceladas.`);
      } catch (err: any) {
        console.warn(
          `⚠️ Não foi possível cancelar ordens em ${pos.symbol}:`,
          err.response?.data?.msg ?? err.message
        );
      }

      // agora fecha a posição em MARKET+reduceOnly com priceProtect
      const side = pos.side === "BUY" ? "SELL" : "BUY";
      const quantity = Math.abs(pos.positionAmt ?? 0).toString();
      const offset = await getTimeOffset();
      const timestamp = Date.now() + offset;
      const recvWindow = 60_000;

      try {
        await this.client.newOrder(
          pos.symbol,
          side,
          "MARKET",
          {
            quantity,
            reduceOnly: true,
            priceProtect: false,
            timestamp,
            recvWindow
          }
        );
        console.log(`✅ Fechado ${pos.symbol} → ${side} qty=${quantity}`);
      } catch (err: any) {
        console.error(
          `❌ Falha ao fechar ${pos.symbol}:`,
          err.response?.data?.msg ?? err.message
        );
      }
    }

    console.log("✅ Todos os fechamentos e cancelamentos solicitados.");
  }
}
