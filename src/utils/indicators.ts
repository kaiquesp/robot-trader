// src/utils/indicators.ts

/**
 * Exponential Moving Average
 */
export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prevEma: number | undefined;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(NaN);
    } else if (i === period - 1) {
      const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prevEma = sma;
      ema.push(sma);
    } else {
      const val = (data[i] - prevEma!) * k + prevEma!;
      ema.push(val);
      prevEma = val;
    }
  }

  return ema;
}


// RSI de Wilder
export function calculateRSI(closes: number[], period = 14): number {
  const len = closes.length;
  if (len < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  // soma ganhos/ perdas dos últimos period + 1 pontos
  for (let i = len - period; i < len; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    else losses += -delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Moving Average Convergence/Divergence
 */
export function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number; signal: number; histogram: number } {
  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);
  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLine[i] = (emaFast[i] || 0) - (emaSlow[i] || 0);
  }
  const signalLine = calculateEMA(macdLine.slice(slowPeriod - 1), signalPeriod);
  const idx = prices.length - 1;
  const macd = macdLine[idx];
  const signal = signalLine[signalLine.length - 1] || 0;
  return { macd, signal, histogram: macd - signal };
}

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
  prices: number[],
  period = 20,
  stdDevFactor = 2
): { middle: number; upper: number; lower: number } {
  const slice = prices.slice(-period);
  const middle = slice.reduce((sum, p) => sum + p, 0) / slice.length;
  const variance = slice.reduce((sum, p) => sum + (p - middle) ** 2, 0) / slice.length;
  const sd = Math.sqrt(variance);
  return { middle, upper: middle + stdDevFactor * sd, lower: middle - stdDevFactor * sd };
}

/**
 * Support & Resistance (min/max das últimas N velas)
 */
export function calculateSupportResistance(
  prices: number[],
  period = 20
): { support: number; resistance: number } {
  const slice = prices.slice(-period);
  return { resistance: Math.max(...slice), support: Math.min(...slice) };
}

/**
 * EMA Trend — compara EMA curta e longa
 */
export function calculateEMATrend(
  prices: number[],
  shortPeriod = 12,
  longPeriod = 26
): 'up' | 'down' | 'sideways' {
  const emaShort = calculateEMA(prices, shortPeriod);
  const emaLong = calculateEMA(prices, longPeriod);
  const idx = prices.length - 1;
  if ((emaShort[idx] || 0) > (emaLong[idx] || 0)) return 'up';
  if ((emaShort[idx] || 0) < (emaLong[idx] || 0)) return 'down';
  return 'sideways';
}

/**
 * Average True Range — volatilidade
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20
): number {
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const prevClose = closes[i - 1];
    tr.push(Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - prevClose),
      Math.abs(currentLow - prevClose)
    ));
  }
  // Média simples dos primeiros `period` TR
  let atr = tr.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  // Wilder smoothing
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

/**
 * Average Directional Index — força de tendência
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20
): number {
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  // Wilder smoothing
  const smooth = (arr: number[]) => {
    let sum = arr.slice(0, period).reduce((s, v) => s + v, 0);
    const sm: number[] = [sum];
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      sm.push(sum);
    }
    return sm;
  };
  const atr = smooth(tr);
  const pDM = smooth(plusDM);
  const mDM = smooth(minusDM);
  const pDI = pDM.map((v, i) => 100 * v / atr[i]);
  const mDI = mDM.map((v, i) => 100 * v / atr[i]);
  const dx = pDI.map((v, i) => 100 * Math.abs(v - mDI[i]) / (v + mDI[i] || 1));
  // ADX = Wilder smoothing de DX
  let adx = dx.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }
  return adx;
}

/**
 * Stochastic Oscillator
 */
export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  const k: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const sliceH = highs.slice(i - kPeriod + 1, i + 1);
    const sliceL = lows.slice(i - kPeriod + 1, i + 1);
    const highestH = Math.max(...sliceH);
    const lowestL = Math.min(...sliceL);
    k.push(((closes[i] - lowestL) / (highestH - lowestL || 1)) * 100);
  }
  // Smooth K to get D
  const d: number[] = [];
  for (let i = dPeriod - 1; i < k.length; i++) {
    const avg = k.slice(i - dPeriod + 1, i + 1).reduce((s, v) => s + v, 0) / dPeriod;
    d.push(avg);
  }
  return { k, d };
}

/**
 * Volume Weighted Average Price
 */
export function calculateVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): number {
  let cumPV = 0, cumVol = 0;
  for (let i = 0; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typical * volumes[i];
    cumVol += volumes[i];
  }
  return cumPV / (cumVol || 1);
}

/**
 * On-Balance Volume
 */
export function calculateOBV(closes: number[], volumes: number[]): number {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }
  return obv;
}

/**
 * Chaikin Money Flow
 */
export function calculateCMF(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period = 20
): number {
  const mfv: number[] = []; // money flow volume
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    mfv.push(((tp - lows[i]) - (highs[i] - tp)) / ((highs[i] - lows[i]) || 1) * volumes[i]);
  }
  const sumMFV = mfv.slice(-period).reduce((s, v) => s + v, 0);
  const sumVol = volumes.slice(-period).reduce((s, v) => s + v, 0);
  return sumMFV / (sumVol || 1);
}

/**
 * Cumulative Volume Delta (CVD)
 * Soma volumes de alta e subtrai volumes de baixa ao longo das velas.
 */
export function calculateCVD(
  opens: number[],
  closes: number[],
  volumes: number[]
): number[] {
  const cvd: number[] = [];
  let cum = 0;
  for (let i = 0; i < volumes.length; i++) {
    const delta = closes[i] >= opens[i] ? volumes[i] : -volumes[i];
    cum += delta;
    cvd.push(cum);
  }
  return cvd;
}
