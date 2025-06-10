// src/robot/positionManager.ts

import { Indicators } from '../models/Indicators';
import { fetchAllSymbols, SymbolInfo } from '../services/binanceService';

export interface OpenPosition {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  
}

export class PositionManager {
  /**
   * Busca todos os símbolos USDT‐Perpetual que estejam em TRADING na Binance.
   */
  async getSymbols(): Promise<string[]> {
    try {
      const symbolsInfo: SymbolInfo[] = await fetchAllSymbols();
      return symbolsInfo
        .filter(s =>
          s.status === 'TRADING' &&
          s.quoteAsset === 'USDT' &&
          (!s.contractType || s.contractType === 'PERPETUAL')
        )
        .map(s => s.symbol);
    } catch (error: any) {
      console.error('❌ Erro ao buscar símbolos da API:', error.message ?? error);
      return [];
    }
  }

  /**
   * Decide ação com base em:
   * - BUYSELLRatio ≤ 1 para BUY, > 1 para SELL
   * - open interest "subindo" (aproximado por CVD crescente)
   * - preço próximo do suporte (compra) ou da resistência (venda)
   */
  determineAction(symbol: string, ind: Indicators): 'BUY' | 'SELL' | null {
    const { lsr, support, resistance, closes, cvd } = ind;
    if (!closes || closes.length === 0 || !cvd || cvd.length === 0) {
      return null;
    }
    const price = closes[closes.length - 1];

    // NÃO temos previous OI, então usamos CVD para indicar "OI subindo"
    const cvdStart = cvd[0] ?? 0;
    const cvdNow   = cvd[cvd.length - 1] ?? 0;
    const oiRising = cvdNow > cvdStart;

    // Proximidade de suporte/resistência (1% de faixa)
    const proxThreshold = 0.01;
    const nearSupport     = support !== undefined && price <= support * (1 + proxThreshold);
    const nearResistance  = resistance !== undefined && price >= resistance * (1 - proxThreshold);

    // Regra de COMPRA
    if (
      lsr! <= 1 &&       // BUYSELL ≤ 1
      oiRising &&        // "open interest" subindo
      nearSupport        // próximo do suporte
    ) {
      return 'BUY';
    }

    // Regra de VENDA
    if (
      lsr! > 1 &&        // BUYSELL > 1
      oiRising &&        // "open interest" subindo
      nearResistance     // próximo da resistência
    ) {
      return 'SELL';
    }

    return null;
  }

  /**
   * Regra de fechamento a mercado:
   *  – Fecha BUY quando: lsr > 1, OI subindo e preço ≥ resistência
   *  – Fecha SELL quando: lsr ≤ 1, OI subindo e preço ≤ suporte
   */
  shouldClosePosition(pos: OpenPosition, ind: Indicators): boolean {
    const { lsr, support, resistance, closes, cvd } = ind;
    if (!closes || closes.length === 0) {
      return false;
    }
    const price = closes[closes.length - 1];
    const oiRising = !!cvd && cvd.length > 0 && cvd[cvd.length - 1] > cvd[0];

    if (pos.side === 'BUY') {
      // BUY: esperar razão >1, oi subindo e preço toca/resiste
      return lsr! > 1 && oiRising && resistance !== undefined && price >= resistance * 0.99;
    } else {
      // SELL: esperar razão ≤1, oi subindo e preço toca/suporta
      return lsr! <= 1 && oiRising && support !== undefined && price <= support * 1.01;
    }
  }
}
