export interface Indicators {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  rsi: number;
  macd: number;
  signal: number;
  histogram: number;
  bollinger: {
    middle: number;
    upper: number;
    lower: number;
  };
  support: number;
  resistance: number;
  emaTrend: 'up' | 'down' | 'sideways';
  atr: number;
  adx: number;
  stochastic: { k: number[]; d: number[] };
  vwap: number;
  obv: number;
  cmf: number;
  lsr: number;
  oi: number;
  cvd: number[];
}