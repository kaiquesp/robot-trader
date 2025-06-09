// src/utils/quantize.ts

/**
 * Arredonda para baixo ao múltiplo de stepSize.
 */
export function floorQty(value: number, stepSize: number): number {
  return Math.floor(value / stepSize) * stepSize;
}

/**
 * Arredonda para cima ao múltiplo de stepSize.
 */
export function ceilQty(value: number, stepSize: number): number {
  return Math.ceil(value / stepSize) * stepSize;
}

/**
 * Calcula a quantidade a ser enviada, já formatada para string,
 * usando ceil para BUY (para investir pelo menos o tradeAmount)
 * e floor para SELL (para não vender mais do que possui).
 *
 * @param tradeAmount Valor em USDT que você quer arriscar
 * @param lastPrice   Preço de fechamento mais recente
 * @param stepSize    Mínimo múltiplo de quantidade do símbolo
 * @param side        'BUY' ou 'SELL'
 */
export function calculateQuantity(
  tradeAmount: number,
  lastPrice: number,
  stepSize: number,
  side: 'BUY' | 'SELL'
): string {
  const rawQty = tradeAmount / lastPrice;

  const qtyNum = side === 'BUY'
    ? ceilQty(rawQty, stepSize)
    : floorQty(rawQty, stepSize);

  const precision = Math.round(-Math.log10(stepSize));
  return qtyNum.toFixed(precision);
}
