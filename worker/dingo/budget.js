import { DurableObject } from "cloudflare:workers";
import { initializeBudget, reserveBudget } from "./budget-store.js";

export class DingoTraktBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    initializeBudget(ctx.storage);
  }
  reserve(units) {
    return reserveBudget(this.ctx.storage, units);
  }
}
