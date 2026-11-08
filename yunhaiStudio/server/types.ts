export type AssetType = "image" | "video" | "audio" | "text" | "model";

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  category: string;
  url: string;
  size: string;
  createdAt: string;
}

export interface CanvasNode {
  id: string;
  type: "image" | "video" | "text" | "config";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  image?: string;
  content?: string;
  accent?: string;
  meta?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export interface Canvas {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  thumbnail: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface Shot {
  id: string;
  no: number;
  title: string;
  status: "ready" | "running" | "pending";
  duration: string;
  prompt: string;
  dialogue: string;
  image: string;
}

export interface Episode {
  id: string;
  no: number;
  title: string;
  summary: string;
  shotCount: number;
  status: "done" | "running" | "pending";
  shots: Shot[];
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  kind: "短剧制作" | "电影预演" | "广告短片";
  episodeCount: number;
  updatedAt: string;
  cover: string;
  progress: number;
  episodes: Episode[];
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  installs: number;
  color: string;
  icon: string;
}

export interface Plugin {
  id: string;
  name: string;
  category: string;
  vendor: string;
  description: string;
  enabled: boolean;
  color: string;
  icon: string;
}

export interface Task {
  id: string;
  title: string;
  type: "video" | "image" | "text" | "agent";
  model: string;
  status: "running" | "completed" | "failed" | "queued";
  progress: number;
  credits: number;
  canvasName: string;
  createdAt: string;
}

export interface Inspiration {
  id: string;
  title: string;
  type: "image" | "video" | "text";
  tag: string;
  image: string;
  likes: number;
}

export interface Profile {
  id: string;
  name: string;
  handle: string;
  credits: number;
  plan: string;
  avatar: string;
}
