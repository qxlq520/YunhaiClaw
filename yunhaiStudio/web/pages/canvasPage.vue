<template>
  <div class="canvasPage">
    <header class="canvasTopBar">
      <div class="canvasTitleGroup">
        <button class="canvasIconButton" title="返回创作" @click="router.push('/create')">
          <component :is="icons.back" :size="16" />
        </button>
        <div class="canvasTitleBlock">
          <div class="canvasTitleRow">
            <strong>{{ canvas?.name ?? "自由画布" }}</strong>
            <span class="savedPill">
              <component :is="icons.check" :size="11" />
              已保存
            </span>
          </div>
          <span class="canvasMeta">{{ canvas?.nodeCount ?? 0 }} 个节点 · {{ canvas?.updatedAt ?? "刚刚" }}</span>
        </div>
      </div>

      <div class="canvasTopActions">
        <button class="canvasGhost">
          <component :is="icons.upload" :size="14" />
          导入第三方画布
        </button>
        <span class="canvasCost">
          <component :is="icons.coin" :size="13" />
          0.991 积分
        </span>
        <button class="canvasGhost">
          <component :is="icons.share" :size="14" />
          分享
        </button>
        <button class="canvasPrimary" @click="saveCanvas()">导出画布</button>
      </div>
    </header>

    <div class="canvasBody">
      <div
        ref="viewportRef"
        class="viewport"
        @pointerdown="startPan"
        @pointermove="onPointerMove"
        @pointerup="endPointer"
        @pointerleave="endPointer"
        @wheel.prevent="onWheel"
      >
        <div class="gridLayer" :style="gridStyle" />

        <div class="world" :style="worldStyle">
          <svg class="edgeLayer" :width="worldSize.width" :height="worldSize.height">
            <path
              v-for="edge in edgePaths"
              :key="edge.id"
              :d="edge.path"
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              stroke-width="1.5"
              stroke-dasharray="4 4"
            />
          </svg>

          <div
            v-for="node in nodes"
            :key="node.id"
            :class="['nodeCard', { isSelected: selectedId === node.id, isText: node.type === 'text' }]"
            :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
            @pointerdown.stop="startNodeDrag($event, node)"
          >
            <div class="nodeHeader">
              <span class="nodeTypeDot" :style="{ background: node.accent ?? '#8b93a7' }" />
              <span class="nodeTitle">{{ node.title }}</span>
              <component :is="nodeIcon(node.type)" :size="13" class="nodeTypeIcon" />
            </div>

            <div v-if="node.type === 'image' && node.image" class="nodeImage">
              <img :src="node.image" :alt="node.title" loading="lazy" draggable="false" />
            </div>
            <div v-else-if="node.type === 'text'" class="nodeText" :style="{ color: node.accent ?? '#e6e8ee' }">
              {{ node.content }}
            </div>
            <div v-else class="nodeConfig">
              <p v-for="line in (node.content ?? '').split('\n')" :key="line">{{ line }}</p>
            </div>

            <div v-if="node.meta" class="nodeFooter">{{ node.meta }}</div>
          </div>
        </div>

        <div class="canvasToolbar">
          <button v-for="tool in tools" :key="tool.label" class="canvasTool" @click="activeTool = tool.label">
            <component :is="tool.icon" :size="14" />
            {{ tool.label }}
          </button>
        </div>

        <div class="zoomControls">
          <button class="zoomButton" @click="zoomBy(-0.1)"><component :is="icons.minus" :size="14" /></button>
          <span class="zoomValue">{{ Math.round(scale * 100) }}%</span>
          <button class="zoomButton" @click="zoomBy(0.1)"><component :is="icons.plus" :size="14" /></button>
          <span class="zoomDivider" />
          <button class="zoomButton" @click="fitView"><component :is="icons.maximize" :size="14" /></button>
        </div>

        <div class="minimap">
          <div class="minimapInner">
            <span
              v-for="node in nodes"
              :key="node.id"
              class="minimapNode"
              :style="minimapStyle(node)"
            />
          </div>
          <span class="minimapViewport" :style="minimapViewportStyle" />
        </div>
      </div>

      <aside class="assistantPanel">
        <div class="assistantHeader">
          <div class="assistantIdentity">
            <span class="assistantAvatar">海</span>
            <div>
              <strong>小海</strong>
              <span class="tiny">画布助手 · 已连接</span>
            </div>
          </div>
          <div class="assistantHeaderActions">
            <button class="canvasIconButton"><component :is="icons.history" :size="15" /></button>
            <button class="canvasIconButton"><component :is="icons.more" :size="15" /></button>
          </div>
        </div>

        <div ref="messageRef" class="assistantMessages scrollArea">
          <div v-for="message in messages" :key="message.id" :class="['message', message.role]">
            <div v-if="message.role === 'assistant'" class="messageAvatar">海</div>
            <div class="messageBubble">
              <p v-for="(line, index) in message.content.split('\n')" :key="index">{{ line || "\u00a0" }}</p>
            </div>
          </div>
          <div v-if="sending" class="message assistant">
            <div class="messageAvatar">海</div>
            <div class="messageBubble typing">
              <span /><span /><span />
            </div>
          </div>
        </div>

        <div class="assistantComposer">
          <div class="assistantQuickRow">
            <button class="assistantChip" @click="insertQuick('帮我把这张图拆成 6 个分镜镜头')">
              <component :is="icons.sparkles" :size="12" />
              拆解分镜
            </button>
            <button class="assistantChip" @click="insertQuick('生成一个同风格的反打镜头')">
              <component :is="icons.image" :size="12" />
              生成同风格
            </button>
          </div>
          <textarea
            v-model="draft"
            class="assistantInput"
            rows="2"
            placeholder="输入操作指令，使用 @ 引用画布节点、用 / 引用技能。"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <div class="assistantBar">
            <button class="assistantModel">
              <span class="modelDot" />
              Gemini 3.8
              <component :is="icons.chevron" :size="12" />
            </button>
            <button class="assistantSend" :disabled="!draft.trim() || sending" @click="sendMessage">
              <component :is="icons.send" :size="15" />
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Coins,
  Crop,
  Film,
  Image as ImageIcon,
  Layers,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Share2,
  Sparkles,
  SquareDashed,
  TextCursorInput,
  Type,
  Upload,
  Wand2,
  History,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface CanvasNode {
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

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

interface CanvasDetail {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  thumbnail: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface Message {
  id: number;
  role: "assistant" | "user";
  content: string;
}

const icons = {
  back: ArrowLeft,
  check: Check,
  upload: Upload,
  coin: Coins,
  share: Share2,
  minus: Minus,
  plus: Plus,
  maximize: Maximize,
  history: History,
  more: MoreHorizontal,
  sparkles: Sparkles,
  image: ImageIcon,
  chevron: ChevronDown,
  send: Send,
};

const tools = [
  { label: "区域标注", icon: Crop },
  { label: "文字编辑", icon: Type },
  { label: "画面调整", icon: Settings2 },
  { label: "镜头", icon: Film },
  { label: "画布设置", icon: Layers },
  { label: "图片工具", icon: Wand2 },
];

const route = useRoute();
const router = useRouter();
const viewportRef = ref<HTMLElement>();
const messageRef = ref<HTMLElement>();
const canvas = ref<CanvasDetail | null>(null);
const nodes = ref<CanvasNode[]>([]);
const edges = ref<CanvasEdge[]>([]);
const selectedId = ref("");
const activeTool = ref("区域标注");
const scale = ref(0.72);
const pan = reactive({ x: 40, y: 30 });
const draft = ref("");
const sending = ref(false);
const messages = ref<Message[]>([
  {
    id: 1,
    role: "assistant",
    content:
      "我看了下当前画布：6 个节点，主线是「开场旁白 → 沈云设定 → 城楼对峙」。\n\n需要我补分镜、统一角色一致性，还是直接生成镜头视频？",
  },
]);
const dragState = reactive({
  mode: "" as "" | "pan" | "node",
  pointerId: 0,
  startX: 0,
  startY: 0,
  panX: 0,
  panY: 0,
  nodeId: "",
  nodeX: 0,
  nodeY: 0,
});

const worldSize = { width: 1800, height: 1400 };

const worldStyle = computed(() => ({
  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale.value})`,
}));

const gridStyle = computed(() => {
  const size = 24 * scale.value;
  return {
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
  };
});

const edgePaths = computed(() =>
  edges.value
    .map((edge) => {
      const from = nodes.value.find((node) => node.id === edge.from);
      const to = nodes.value.find((node) => node.id === edge.to);
      if (!from || !to) return null;
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const curve = Math.max(60, Math.abs(x2 - x1) * 0.5);
      return { id: edge.id, path: `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}` };
    })
    .filter((item): item is { id: string; path: string } => Boolean(item)),
);

function nodeIcon(type: CanvasNode["type"]) {
  if (type === "image") return ImageIcon;
  if (type === "video") return Film;
  if (type === "config") return Settings2;
  return Type;
}

function worldPoint(event: PointerEvent) {
  const rect = viewportRef.value?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: (event.clientX - rect.left - pan.x) / scale.value,
    y: (event.clientY - rect.top - pan.y) / scale.value,
  };
}

function startPan(event: PointerEvent) {
  if (event.button !== 0) return;
  selectedId.value = "";
  dragState.mode = "pan";
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.panX = pan.x;
  dragState.panY = pan.y;
  viewportRef.value?.setPointerCapture(event.pointerId);
}

function startNodeDrag(event: PointerEvent, node: CanvasNode) {
  if (event.button !== 0) return;
  selectedId.value = node.id;
  const point = worldPoint(event);
  dragState.mode = "node";
  dragState.nodeId = node.id;
  dragState.nodeX = point.x - node.x;
  dragState.nodeY = point.y - node.y;
  viewportRef.value?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (dragState.mode === "pan") {
    pan.x = dragState.panX + (event.clientX - dragState.startX);
    pan.y = dragState.panY + (event.clientY - dragState.startY);
    return;
  }
  if (dragState.mode === "node") {
    const node = nodes.value.find((item) => item.id === dragState.nodeId);
    if (!node) return;
    const point = worldPoint(event);
    node.x = Math.round(point.x - dragState.nodeX);
    node.y = Math.round(point.y - dragState.nodeY);
  }
}

function endPointer(event: PointerEvent) {
  if (dragState.mode === "node") saveCanvas(false);
  dragState.mode = "";
  viewportRef.value?.releasePointerCapture?.(event.pointerId);
}

function onWheel(event: WheelEvent) {
  const rect = viewportRef.value?.getBoundingClientRect();
  if (!rect) return;
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const worldX = (pointerX - pan.x) / scale.value;
  const worldY = (pointerY - pan.y) / scale.value;
  const nextScale = Math.min(2, Math.max(0.2, scale.value * (event.deltaY > 0 ? 0.92 : 1.08)));
  pan.x = pointerX - worldX * nextScale;
  pan.y = pointerY - worldY * nextScale;
  scale.value = nextScale;
}

function zoomBy(delta: number) {
  scale.value = Math.min(2, Math.max(0.2, Number((scale.value + delta).toFixed(2))));
}

function fitView() {
  scale.value = 0.72;
  pan.x = 40;
  pan.y = 30;
}

function minimapStyle(node: CanvasNode) {
  const ratio = 120 / worldSize.width;
  return {
    left: `${node.x * ratio}px`,
    top: `${node.y * ratio}px`,
    width: `${Math.max(6, node.width * ratio)}px`,
    height: `${Math.max(4, node.height * ratio)}px`,
    background: node.accent ?? "rgba(255,255,255,0.4)",
  };
}

const minimapViewportStyle = computed(() => {
  const ratio = 120 / worldSize.width;
  return {
    left: `${-pan.x / scale.value * ratio}px`,
    top: `${-pan.y / scale.value * ratio}px`,
    width: `${(viewportRef.value?.clientWidth ?? 900) / scale.value * ratio}px`,
    height: `${(viewportRef.value?.clientHeight ?? 600) / scale.value * ratio}px`,
  };
});

async function loadCanvas() {
  const detail = await api.get<CanvasDetail>(`/canvases/${route.params.id}`);
  canvas.value = detail;
  nodes.value = detail.nodes.map((node) => ({ ...node }));
  edges.value = detail.edges.map((edge) => ({ ...edge }));
}

async function saveCanvas(showMessage = true) {
  if (!canvas.value) return;
  try {
    await api.put<CanvasDetail>(`/canvases/${canvas.value.id}`, {
      nodes: nodes.value,
      edges: edges.value,
    });
    if (showMessage) showToast("画布已保存");
  } catch {
    showToast("保存失败，请稍后重试");
  }
}

function insertQuick(text: string) {
  draft.value = text;
}

async function sendMessage() {
  const text = draft.value.trim();
  if (!text || sending.value) return;
  messages.value.push({ id: Date.now(), role: "user", content: text });
  draft.value = "";
  sending.value = true;
  await scrollMessages();
  try {
    const result = await api.post<{ reply: string }>(`/canvases/${canvas.value?.id}/assistant`, {
      prompt: text,
    });
    messages.value.push({ id: Date.now() + 1, role: "assistant", content: result.reply });
    await loadCanvas();
  } catch {
    messages.value.push({ id: Date.now() + 2, role: "assistant", content: "网络开小差了，稍后再试一次。" });
  } finally {
    sending.value = false;
    await scrollMessages();
  }
}

async function scrollMessages() {
  await nextTick();
  if (messageRef.value) messageRef.value.scrollTop = messageRef.value.scrollHeight;
}

onBeforeUnmount(() => {
  if (canvas.value && nodes.value.length) void saveCanvas(false);
});

loadCanvas();
</script>

<style scoped>
.canvasPage {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0a0b0e;
  color: #f1f2f5;
}

.canvasTopBar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: #0d0e12;
}

.canvasTitleGroup {
  display: flex;
  align-items: center;
  gap: 10px;
}

.canvasIconButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: #9b9ca8;
  transition: background 0.15s ease, color 0.15s ease;
}

.canvasIconButton:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #f1f2f5;
}

.canvasTitleBlock {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.canvasTitleRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.canvasTitleRow strong {
  font-size: 13px;
  font-weight: 500;
}

.savedPill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
  padding: 2px 6px;
  border-radius: 999px;
}

.canvasMeta {
  font-size: 10px;
  color: #6c6d79;
}

.canvasTopActions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.canvasGhost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  color: #b7b8c2;
  font-size: 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.canvasGhost:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.canvasCost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #d9b26a;
  padding: 0 8px;
}

.canvasPrimary {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  background: #f1f2f5;
  color: #101116;
  font-size: 12px;
  font-weight: 500;
}

.canvasBody {
  flex: 1;
  min-height: 0;
  display: flex;
}

.viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #0a0b0e;
  touch-action: none;
  cursor: grab;
}

.viewport:active {
  cursor: grabbing;
}

.gridLayer {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.11) 1px, transparent 1px);
  pointer-events: none;
}

.world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.edgeLayer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}

.nodeCard {
  position: absolute;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  background: #16171d;
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  cursor: default;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.nodeCard.isSelected {
  border-color: rgba(109, 134, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(109, 134, 255, 0.4), 0 18px 46px rgba(0, 0, 0, 0.55);
}

.nodeHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: move;
  flex-shrink: 0;
}

.nodeTypeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.nodeTitle {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: #d5d6de;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nodeTypeIcon {
  color: #6c6d79;
}

.nodeImage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #101116;
}

.nodeImage img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.nodeText {
  flex: 1;
  padding: 12px;
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow: hidden;
  opacity: 0.9;
}

.nodeConfig {
  flex: 1;
  padding: 12px;
  font-size: 11px;
  line-height: 1.8;
  color: #b9bac4;
  background: rgba(255, 255, 255, 0.02);
}

.nodeConfig p {
  margin: 0;
}

.nodeFooter {
  flex-shrink: 0;
  padding: 5px 10px;
  font-size: 9px;
  color: #6c6d79;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.canvasToolbar {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: 12px;
  background: rgba(22, 23, 29, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(18px);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
}

.canvasTool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 11px;
  color: #c3c4cd;
  white-space: nowrap;
}

.canvasTool:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.zoomControls {
  position: absolute;
  left: 18px;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 9px;
  background: rgba(22, 23, 29, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.zoomButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: #b7b8c2;
}

.zoomButton:hover {
  background: rgba(255, 255, 255, 0.08);
}

.zoomValue {
  min-width: 40px;
  text-align: center;
  font-size: 11px;
  color: #d5d6de;
}

.zoomDivider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 3px;
}

.minimap {
  position: absolute;
  right: 18px;
  bottom: 20px;
  width: 132px;
  height: 92px;
  border-radius: 9px;
  background: rgba(16, 17, 22, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.09);
  padding: 6px;
}

.minimapInner {
  position: relative;
  width: 120px;
  height: 80px;
  overflow: hidden;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.03);
}

.minimapNode {
  position: absolute;
  border-radius: 2px;
  opacity: 0.85;
}

.minimapViewport {
  position: absolute;
  border: 1px solid rgba(109, 134, 255, 0.9);
  border-radius: 3px;
  pointer-events: none;
}

.assistantPanel {
  width: 372px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #0f1014;
  border-left: 1px solid rgba(255, 255, 255, 0.07);
}

.assistantHeader {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.assistantIdentity {
  display: flex;
  align-items: center;
  gap: 9px;
}

.assistantAvatar {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  background: linear-gradient(140deg, #3f6bff, #1b2b63);
}

.assistantIdentity div {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.assistantIdentity strong {
  font-size: 12px;
  font-weight: 500;
}

.assistantHeaderActions {
  display: flex;
  gap: 2px;
}

.assistantMessages {
  flex: 1;
  min-height: 0;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.message {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.message.user {
  justify-content: flex-end;
}

.messageAvatar {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  background: linear-gradient(140deg, #3f6bff, #1b2b63);
}

.messageBubble {
  max-width: 86%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  line-height: 1.7;
  color: #d7d8e0;
}

.message.user .messageBubble {
  background: #e9eaef;
  color: #16171c;
  border-color: transparent;
}

.messageBubble p {
  margin: 0;
}

.typing {
  display: flex;
  gap: 4px;
  align-items: center;
}

.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8b8c98;
  animation: blink 1.2s infinite ease-in-out;
}

.typing span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes blink {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}

.assistantComposer {
  flex-shrink: 0;
  margin: 0 12px 12px;
  padding: 10px;
  border-radius: 12px;
  background: #15161c;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.assistantQuickRow {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.assistantChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  color: #a8a9b5;
  background: rgba(255, 255, 255, 0.05);
}

.assistantChip:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.09);
}

.assistantInput {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: #e6e7ee;
  font-size: 12px;
  line-height: 1.65;
}

.assistantInput::placeholder {
  color: #6c6d79;
}

.assistantBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
}

.assistantModel {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: #a8a9b5;
}

.modelDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #6d86ff;
}

.assistantSend {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #f1f2f5;
  color: #101116;
}

.assistantSend:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
