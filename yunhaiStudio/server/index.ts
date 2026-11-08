import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assets,
  canvases,
  inspirations,
  plugins,
  profile,
  projects,
  skills,
  tasks,
} from "./data";
import type { Canvas, Task } from "./types";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

let sequence = 1000;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;
const now = () => "刚刚";

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "YunHai Studio API" });
});

app.get("/api/me", (_req, res) => {
  res.json(profile);
});

app.post("/api/auth/login", (req, res) => {
  const { account } = req.body ?? {};
  if (!account) {
    res.status(400).json({ message: "请输入账号" });
    return;
  }
  res.json({ token: "yunhai-demo-token", profile });
});

app.get("/api/inspirations", (_req, res) => {
  res.json(inspirations);
});

app.get("/api/projects", (_req, res) => {
  res.json(
    projects.map(({ episodes, ...rest }) => ({
      ...rest,
      episodeTotal: episodes.length,
    })),
  );
});

app.get("/api/projects/:id", (req, res) => {
  const project = projects.find((item) => item.id === req.params.id);
  if (!project) {
    res.status(404).json({ message: "项目不存在" });
    return;
  }
  res.json(project);
});

app.get("/api/canvases", (_req, res) => {
  res.json(
    canvases.map(({ nodes, edges, ...rest }) => ({
      ...rest,
      nodeCount: nodes.length || rest.nodeCount,
    })),
  );
});

app.post("/api/canvases", (req, res) => {
  const name = String(req.body?.name ?? "未命名画布");
  const canvas: Canvas = {
    id: nextId("canvas"),
    name,
    nodeCount: 0,
    updatedAt: now(),
    thumbnail: canvases[0]?.thumbnail ?? "",
    nodes: [],
    edges: [],
  };
  canvases.unshift(canvas);
  res.status(201).json(canvas);
});

app.get("/api/canvases/:id", (req, res) => {
  const canvas = canvases.find((item) => item.id === req.params.id);
  if (!canvas) {
    res.status(404).json({ message: "画布不存在" });
    return;
  }
  res.json(canvas);
});

app.put("/api/canvases/:id", (req, res) => {
  const canvas = canvases.find((item) => item.id === req.params.id);
  if (!canvas) {
    res.status(404).json({ message: "画布不存在" });
    return;
  }
  Object.assign(canvas, req.body ?? {}, { updatedAt: now() });
  canvas.nodeCount = canvas.nodes.length;
  res.json(canvas);
});

app.delete("/api/canvases/:id", (req, res) => {
  const index = canvases.findIndex((item) => item.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ message: "画布不存在" });
    return;
  }
  canvases.splice(index, 1);
  res.json({ ok: true });
});

app.post("/api/canvases/:id/assistant", (req, res) => {
  const canvas = canvases.find((item) => item.id === req.params.id);
  if (!canvas) {
    res.status(404).json({ message: "画布不存在" });
    return;
  }
  const prompt = String(req.body?.prompt ?? "").trim();
  canvas.nodes.push({
    id: nextId("node"),
    type: "text",
    x: 360 + Math.random() * 160,
    y: 300 + Math.random() * 120,
    width: 300,
    height: 200,
    title: "Agent 笔记",
    content: prompt || "继续拆解当前画布的故事线。",
    accent: "#06b6d4",
  });
  canvas.nodeCount = canvas.nodes.length;
  res.json({
    reply: [
      "收到，我按电影分镜的方式拆了一下：",
      "",
      "1. 先明确这场戏的情绪目标，再决定景别与运镜。",
      "2. 建议补一个环境全景，交代空间关系。",
      "3. 角色特写放在台词前半拍，留出呼吸。",
      "",
      "我已经在画布上新建了一个「Agent 笔记」节点，可以继续让我补参考图或生成分镜。",
    ].join("\n"),
  });
});

app.get("/api/assets", (_req, res) => {
  res.json(assets);
});

app.get("/api/skills", (_req, res) => {
  res.json(skills.map((skill) => ({ ...skill, installed: false })));
});

app.post("/api/skills/:id/toggle", (req, res) => {
  const skill = skills.find((item) => item.id === req.params.id);
  if (!skill) {
    res.status(404).json({ message: "技能不存在" });
    return;
  }
  res.json({ ...skill, installed: Boolean(req.body?.installed) });
});

app.get("/api/plugins", (_req, res) => {
  res.json(plugins);
});

app.post("/api/plugins/:id/toggle", (req, res) => {
  const plugin = plugins.find((item) => item.id === req.params.id);
  if (!plugin) {
    res.status(404).json({ message: "插件不存在" });
    return;
  }
  if (typeof req.body?.enabled === "boolean") plugin.enabled = req.body.enabled;
  res.json(plugin);
});

app.get("/api/tasks", (_req, res) => {
  res.json(tasks);
});

app.post("/api/tasks", (req, res) => {
  const task: Task = {
    id: nextId("task"),
    title: String(req.body?.title ?? "新建生成任务"),
    type: req.body?.type ?? "image",
    model: String(req.body?.model ?? "Seedream 图片"),
    status: "queued",
    progress: 0,
    credits: Number(req.body?.credits ?? 0.2),
    canvasName: String(req.body?.canvasName ?? "自由画布"),
    createdAt: now(),
  };
  tasks.unshift(task);
  const timer = setInterval(() => {
    if (task.status === "queued") {
      task.status = "running";
      return;
    }
    task.progress = Math.min(100, task.progress + 18);
    if (task.progress >= 100) {
      task.progress = 100;
      task.status = "completed";
      clearInterval(timer);
    }
  }, 900);
  res.status(201).json(task);
});

app.get("/api/settings", (_req, res) => {
  res.json({
    theme: "light",
    language: "zh-CN",
    defaultModel: "Seedream 图片",
    autoSave: true,
    storage: "本地数据目录",
  });
});

app.put("/api/settings", (req, res) => {
  res.json({ ...req.body });
});

const distDirectory = path.join(rootDirectory, "dist");
app.use(express.static(distDirectory));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(distDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`[YunHai] API 服务已启动: http://127.0.0.1:${port}`);
});
