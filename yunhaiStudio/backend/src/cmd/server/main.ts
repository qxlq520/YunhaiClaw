import fs from "node:fs";
import path from "node:path";
import { Database, migrateSchema } from "@/internal/database/database";
import { reconcilePrefixedIdSequences } from "@/internal/database/prefixedIds";
import { Repository } from "@/internal/repository/repository";
import { Service } from "@/internal/service/service";
import { createApp } from "@/internal/handler/app";
import { createSystemStatus } from "@/internal/handler/systemStatus";
import { installLifecycle, markStarted } from "./systemStatus";
import { configFromEnv, logger, setup } from "@/internal/logging/logging";

function resolveDataDir(): string {
  const configured = process.env.YUNHAI_DATA_DIR ?? process.env.TOONFLOW_DATA_DIR;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  return path.resolve(process.cwd(), "data");
}

function resolveWebRoot(): string | undefined {
  const configured = process.env.YUNHAI_WEB_ROOT;
  if (configured && configured.trim()) return path.resolve(configured.trim());
  const bundled = path.resolve(process.cwd(), "web-dist");
  return fs.existsSync(bundled) ? bundled : undefined;
}

function resolvePort(): number {
  const value = Number(process.env.PORT ?? process.env.YUNHAI_PORT ?? 8787);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("PORT 必须是 1-65535 之间的整数");
  return value;
}

async function main(): Promise<void> {
  const loggingConfig = configFromEnv();
  setup(loggingConfig);

  const dataDir = resolveDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const db = await Database.open({
    driver: process.env.DATABASE_DRIVER ?? "sqlite",
    dsn: process.env.DATABASE_URL,
    dataDir,
  });
  await migrateSchema(db);
  await reconcilePrefixedIdSequences(db);

  const repository = new Repository(db);
  const service = new Service(repository, dataDir);
  const status = createSystemStatus();
  const app = createApp({ webRoot: resolveWebRoot(), service, status });

  const port = resolvePort();
  const host = process.env.HOST ?? "127.0.0.1";
  const server = app.listen(port, host, () => {
    markStarted(status);
    logger.info("YunHai 服务已启动", { url: `http://${host}:${port}`, dataDir, dialect: db.dialect });
  });
  server.on("error", (error) => {
    logger.error("服务启动失败", { error: error.message });
    process.exit(1);
  });

  installLifecycle(status, server, async () => {
    await service.close();
  });
}

void main().catch((error: unknown) => {
  console.error("服务启动失败", error);
  process.exit(1);
});
