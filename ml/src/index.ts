import { config } from "./config.js";
import { logger } from "./log.js";
import { buildServer } from "./server.js";

const cfg = config();
const app = await buildServer();

try {
  await app.listen({ port: cfg.ML_PORT, host: cfg.ML_HOST });
  logger.info({ port: cfg.ML_PORT }, "ml speech facade listening");
} catch (e) {
  logger.error({ err: (e as Error).message }, "failed to start");
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
