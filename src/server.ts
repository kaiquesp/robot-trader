// src/server.ts

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { PositionService } from './services/positionService';
import { orderService } from './services/orderService';
import { PositionManager } from './robot/positionManager';
import { indicatorService } from './services/indicatorsService';
import { fileService } from './services/fileService';
import { BotEngine } from './robot/botEngine';
import { OrderServiceAdapter } from './robot/orderServiceAdapter';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = process.env.PORT || 3001;
const WS_REALTIME_LOG_PORT = 3002;
const WS_FILE_LOG_PORT = 3003;
const WS_POSITIONS_PORT = 3004;

app.use(cors({
  origin: 'http://localhost:4200'
}));

app.use(bodyParser.json());

const positionService = new PositionService(
  'https://fapi.binance.com',
  process.env.BINANCE_API_KEY!,
  process.env.BINANCE_API_SECRET!
);

const positionManager = new PositionManager();

const orderServiceAdapter: OrderServiceAdapter = {
  initializeWebSockets: orderService.initializeWebSockets,
  placeOrder: orderService.placeOrder,
  placeCloseOrder: orderService.placeCloseOrder,
  placeBracketOrder: orderService.placeBracketOrder,
  placeBracketOrderWithRetries: orderService.placeBracketOrderWithRetries,
  cancelOpenOrders: orderService.cancelOpenOrders,
  getAccountBalance: orderService.getAccountBalance,
  getOpenPositions: orderService.getOpenPositions,
  getAllOpenOrders: orderService.getAllOpenOrders,
  getRealizedPnl: orderService.getRealizedPnl,
  cleanup: orderService.cleanup,
  getCurrentPrice: orderService.getCurrentPrice,
  getKlines: orderService.getKlines,
};

const botEngine = new BotEngine(
  positionService,
  orderServiceAdapter,
  positionManager,
  indicatorService,
  fileService
);

let botRunning = false;

// 🚀 Endpoint para iniciar o bot
app.post('/start', async (req: Request, res: Response) => {
  if (botRunning) {
    return res.status(400).json({ message: 'Bot já está rodando' });
  }

  try {
    await botEngine.start();
    botRunning = true;
    return res.json({ message: 'Bot iniciado com sucesso' });
  } catch (err: any) {
    console.error('❌ Erro ao iniciar o bot via API:', err);
    return res.status(500).json({ message: 'Erro ao iniciar o bot', error: err.message });
  }
});

// 🚀 Endpoint para parar o bot
app.post('/stop', async (req: Request, res: Response) => {
  if (!botRunning) {
    return res.status(400).json({ message: 'Bot não está rodando' });
  }

  try {
    await botEngine.stop();
    botRunning = false;
    return res.json({ message: 'Bot parado com sucesso' });
  } catch (err: any) {
    console.error('❌ Erro ao parar o bot via API:', err);
    return res.status(500).json({ message: 'Erro ao parar o bot', error: err.message });
  }
});

// 🚀 Endpoint para status
app.get('/status', (req: Request, res: Response) => {
  return res.json({
    running: botRunning,
    timestamp: new Date().toISOString()
  });
});

// --- WebSocket Server 1: Console.log em tempo real ---
const wsRealtimeLogServer = new WebSocketServer({ port: WS_REALTIME_LOG_PORT });
const realtimeClients = new Set<any>();

wsRealtimeLogServer.on('connection', (ws) => {
  console.log('🔗 Cliente conectado em /logs-realtime');
  realtimeClients.add(ws);

  ws.on('close', () => {
    console.log('❌ Cliente desconectado de /logs-realtime');
    realtimeClients.delete(ws);
  });
});

function broadcastRealtimeLog(message: string, type: 'log' | 'error' | 'warn' = 'log') {
  const payload = JSON.stringify({
    type,
    message,
    timestamp: new Date().toISOString()
  });

  for (const client of realtimeClients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
  const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  broadcastRealtimeLog(msg, 'log');
  originalLog(...args);
};

console.error = (...args: any[]) => {
  const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  broadcastRealtimeLog(msg, 'error');
  originalError(...args);
};

console.warn = (...args: any[]) => {
  const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  broadcastRealtimeLog(msg, 'warn');
  originalWarn(...args);
};

// --- WebSocket Server 2: Logs do arquivo trades.log ---
const wsFileLogServer = new WebSocketServer({ port: WS_FILE_LOG_PORT });
const fileLogClients = new Set<any>();

wsFileLogServer.on('connection', (ws) => {
  console.log('🔗 Cliente conectado em /logs-file');
  fileLogClients.add(ws);

  const logPath = path.join(__dirname, '../logs/trades.log');
  fs.readFile(logPath, 'utf-8', (err, data) => {
    if (!err) {
      const lines = data.split('\n').filter(line => line.trim() !== '');
      const lastLines = lines.slice(-100);
      ws.send(JSON.stringify({
        type: 'file-log-init',
        logs: lastLines
      }));
    }
  });

  ws.on('close', () => {
    console.log('❌ Cliente desconectado de /logs-file');
    fileLogClients.delete(ws);
  });
});

const tradesLogPath = path.join(__dirname, '../logs/trades.log');

fs.watchFile(tradesLogPath, { interval: 1000 }, (curr, prev) => {
  if (curr.size > prev.size) {
    const stream = fs.createReadStream(tradesLogPath, {
      start: prev.size,
      end: curr.size
    });

    let buffer = '';
    stream.on('data', chunk => {
      buffer += chunk.toString();
    });

    stream.on('end', () => {
      const newLines = buffer.split('\n').filter(line => line.trim() !== '');
      if (newLines.length > 0) {
        const payload = JSON.stringify({
          type: 'file-log-update',
          logs: newLines
        });

        for (const client of fileLogClients) {
          if (client.readyState === 1) {
            client.send(payload);
          }
        }
      }
    });
  }
});

// --- WebSocket Server 3: Positions & PnL Stats ---
const wsPositionsServer = new WebSocketServer({ port: WS_POSITIONS_PORT });
const positionsClients = new Set<any>();

wsPositionsServer.on('connection', async (ws) => {
  console.log('🔗 Cliente conectado em /positions-stats');
  positionsClients.add(ws);

  ws.on('close', () => {
    console.log('❌ Cliente desconectado de /positions-stats');
    positionsClients.delete(ws);
  });

  const interval = setInterval(async () => {
    try {
      const positions = await orderService.getOpenPositions();
      const now = Date.now();

      let totalPnl = 0;

      const positionsData = positions.map(pos => {
        const currentPrice = orderService.getCurrentPrice(pos.symbol);
        const pnl = pos.side === 'BUY'
          ? (currentPrice - pos.entryPrice) * pos.positionAmt
          : (pos.entryPrice - currentPrice) * Math.abs(pos.positionAmt);

        totalPnl += pnl;

        return {
          symbol: pos.symbol,
          side: pos.side,
          entryPrice: pos.entryPrice,
          positionAmt: pos.positionAmt,
          currentPrice,
          pnl: pnl.toFixed(2)
        };
      });

      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const realizedPnl = await orderService.getRealizedPnl(startOfDay.getTime());

      const payload = JSON.stringify({
        type: 'positions-stats',
        timestamp: new Date().toISOString(),
        totalOpenPositions: positions.length,
        positions: positionsData,
        totalPnl: totalPnl.toFixed(2),
        realizedPnlToday: realizedPnl.toFixed(2)
      });

      for (const client of positionsClients) {
        if (client.readyState === 1) {
          client.send(payload);
        }
      }
    } catch (err) {
      console.error('❌ Erro ao enviar positions-stats:', (err as any).message || err);
    }
  }, 5000);

  ws.on('close', () => {
    clearInterval(interval);
  });
});

// --- Inicializa REST API
app.listen(port, () => {
  console.log(`✅ API REST do Bot rodando em http://localhost:${port}`);
  console.log(`✅ WS /logs-realtime: ws://localhost:${WS_REALTIME_LOG_PORT}`);
  console.log(`✅ WS /logs-file: ws://localhost:${WS_FILE_LOG_PORT}`);
  console.log(`✅ WS /positions-stats: ws://localhost:${WS_POSITIONS_PORT}`);
});
