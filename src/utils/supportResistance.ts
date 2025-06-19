export function findRecentSupport(lows: number[]): number {
  for (let i = lows.length - 3; i >= 10; i--) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
      return lows[i];
    }
  }
  return lows[lows.length - 2];
}

export function findRecentResistance(highs: number[]): number {
  for (let i = highs.length - 3; i >= 10; i--) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
      return highs[i];
    }
  }
  return highs[highs.length - 2];
}
