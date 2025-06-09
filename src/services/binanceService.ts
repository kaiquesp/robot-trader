// src/services/binanceService.ts

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

/**
 * Busca todos os símbolos da Binance (exchangeInfo) e retorna o array de objetos.
 */
export async function fetchAllSymbols(): Promise<SymbolInfo[]> {
  try {
    const resp = await axios.get<{ symbols: SymbolInfo[] }>(
      `${BASE_URL}/fapi/v1/exchangeInfo`
    );
    return resp.data.symbols;
  } catch (err: any) {
    console.error('❌ Erro ao buscar todos os símbolos (exchangeInfo):', err.message ?? err);
    return [];
  }
}

export async function fetchLongShortRatio(symbol: string): Promise<number | null> {
  try {
    const resp = await axios.get(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio`,
      {
        params: {
          symbol,        // ex: "BTCUSDT"
          period: '5m',  // deve ser uma das enums: "5m","15m","30m","1h",…
          limit: 1       // só queremos o mais recente
        }
      }
    );
    const data = resp.data;
    if (Array.isArray(data) && data.length > 0 && data[0].longShortRatio != null) {
      return parseFloat(data[0].longShortRatio);
    }
    return null;
  } catch (err: any) {
    // Se quiser logar 400 sem poluir muito, trate aqui:
    if (err.response?.status === 400) {
      console.warn(`⚠️ Parâmetros inválidos em LongShortRatio para ${symbol}:`, err.response.data);
      return null;
    }
    console.error(`❌ Erro ao buscar LongShortRatio para ${symbol}:`, err.message ?? err);
    return null;
  }
}

/**
 * Retorna a Funding Rate mais recente para o símbolo,
 * ou null se não estiver disponível (erro 400/404 ou dados faltando).
 */
export async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const resp = await axios.get(
      `https://fapi.binance.com/fapi/v1/fundingRate`,
      { params: { symbol, limit: 1 } }
    );
    const data = resp.data;
    if (Array.isArray(data) && data.length > 0 && data[0].fundingRate != null) {
      return parseFloat(data[0].fundingRate);
    }
    return null;
  } catch (err: any) {
    if (err.response?.status === 400 || err.response?.status === 404) {
      console.warn(`⚠️ FundingRate não disponível para ${symbol}:`, err.response.data);
      return null;
    }
    console.error(`❌ Erro ao buscar FundingRate para ${symbol}:`, err.message ?? err);
    return null;
  }
}

/**
 * Retorna o Open Interest mais recente para o símbolo,
 * ou null se não estiver disponível (erro 400/404).
 */
export async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const resp = await axios.get(
      `https://fapi.binance.com/fapi/v1/openInterest`,
      { params: { symbol } }
    );
    // retorne o valor numérico de openInterest
    if (resp.data && resp.data.openInterest != null) {
      return parseFloat(resp.data.openInterest);
    }
    return null;
  } catch (err: any) {
    if (err.response?.status === 400 || err.response?.status === 404) {
      console.warn(`⚠️ OpenInterest não disponível para ${symbol}:`, err.response.data);
      return null;
    }
    console.error(`❌ Erro ao buscar OpenInterest para ${symbol}:`, err.message ?? err);
    return null;
  }
}

/**
 * Retorna as últimas velas (klines) para o símbolo, intervalo e limite fornecidos.
 */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<any[]> {
  try {
    const resp = await axios.get(
      `${BASE_URL}/fapi/v1/klines`,
      { params: { symbol, interval, limit } }
    );
    return resp.data;
  } catch (err: any) {
    console.error(`❌ Erro ao buscar klines para ${symbol}:`, err.message ?? err);
    return [];
  }
}
