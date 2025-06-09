// import OpenAI from 'openai';
// import { Indicators } from './indicatorsService';
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// export class AIService {
//   async decide(symbol: string, ind: Indicators): Promise<'BUY'|'SELL'|null> {
//     const prompt = `
//       Você é um assistente de trading. Dados os seguintes indicadores para ${symbol}:
//       - RSI: ${ind.rsi}
//       - MACD histogram: ${ind.histogram}
//       - Bollinger bands lower/upper: ${ind.bollinger.lower}/${ind.bollinger.upper}
//       - EMA trend: ${ind.emaTrend}
//       - ATR: ${ind.atr}
//       - ADX: ${ind.adx}
//       - Stochastic K/D: ${ind.stochastic.k.slice(-1)[0]}/${ind.stochastic.d.slice(-1)[0]}
//       - VWAP: ${ind.vwap}
//       - OBV: ${ind.obv}
//       - CMF: ${ind.cmf}
//       - CVD: ${ind.cvd.slice(-1)[0]}
//       - LongShortRatio: ${ind.lsr}
//       - OpenInterest (proxy via CVD): ${ind.oi}
//       - FundingRate: ${ind.funding}
//       - Preço atual: ${ind.closes.slice(-1)[0]}

//       Com base nisso, indique apenas UMA de três ações: BUY, SELL ou HOLD, justificando brevemente (1 frase).`;
//     const resp = await openai.chat.completions.create({
//       model: 'gpt-4',
//       messages: [{ role: 'system', content: 'Você é um bot de trading.' },
//                  { role: 'user', content: prompt }]
//     });
//     const text = resp.choices[0].message?.content.trim() || '';
//     const match = text.match(/\b(BUY|SELL|HOLD)\b/);
//     return match ? (match[1] as any) : null;
//   }
// }
