import axios from 'axios';

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
 * Retorna o Long-Short Ratio (histórico ou live).
 */
export async function fetchLongShortRatio(
  symbol: string,
  timestamp?: number
): Promise<number> {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const url = `${BASE_URL}/futures/data/takerlongshortRatio`;
  const params: any = { symbol, period: '1h', limit: 1 };

  if (timestamp != null && Date.now() - timestamp <= THIRTY_DAYS_MS) {
    params.startTime = timestamp;
    params.endTime   = timestamp;
  }

  const res = await axios.get<{ buySellRatio: string }[]>(url, { params });
  return res && res.data[0] && res.data[0].buySellRatio ? parseFloat(res.data[0].buySellRatio) : 0;
}

/**
 * Retorna a Funding Rate mais recente ou null.
 */
export async function fetchFundingRate(symbol: string): Promise<number> {
  try {
    const resp = await axios.get(
      `${BASE_URL}/fapi/v1/fundingRate`,
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
        `${BASE_URL}/futures/data/openInterestHist`,
        { params: { symbol, period: '1h', startTime: timestamp, endTime: timestamp, limit: 1 } }
      );
      return parseFloat(res.data[0].sumOpenInterest);
    } catch {
      // fallback para live
    }
  }

  // live
  const live = await axios.get<{ openInterest: string }>(
    `${BASE_URL}/fapi/v1/openInterest`,
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
  const params: any = { symbol, interval };
  if (startTime != null) params.startTime = startTime;
  if (endTime   != null) params.endTime   = endTime;
  const res = await axios.get<any[]>(
    `${BASE_URL}/fapi/v1/klines`,
    { params }
  );
  return res.data;
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
      .get<any[]>(`${BASE_URL}/fapi/v1/klines`, { params: { symbol, interval, startTime: cursor, limit } })
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
