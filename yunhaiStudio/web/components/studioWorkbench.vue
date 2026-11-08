<template>
  <div class="studioPage">
    <div class="stepsBar">
      <span class="step isActive"><i>01</i>选择出品目标</span>
      <span class="stepLine" />
      <span class="step"><i>02</i>准备参考素材</span>
      <span class="stepLine" />
      <span class="step"><i>03</i>描述画面</span>
      <span class="stepLine" />
      <span class="step"><i>04</i>确认参数并生成</span>
      <button class="ghostButton" style="margin-left: auto">重置</button>
    </div>

    <div class="studioBody">
      <section class="formPanel">
        <div class="panelHeader">
          <div class="panelTitle">
            <component :is="mode === 'video' ? icons.film : icons.image" :size="15" />
            <strong>{{ mode === "video" ? "视频生成" : "图片生成" }}</strong>
          </div>
          <button class="ghostButton">切换工具</button>
        </div>

        <div class="formSection">
          <div class="formLabelRow">
            <span class="formLabel">你现在要做什么？</span>
            <button class="linkButton">查看更多</button>
          </div>
          <p class="tiny">选择一个出品目标，让描述和提示词更贴合。</p>
          <div class="templateList">
            <button
              v-for="template in templates"
              :key="template.title"
              :class="['templateCard', { isActive: template.title === activeTemplate }]"
              @click="activeTemplate = template.title"
            >
              <span class="templateIcon" :style="{ background: template.color }">
                <component :is="template.icon" :size="14" />
              </span>
              <div>
                <strong>{{ template.title }}</strong>
                <span class="tiny">{{ template.description }}</span>
              </div>
              <component :is="icons.arrow" :size="13" class="templateArrow" />
            </button>
          </div>
        </div>

        <div class="formSection">
          <div class="formLabelRow">
            <span class="formLabel">描述你想生成的画面</span>
          </div>
          <textarea
            v-model="prompt"
            class="promptInput"
            rows="4"
            placeholder="写下要生成的画面：主体、场景、构图、光线和需要保留的细节"
          />
          <div class="promptMeta">
            <span class="tiny">{{ prompt.length }} / 32000</span>
            <span class="tiny">⌘ / Ctrl + Enter</span>
          </div>
        </div>

        <div class="formSection">
          <div class="formLabelRow">
            <span class="formLabel">参考素材 {{ references.length }} / 16</span>
            <button class="iconButton" style="width: 24px; height: 24px" @click="addReference">
              <component :is="icons.upload" :size="13" />
            </button>
          </div>
          <div class="referenceRow">
            <div v-for="reference in references" :key="reference" class="referenceCard">
              <img :src="reference" alt="参考素材" />
            </div>
            <button class="referenceAdd" @click="addReference">
              <component :is="icons.plus" :size="16" />
            </button>
          </div>
        </div>

        <div class="paramSection">
          <span class="formLabel">画面参数</span>
          <div class="paramRow">
            <button class="paramChip"><span class="modelDot" />{{ model }}</button>
            <button class="paramChip">比例 16:9</button>
            <button class="paramChip">2K</button>
            <button class="paramChip">风格 电影</button>
          </div>
          <div class="generateRow">
            <span class="cost">预估 {{ mode === "video" ? "0.6" : "0.1" }} 积分</span>
            <button class="primaryButton" :disabled="!prompt.trim()" @click="generate">
              <component :is="icons.sparkles" :size="14" />
              {{ mode === "video" ? "生成视频" : "生成图片" }}
            </button>
          </div>
        </div>
      </section>

      <section class="resultPanel">
        <div class="resultHeader">
          <div class="resultTitle">
            <strong>生成结果</strong>
            <span class="pill isAccent">已完成</span>
          </div>
          <div class="resultActions">
            <button class="iconButton"><component :is="icons.compare" :size="15" /></button>
            <button class="iconButton"><component :is="icons.download" :size="15" /></button>
            <button class="iconButton"><component :is="icons.more" :size="15" /></button>
          </div>
        </div>
        <div class="resultCanvas">
          <img :src="resultImage" alt="生成结果" />
          <div class="resultOverlay">
            <span class="tiny">{{ model }}</span>
            <span class="tiny">{{ resultSize }}</span>
          </div>
        </div>
        <div class="resultFooter">
          <div class="resultChips">
            <span class="pill">16:9</span>
            <span class="pill">2K</span>
            <span class="pill">电影写实</span>
          </div>
          <button class="ghostButton isBordered" @click="router.push('/canvas/canvas-1')">
            <component :is="icons.layers" :size="14" />
            发送到画布
          </button>
        </div>
      </section>

      <aside class="sidePanel">
        <div class="sideSection">
          <div class="sideHeader">
            <strong>进行中的任务</strong>
            <span class="tiny">{{ runningTasks.length }} 个任务</span>
          </div>
          <div v-if="!runningTasks.length" class="sideEmpty">暂无进行中的任务</div>
          <div v-for="task in runningTasks" :key="task.id" class="sideTask">
            <div class="sideTaskTop">
              <span>{{ task.title }}</span>
              <span class="tiny">{{ task.progress }}%</span>
            </div>
            <div class="taskTrack"><i :style="{ width: `${task.progress}%` }" /></div>
          </div>
        </div>

        <div class="sideSection">
          <div class="sideHeader">
            <strong>历史生成</strong>
            <span class="tiny">{{ historyTasks.length }} 条记录</span>
          </div>
          <label class="searchBox">
            <component :is="icons.search" :size="13" />
            <input placeholder="搜索提示词" />
          </label>
          <div class="historyList scrollArea">
            <button v-for="task in historyTasks" :key="task.id" class="historyItem">
              <img :src="historyThumbs[task.id] ?? resultImage" alt="" />
              <div>
                <strong>{{ task.title }}</strong>
                <span class="tiny">{{ task.status === "completed" ? "已完成" : "失败" }} · {{ task.createdAt }}</span>
              </div>
              <span class="tiny">{{ task.model }}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowRight,
  Columns2,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Upload,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface TaskItem {
  id: string;
  title: string;
  type: string;
  model: string;
  status: "running" | "completed" | "failed" | "queued";
  progress: number;
  createdAt: string;
}

const props = defineProps<{ mode: "image" | "video" }>();

const icons = {
  film: Film,
  image: ImageIcon,
  arrow: ArrowRight,
  upload: Upload,
  plus: Plus,
  sparkles: Sparkles,
  compare: Columns2,
  download: Download,
  more: MoreHorizontal,
  layers: Layers,
  search: Search,
};

const router = useRouter();
const prompt = ref("商品白底图：浅灰背景，正面平铺，柔和顶光，保留面料纹理与细节。");
const activeTemplate = ref("商品白底图");
const model = ref(props.mode === "video" ? "Seedance 视频" : "GPT Image 2.5");
const references = ref<string[]>([]);
const tasks = ref<TaskItem[]>([]);
const resultImage = ref(
  "https://trae-api-cn.mchost.guru/api/ide/v1/tool_text_to_image?prompt=" +
    encodeURIComponent("浅灰背景上的棕色夹克商品白底图，柔和顶光，细节清晰，商业摄影") +
    "&image_size=portrait_4_3",
);
const resultSize = ref("2048 × 1152");

const templates = [
  { title: "商品白底图", description: "把商品置于纯白到浅灰背景", color: "#ef4444", icon: ImageIcon },
  { title: "商品场景图", description: "把商品放进真实场景与氛围", color: "#e11d48", icon: Film },
  { title: "角色定妆照", description: "统一角色形象的定妆与三视图", color: "#6366f1", icon: ImageIcon },
  { title: "镜头首帧", description: "为视频生成准备高质量首帧", color: "#0ea5e9", icon: Film },
];

const runningTasks = computed(() => tasks.value.filter((task) => task.status === "running" || task.status === "queued"));
const historyTasks = computed(() => tasks.value.filter((task) => task.status !== "running" && task.status !== "queued"));
const historyThumbs = ref<Record<string, string>>({});

async function loadTasks() {
  tasks.value = await api.get<TaskItem[]>("/tasks");
}

function addReference() {
  references.value.push(resultImage.value);
  showToast("已加入一张参考素材");
}

async function generate() {
  if (!prompt.value.trim()) return;
  await api.post("/tasks", {
    title: prompt.value.slice(0, 30),
    type: props.mode,
    model: model.value,
    canvasName: "图片工作台",
  });
  showToast("任务已提交，正在生成");
  resultImage.value =
    "https://trae-api-cn.mchost.guru/api/ide/v1/tool_text_to_image?prompt=" +
    encodeURIComponent(prompt.value) +
    "&image_size=portrait_4_3";
  await loadTasks();
}

loadTasks();
</script>

<style scoped>
.studioPage {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--topBarHeight));
  padding: 0 24px 16px;
}

.stepsBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 0 16px;
}

.step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--textTertiary);
}

.step i {
  font-style: normal;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
}

.step.isActive {
  color: var(--text);
  font-weight: 500;
}

.step.isActive i {
  background: var(--active);
  color: var(--activeText);
  border-color: transparent;
}

.stepLine {
  width: 26px;
  height: 1px;
  background: var(--borderStrong);
}

.studioBody {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr) 300px;
  gap: 14px;
}

.formPanel,
.resultPanel,
.sidePanel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--radiusLg);
  background: var(--panel);
  border: 1px solid var(--border);
  overflow: hidden;
}

.formPanel {
  overflow-y: auto;
}

.panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.panelTitle {
  display: flex;
  align-items: center;
  gap: 7px;
}

.panelTitle strong {
  font-size: 13px;
  font-weight: 500;
}

.formSection {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.formLabelRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.formLabel {
  font-size: 12px;
  font-weight: 500;
}

.linkButton {
  font-size: 11px;
  color: var(--accent);
}

.templateList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.templateCard {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.templateCard:hover {
  border-color: var(--borderStrong);
}

.templateCard.isActive {
  border-color: var(--accent);
  background: var(--accentSoft);
}

.templateIcon {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.templateCard div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.templateCard strong {
  font-size: 12px;
  font-weight: 500;
}

.templateArrow {
  color: var(--textTertiary);
}

.promptInput {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panelSoft);
  padding: 10px;
  resize: none;
  outline: none;
  font-size: 12px;
  line-height: 1.65;
}

.promptInput:focus {
  border-color: var(--borderStrong);
}

.promptMeta {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
}

.referenceRow {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.referenceCard {
  width: 62px;
  height: 62px;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.referenceCard img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.referenceAdd {
  width: 62px;
  height: 62px;
  border-radius: 9px;
  border: 1px dashed var(--borderStrong);
  color: var(--textTertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.referenceAdd:hover {
  color: var(--text);
  border-color: var(--accent);
}

.paramSection {
  padding: 12px 14px 14px;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.paramRow {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.paramChip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--textSecondary);
}

.modelDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.generateRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.cost {
  font-size: 11px;
  color: var(--textTertiary);
}

.resultPanel {
  min-width: 0;
}

.resultHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.resultTitle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.resultTitle strong {
  font-size: 13px;
  font-weight: 500;
}

.resultActions {
  display: flex;
  gap: 2px;
}

.resultCanvas {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 14px;
  border-radius: 12px;
  overflow: hidden;
  background: #101116;
  display: flex;
  align-items: center;
  justify-content: center;
}

.resultCanvas img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.resultOverlay {
  position: absolute;
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #fff;
  opacity: 0.75;
}

.resultFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 14px;
}

.resultChips {
  display: flex;
  gap: 6px;
}

.sidePanel {
  background: var(--bg);
  border-color: transparent;
  gap: 12px;
  overflow: hidden;
}

.sideSection {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radiusLg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-height: 0;
}

.sideSection:last-child {
  flex: 1;
}

.sideHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sideHeader strong {
  font-size: 12px;
  font-weight: 500;
}

.sideEmpty {
  padding: 14px 0;
  text-align: center;
  font-size: 11px;
  color: var(--textTertiary);
}

.sideTask {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.sideTaskTop {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--textSecondary);
}

.taskTrack {
  height: 3px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.taskTrack i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.searchBox {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panelSoft);
  color: var(--textTertiary);
}

.searchBox input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 11px;
}

.historyList {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.historyItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 9px;
  text-align: left;
}

.historyItem:hover {
  background: var(--hover);
}

.historyItem img {
  width: 38px;
  height: 38px;
  border-radius: 7px;
  object-fit: cover;
  flex-shrink: 0;
}

.historyItem div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.historyItem strong {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
