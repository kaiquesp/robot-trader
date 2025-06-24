export interface OrderServiceAdapter {
    initializeWebSockets: (symbols: string[]) => Promise<void>; // <--- adiciona isso aqui
    placeOrder: (symbol: string, side: "BUY" | "SELL") => Promise<void>;
    placeCloseOrder: (symbol: string, side: "BUY" | "SELL", qty: string) => Promise<void>;
    placeBracketOrder: (symbol: string, side: "BUY" | "SELL", tp: number, sl: number) => Promise<void>;
    placeBracketOrderWithRetries: (symbol: string, side: "BUY" | "SELL", tp: number, sl: number) => Promise<void>;
    cancelOpenOrders: (symbol: string) => Promise<void>;
    getAccountBalance: () => Promise<{ totalWalletBalance: number; availableBalance: number; totalUnrealizedProfit: number }>;
    getOpenPositions: () => Promise<any[]>;
    getAllOpenOrders: (symbol: string) => Promise<any[]>;
    getRealizedPnl: (sinceTs: number) => Promise<number>;
    cleanup: () => Promise<void>;
    getCurrentPrice: (symbol: string) => number;
    
}