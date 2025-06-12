// src/scripts/reset.ts
import "dotenv/config";
import { OrderService } from "../services/orderService";

(async () => {
  console.log("🤖 Reset automático: cancelando ordens e fechando posições…");
  const svc = new OrderService(200);
  await svc.closeAllOpenPositions();
  console.log("🏁 Reset concluído.");
})();