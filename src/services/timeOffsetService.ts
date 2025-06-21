// src/utils/timeOffsetService.ts

import axios from 'axios';

let timeOffset = 0; // em milissegundos

export async function updateTimeOffset(): Promise<void> {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/time');
    const serverTime = res.data.serverTime;
    const localTime = Date.now();
    timeOffset = serverTime - localTime;
    console.log(`⏱️ timeOffset atualizado: ${timeOffset} ms`);
  } catch (err: any) {
    console.error('❌ Erro ao atualizar timeOffset:', err.message);
  }
}

export function getTimeOffset(): number {
  return timeOffset;
}
