import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import type { Express } from "express";
import { failService } from "./response";
import { registerApiRoutes } from "./api";
import type { Service } from "@/internal/service/service";
import type { SystemStatus } from "./systemStatus";

export interface AppOptions {
  webRoot?: string;
  service: Service;
  status: SystemStatus;
  extraOrigins?: string[];
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (options.extraOrigins?.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, origin);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "64mb" }));

  const api = express.Router();
  registerApiRoutes(api, options.service, options.status);
  app.use("/api", api);

  if (options.webRoot && fs.existsSync(options.webRoot)) {
    const indexFile = path.join(options.webRoot, "index.html");
    app.use(express.static(options.webRoot, { index: false, maxAge: "1h" }));
    app.get("*", (_request, response, next) => {
      if (!fs.existsSync(indexFile)) {
        next();
        return;
      }
      response.sendFile(indexFile);
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    failService(response, error);
  });

  return app;
}
