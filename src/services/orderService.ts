// src/services/orderService.ts

import { UMFutures } from "@binance/futures-connector";
import { getTimeOffset } from "../utils/timeOffset";
import { fetchKlines } from "./binanceService";
import crypto from 'crypto';
import {
  fetchExchangeFilters,
  FullSymbolFilters
} from "../utils/exchangeFilters";
import {
  calculateQuantity,
  ceilQty
} from "../utils/quantize";
import "dotenv/config";
import { OpenPosition } from "../robot/positionManager";
import axios from 'axios';

const BASE_URL = process.env.TESTNET === "true"
  ? "https://testnet.binancefuture.com"
  : "https://fapi.binance.com";

const skipSymbols = new Set<string>();

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
    if (skipSymbols.has(symbol)) return;

    const fullFilters = await fetchExchangeFilters();
    const filters = fullFilters[symbol];
    if (!filters) return;

    const klines = await fetchKlines(symbol, "5m", 1);
    if (!klines.length) return;
    const lastClose = parseFloat(klines[0][4]);

    // 1) calcula qty já respeitando floor/ceil
    let quantity = calculateQuantity(
      this.tradeAmount,
      lastClose,
      filters.stepSize,
      side
    );
    let qtyNum = parseFloat(quantity);
    let notional = qtyNum * lastClose;

    // 2) se abaixo do minNotional, faz ceil para minNotional
    if (notional < filters.minNotional) {
      const rawMinQty = filters.minNotional / lastClose;
      const minQtyNum = ceilQty(rawMinQty, filters.stepSize);
      const prec = Math.round(-Math.log10(filters.stepSize));
      quantity = minQtyNum.toFixed(prec);
      console.warn(
        `⚠️ Ajuste p/ minNotional: ${symbol} (${notional.toFixed(2)} < ${filters.minNotional}) → qty=${quantity}`
      );
    }

    const offset = await getTimeOffset();

    try {
      await this.client.newOrder(
        symbol,
        side,
        "MARKET",
        { quantity, timestamp: Date.now() + offset, recvWindow: 60000 }
      );
      console.log(`✅ MARKET ${side} │ ${symbol} @ qty=${quantity}`);
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.code === -4131) {
        skipSymbols.add(symbol);
        console.error(`❌ PERCENT_PRICE em ${symbol}, pulando futuros.`);
        return;
      }
      if (data?.code === -2020) {
        skipSymbols.add(symbol);
        console.error(`❌ Unable to fill em ${symbol}, pulando futuros.`);
        return;
      }
      if (data?.code === -1111) {
        skipSymbols.add(symbol);
        console.error(`❌ Precision is over the maximum defined for this asset em ${symbol}, pulando futuros.`);
        return;
      }
      console.error(
        `❌ erro MARKET ${side} em ${symbol}:`,
        data ? `[${data.code}] ${data.msg}` : err.message
      );
      // throw err;
    }
  }

  /** Gera a assinatura HMAC-SHA256 sobre a query string */
  private sign(query: string): string {
    const secret = process.env.BINANCE_API_SECRET;
    if (!secret) {
      throw new Error("BINANCE_API_SECRET is not defined in environment variables.");
    }
    return crypto
      .createHmac('sha256', secret)
      .update(query)
      .digest('hex');
  }

 /**
   * Busca todas as posições abertas (positionAmt ≠ 0) na conta Futures
   * e retorna só symbol, side, entryPrice e quantidade.
   */
  async getOpenPositions(): Promise<OpenPosition[]> {
    // 1) monta timestamp + recvWindow
    const offset = await getTimeOffset();    // se não usar offset, remova esta linha
    const timestamp = Date.now() + offset;
    const recvWindow = 60_000;

    // 2) query string pra assinatura
    const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
    const signature = this.sign(query);

    // 3) chamada HTTP
    const resp = await axios.get<{ 
      symbol: string; 
      positionAmt: string; 
      entryPrice: string; 
    }[]>(
      `${BASE_URL}/fapi/v2/positionRisk`,
      {
        params: {
          timestamp,
          recvWindow,
          signature
        },
        headers: {
          'X-MBX-APIKEY': process.env.BINANCE_API_KEY
        }
      }
    );

    // 4) filtra e mapeia só posições !== 0
    const open: OpenPosition[] = resp.data
      .filter(p => parseFloat(p.positionAmt) !== 0)
      .map(p => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? 'BUY' : 'SELL',
        entryPrice: parseFloat(p.entryPrice),
        positionAmt: parseFloat(p.positionAmt)
      }));

    return open;
  }
}
