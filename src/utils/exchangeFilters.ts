// src/utils/exchangeFilters.ts

import axios from 'axios';

export interface FullSymbolFilters {
  stepSize:    number;
  minQty:      number;
  tickSize:    number;
  minPrice:    number;
  minNotional: number;
}

const BASE_URL = process.env.TESTNET === 'true'
  ? 'https://testnet.binancefuture.com'
  : 'https://fapi.binance.com';

/**
 * Busca o exchangeInfo completo e extrai apenas os filtros relevantes
 * para cada símbolo USDT‐PERPETUAL.
 */
export async function fetchExchangeFilters(): Promise<Record<string, FullSymbolFilters>> {
  const result: Record<string, FullSymbolFilters> = {};

  let exchangeInfo: any;
  try {
    const resp = await axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`);
    exchangeInfo = resp.data;
  } catch (err: any) {
    console.error('❌ Não consegui baixar exchangeInfo:', err.message ?? err);
    return result;
  }

  for (const s of exchangeInfo.symbols) {
    if (s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL') {
      const lot      = s.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const priceF   = s.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const notional = s.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');
      if (lot && priceF && notional) {
        result[s.symbol] = {
          stepSize:    parseFloat(lot.stepSize),
          minQty:      parseFloat(lot.minQty),
          tickSize:    parseFloat(priceF.tickSize),
          minPrice:    parseFloat(priceF.minPrice),
          minNotional: parseFloat(notional.notional)
        };
      }
    }
  }

  return result;
}
