import type { Server } from "node:http";
import type { SystemStatus } from "@/internal/handler/systemStatus";

const shutdownTimeoutMs = 30_000;

export function installLifecycle(status: SystemStatus, server: Server, onClose: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    status.draining = true;
    console.log(`收到 ${signal}，正在停止服务`);
    const forceTimer = setTimeout(() => {
      console.error("优雅退出超时，强制结束进程");
      process.exit(1);
    }, shutdownTimeoutMs);
    forceTimer.unref();
    server.close(() => {
      void onClose().finally(() => {
        clearTimeout(forceTimer);
        process.exit(0);
      });
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export function markStarted(status: SystemStatus): void {
  status.started = true;
  status.startedAt = new Date().toISOString();
}
