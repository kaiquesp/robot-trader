// src/utils/exchangeFilters.ts

import axios from 'axios';

/** Filtros essenciais para cada símbolo do mercado de futuros */
export interface FullSymbolFilters {
  stepSize:    number;
  minQty:      number;
  tickSize:    number;
  minPrice:    number;
  minNotional: number;
}

/** URL base para API REST da Binance (Futuros) */
const BASE_URL = process.env.TESTNET === 'true'
  ? 'https://testnet.binancefuture.com'
  : 'https://fapi.binance.com';

/** Cache simples na memória — expira após 5 minutos */
let _cache: Record<string, FullSymbolFilters> | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Baixa o exchangeInfo da Binance FUTURES e extrai os filtros importantes.
 * Utiliza cache simples para evitar chamadas repetidas.
 */
export async function fetchExchangeFilters(forceRefresh = false): Promise<Record<string, FullSymbolFilters>> {
  const now = Date.now();
  if (!forceRefresh && _cache && now < _cacheExpiry) {
    return _cache;
  }

  const result: Record<string, FullSymbolFilters> = {};

  let exchangeInfo: any;
  try {
    const resp = await axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`);
    exchangeInfo = resp.data;
  } catch (err: any) {
    console.error('❌ Não consegui baixar exchangeInfo:', err.message ?? err);
    // Retorna o último cache se houver
    if (_cache) return _cache;
    return result;
  }

  for (const s of exchangeInfo.symbols ?? []) {
    if (s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL') {
      const lot      = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const priceF   = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const notional = s.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
      if (lot && priceF && notional) {
        const filter: FullSymbolFilters = {
          stepSize:    Number(lot.stepSize)    || 0,
          minQty:      Number(lot.minQty)      || 0,
          tickSize:    Number(priceF.tickSize) || 0,
          minPrice:    Number(priceF.minPrice) || 0,
          minNotional: Number(notional.notional) || 0
        };
        // Garante que todos campos são válidos (>0)
        if (
          filter.stepSize > 0 && filter.minQty >= 0 &&
          filter.tickSize > 0 && filter.minPrice >= 0 &&
          filter.minNotional >= 0
        ) {
          result[s.symbol] = filter;
        }
      }
    }
  }

  // Atualiza cache
  _cache = result;
  _cacheExpiry = Date.now() + CACHE_TTL_MS;

  return result;
}

/** Força a limpeza do cache global */
export function clearExchangeFiltersCache() {
  _cache = null;
  _cacheExpiry = 0;
}
