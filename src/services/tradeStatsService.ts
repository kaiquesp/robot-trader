import axios from 'axios';
import crypto from 'crypto';
import { getTimeOffset } from './timeOffsetService';

export async function countTP_SL(
  symbol: string,
  sinceTs: number
): Promise<{ tpCount: number; slCount: number }> {
  const baseURL = process.env.TESTNET === 'true'
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';

  const apiKey = process.env.BINANCE_API_KEY || '';
  const apiSecret = process.env.BINANCE_API_SECRET || '';

  const timestamp = Date.now() + getTimeOffset();

  const queryString = `symbol=${symbol}&startTime=${sinceTs}&timestamp=${timestamp}`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');

  const url = `${baseURL}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

  const response = await axios.get(url, {
    headers: {
      'X-MBX-APIKEY': apiKey
    }
  });

  const trades = response.data;

  let tpCount = 0;
  let slCount = 0;

  for (const trade of trades) {
    const pnl = parseFloat(trade.realizedPnl);

    if (pnl > 0) {
      tpCount++;
    } else if (pnl < 0) {
      slCount++;
    }
  }

  return { tpCount, slCount };
}
