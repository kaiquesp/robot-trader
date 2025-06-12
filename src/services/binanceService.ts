import axios from 'axios';
import { BOT_TIMEFRAME } from '../configs/botConstants';

const BASE_URL = process.env.TESTNET === 'true'
  ? 'https://testnet.binancefuture.com'
  : 'https://fapi.binance.com';

export interface SymbolInfo {
  symbol: string;
  status: string;
  contractType: string;
  quoteAsset: string;
  // ... outros campos do exchangeInfo.symbols
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Converte intervalos ('15m','1h','1d' etc) em milissegundos. */
function intervalToMs(interval: string): number {
  const unit = interval.slice(-1);
  const num  = parseInt(interval.slice(0, -1), 10);
  switch (unit) {
    case 'm': return num * 60_000;
    case 'h': return num * 3_600_000;
    case 'd': return num * 86_400_000;
    default:  throw new Error(`Intervalo não suportado: ${interval}`);
  }
}

/** Busca todos os símbolos (exchangeInfo) */
export async function fetchAllSymbols(): Promise<SymbolInfo[]> {
  try {
    const resp = await axios.get<{ symbols: SymbolInfo[] }>(
      `${BASE_URL}/fapi/v1/exchangeInfo`
    );
    return resp.data.symbols;
  } catch {
    return [];
  }
}

/**
 * Retorna o Long-Short Ratio (histórico ou live),
 * com retry/backoff em 429 e fallback em 404.
 * Agora busca sempre, inclusive no Testnet.
 */
export async function fetchLongShortRatio(
  symbol: string,
  timestamp?: number
): Promise<number> {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const url    = `https://fapi.binance.com/futures/data/takerlongshortRatio`;
  const params: any = { symbol, period: '1h', limit: 1 };

  if (timestamp != null && Date.now() - timestamp <= THIRTY_DAYS_MS) {
    params.startTime = timestamp;
    params.endTime   = timestamp;
  }

  try {
    const res = await axios.get<{ buySellRatio: string }[]>(url, { params });
    const ratio = res.data[0]?.buySellRatio;
    return ratio ? parseFloat(ratio) : 0;
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      // Se 404, retorna 0 sem falhar
      if (err.response?.status === 404) {
        console.warn(`⚠️ fetchLongShortRatio 404 para ${symbol}, retornando 0`);
        return 0;
      }
      // Se 429, espera e tenta novamente
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers['retry-after'] || '1', 10);
        console.warn(`⚠️ 429 em fetchLongShortRatio para ${symbol}, retry-after=${retryAfter}s`);
        await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
        return fetchLongShortRatio(symbol, timestamp);
      }
    }
    throw err;
  }
}


/**
 * Retorna a Funding Rate mais recente ou null.
 */
export async function fetchFundingRate(symbol: string): Promise<number> {
  try {
    const resp = await axios.get(
      `https://fapi.binance.com/fapi/v1/fundingRate`,
      { params: { symbol, limit: 1 } }
    );
    const data = resp.data;
    if (Array.isArray(data) && data.length && data[0].fundingRate != null) {
      return parseFloat(data[0].fundingRate);
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * Retorna o Open Interest (histórico ou live), com fallback.
 */
export async function fetchOpenInterest(
  symbol: string,
  timestamp?: number
): Promise<number> {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  if (timestamp != null && Date.now() - timestamp <= THIRTY_DAYS_MS) {
    try {
      const res = await axios.get<any[]>(
        `https://fapi.binance.com/futures/data/openInterestHist`,
        { params: { symbol, period: '1h', startTime: timestamp, endTime: timestamp, limit: 1 } }
      );
      return parseFloat(res.data[0].sumOpenInterest);
    } catch {
      // fallback para live
    }
  }

  // live
  const live = await axios.get<{ openInterest: string }>(
    `https://fapi.binance.com/fapi/v1/openInterest`,
    { params: { symbol } }
  );
  return parseFloat(live.data.openInterest);
}

/**
 * Retorna klines entre startTime e endTime, se fornecidos.
 */
export async function fetchKlines(
  symbol:   string,
  interval: string,
  startTime?: number,
  endTime?:   number
): Promise<any[]> {
  const params: any = { symbol, interval: interval, limit: 1}
  if (startTime != null) params.startTime = startTime;
  if (endTime   != null) params.endTime   = endTime;
  
  return fetchWith429Retry<any[]>(`${BASE_URL}/fapi/v1/klines`, params);
}

/**
 * Busca todos os candles entre startTime e endTime, paginando.
 */
export async function fetchAllKlines(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const limit = 1000;
  let cursor = startTime;
  const all: Candle[] = [];

  while (cursor < endTime) {
    const slice = await axios
      .get<any[]>(`https://fapi.binance.com/fapi/v1/klines`, { params: { symbol, interval, startTime: cursor, limit } })
      .then(r => r.data);
    if (!slice.length) break;

    const chunk = slice.map(c => ({
      openTime: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5]
    }));
    all.push(...chunk);
    cursor = chunk[chunk.length - 1].openTime + intervalToMs(interval);
    if (slice.length < limit) break;
  }

  return all;
}

/** Faz GET e, se leve um 429, espera um pouquinho e tenta novamente */
async function fetchWith429Retry<T = any>(
  url: string,
  params: Record<string, any>,
  retries = 3,
  backoffMs = 500
): Promise<T> {
  try {
    const resp = await axios.get<T>(url, { params });
    return resp.data;
  } catch (err: any) {
    if (err.response?.status === 429 && retries > 0) {
      console.warn(`⚠️ 429 recebido, aguardando ${backoffMs}ms e retry...`);
      await new Promise(r => setTimeout(r, backoffMs));
      return fetchWith429Retry(url, params, retries - 1, backoffMs * 2);
    }
    throw err;
  }
}
