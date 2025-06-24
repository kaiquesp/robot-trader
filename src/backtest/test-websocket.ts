// test-websocket.ts
import 'dotenv/config';

console.log('🚀 Iniciando teste WebSocket...');

async function test() {
  try {
    console.log('✅ Teste executado com sucesso');
    
    // Teste básico de WebSocket
    const WebSocket = require('ws');
    console.log('📦 WebSocket importado:', typeof WebSocket);
    
    // Teste de variáveis de ambiente
    console.log('🔧 NUM_SYMBOLS:', process.env.NUM_SYMBOLS || 'não definido');
    console.log('🔧 COLLECTION_TIME_MINUTES:', process.env.COLLECTION_TIME_MINUTES || 'não definido');
    
  } catch (error) {
    console.error('❌ Erro no teste:', error);
  }
}

test();