import axios from 'axios';

let timeOffset = 0;

export async function syncTimeOffset() {
  const res = await axios.get('https://fapi.binance.com/fapi/v1/time');
  const serverTime = res.data.serverTime;
  const localTime = Date.now();
  timeOffset = serverTime - localTime;
}

export function getTimeOffset() {
  return timeOffset;
}