// src/backtest/services/InMemoryPositionService.ts

import { OpenPosition } from "../../services/positionService";

/**
 * Serviço em memória para gerenciar posições abertas no backtest.
 * Não implementa PositionService original para evitar conflitos de interface.
 */
export class InMemoryPositionService {
  private currentTime = 0;
  private positions: OpenPosition[] = [];

  /** Define o timestamp atual para simulação */
  setCurrentTime(timestamp: number): void {
    this.currentTime = timestamp;
  }

  /** Retorna o timestamp atual */
  getCurrentTime(): number {
    return this.currentTime;
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
    return this.positions;
  }

  /** Abre nova posição (invocado pelo OrderService) */
  openPosition(symbol: string, side: 'BUY' | 'SELL', entryPrice: number): void {
    this.positions.push({
      symbol,
      side,
      entryTime: this.currentTime,
      entryPrice,
    });
  }

  /** Fecha posição existente para o símbolo */
  closePosition(symbol: string): void {
    this.positions = this.positions.filter(p => p.symbol !== symbol);
  }
}