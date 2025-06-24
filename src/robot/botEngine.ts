import { FileService } from "src/services/fileService";
import { IndicatorService } from "src/services/indicatorsService";
import { PositionService } from "src/services/positionService";
import { BotController } from "./botController";
import { OrderServiceAdapter } from "./orderServiceAdapter";
import { PositionManager } from "./positionManager";
import { updateTimeOffset } from "../services/timeOffsetService"

export class BotEngine {
    private bot: BotController | null = null;
    private tradingSymbols: string[] = [];
    private mainInterval: NodeJS.Timeout | null = null;
    private statsInterval: NodeJS.Timeout | null = null;

    constructor(
        private positionService: PositionService,
        private orderService: OrderServiceAdapter,
        private positionManager: PositionManager,
        private indicatorService: IndicatorService,
        private fileService: FileService
    ) { }

    async start() {
        console.log('🚀 Inicializando BotEngine...');

        this.tradingSymbols = await this.loadTradingSymbols();
        await updateTimeOffset();

        console.log(`📡 Inicializando WebSockets para ${this.tradingSymbols.length} símbolos...`);
        await this.orderService.initializeWebSockets(this.tradingSymbols);

        console.log(`📡 Iniciando WebSocket de posições (PositionService)...`);
        await this.positionService.startPositionStream();

        console.log(`⏳ Aguardando estabilização dos WebSockets...`);
        await this.waitForWebSocketStabilization();

        const positions = await this.orderService.getOpenPositions();
        const balance = await this.orderService.getAccountBalance();

        console.log(`✅ WebSockets inicializados:`);
        console.log(`   📈 Posições: ${positions.length}`);
        console.log(`   💰 Saldo: $${balance.availableBalance?.toFixed(2) || "0.00"}`);

        this.bot = new BotController(
            { getOpenPositions: () => this.positionService.getOpenPositions() },
            this.indicatorService,
            {
                getKlines: this.orderService.getKlines,
                placeOrder: this.orderService.placeOrder,
                placeCloseOrder: this.orderService.placeCloseOrder,
                placeBracketOrder: this.orderService.placeBracketOrder,
                placeBracketOrderWithRetries: this.orderService.placeBracketOrderWithRetries,
                cancelOpenOrders: this.orderService.cancelOpenOrders,
                getAccountBalance: this.orderService.getAccountBalance,
                getAllOpenOrders: this.orderService.getAllOpenOrders,
                getRealizedPnl: this.orderService.getRealizedPnl,
            },
            this.positionManager,
            this.fileService
        );

        console.log("🎯 Bot inicializado com sucesso!");

        // 🚀 INICIA O CICLO EM BACKGROUND
        this.runCycle().catch(err => {
            console.error("❌ Erro no ciclo do bot:", err?.message || err);
        });

        this.mainInterval = setInterval(() => {
            this.runCycle().catch(err => {
                console.error("❌ Erro no ciclo do bot:", err?.message || err);
            });
        }, 5 * 60 * 1000);

        this.statsInterval = setInterval(() => this.showStats(), 15 * 60 * 1000);
    }



    async stop() {
        console.log("🛑 Parando BotEngine...");

        if (this.mainInterval) {
            clearInterval(this.mainInterval);
            this.mainInterval = null;
        }

        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }

        await this.positionService.stopPositionStream();
        console.log("✅ WS de posições fechado");

        await this.orderService.cleanup();
        console.log("✅ WebSockets fechados");

        this.bot = null;
        this.tradingSymbols = [];

        console.log("👋 BotEngine parado com sucesso.");
    }

    private async runCycle() {
        if (!this.bot) {
            console.error("❌ Bot não foi inicializado");
            return;
        }

        try {
            await updateTimeOffset();
            await this.bot.run(this.tradingSymbols);
        } catch (err: any) {
            console.error("❌ Erro no ciclo do bot:", err?.response?.data?.msg || err?.message || err);
        }
    }

    private async showStats() {
        const positions = await this.orderService.getOpenPositions();
        const balance = await this.orderService.getAccountBalance();

        console.log("\n📊 Status do Bot:");
        console.log(`   📈 Posições abertas: ${positions.length}`);
        console.log(`   💰 Saldo disponível: $${balance.availableBalance?.toFixed(2) || "0.00"}`);
        console.log(`   📉 PnL não realizado: $${balance.totalUnrealizedProfit?.toFixed(2) || "0.00"}`);
    }

    private async loadTradingSymbols(): Promise<string[]> {
        console.log("📋 Carregando símbolos de trading...");
        const symbols = await this.positionManager.getSymbols();

        if (!symbols || symbols.length === 0) {
            throw new Error("Nenhum símbolo encontrado no positionManager");
        }

        console.log(`   ✅ ${symbols.length} símbolos carregados: ${symbols.slice(0, 5).join(", ")}${symbols.length > 5 ? "..." : ""}`);
        return symbols;
    }

    private async waitForWebSocketStabilization(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 10;
        const delayMs = 1000;

        while (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));

            try {
                const balance = await this.orderService.getAccountBalance();

                let priceAvailable = false;
                for (const symbol of this.tradingSymbols.slice(0, 3)) {
                    const price = this.orderService.getCurrentPrice(symbol);
                    if (price > 0) {
                        priceAvailable = true;
                        break;
                    }
                }

                if (balance.availableBalance > 0 && priceAvailable) {
                    console.log(`   ✅ WebSockets estabilizados após ${attempts + 1} tentativas`);
                    return;
                }
            } catch {
                // tenta de novo
            }

            attempts++;
            console.log(`   ⏳ Aguardando estabilização... (${attempts}/${maxAttempts})`);
        }

        console.warn("⚠️ WebSockets podem não estar totalmente estabilizados, continuando...");
    }
}
