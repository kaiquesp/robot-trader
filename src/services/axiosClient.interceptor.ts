// src/services/axiosClient.ts
import axios from 'axios';

const axiosClient = axios.create({
  baseURL: process.env.TESTNET === 'true'
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com',
  timeout: 60000,
});

// Intercepta o REQUEST
axiosClient.interceptors.request.use((config) => {
//   console.log(`[Request] ${config.method?.toUpperCase()} ${config.url}`);
//   console.log('Headers:', config.headers);
//   console.log('Params:', config.params);
//   console.log('Data:', config.data);
  return config;
}, (error) => {
  console.error('[Request Error]', error);
  return Promise.reject(error);
});

// Intercepta o RESPONSE
axiosClient.interceptors.response.use((response) => {
//   console.log(`[Response] ${response.status} ${response.config.url}`);
//   console.log('Data:', response.data);
  return response;
}, (error) => {
  console.error(`[Response Error] ${error.response}`, error.response?.status, error.response?.data);
  return Promise.reject(error);
});

export default axiosClient;
