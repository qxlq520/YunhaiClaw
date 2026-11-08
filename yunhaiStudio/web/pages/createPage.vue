<template>
  <div class="createPage">
    <section class="hero">
      <div class="heroHeading">
        <div>
          <h1 class="heroTitle">和云海聊聊创作想法</h1>
          <p class="heroSubtitle">从一个画面、一个角色或一句话开始。</p>
        </div>
        <button class="ghostButton">
          <component :is="icons.history" :size="14" />
          历史对话
        </button>
      </div>

      <div class="modeTabs">
        <button
          v-for="item in modes"
          :key="item.key"
          :class="['modeTab', { isActive: mode === item.key }]"
          @click="mode = item.key"
        >
          <component :is="item.icon" :size="15" />
          {{ item.label }}
          <span v-if="item.badge" class="modeBadge">{{ item.badge }}</span>
        </button>
      </div>

      <div class="composer">
        <textarea
          v-model="prompt"
          class="composerInput"
          rows="3"
          :placeholder="placeholder"
          @keydown.meta.enter="submit"
          @keydown.ctrl.enter="submit"
        />
        <div class="composerBar">
          <div class="composerLeft">
            <button class="ghostButton isBordered" @click="showToast('参考素材选择器已打开')">
              <component :is="icons.plus" :size="14" />
              参考内容
            </button>
            <button class="iconButton" title="语音输入" @click="showToast('已开始语音输入')">
              <component :is="icons.mic" :size="16" />
            </button>
            <button class="modelSelect">
              <span class="modelDot" />
              {{ model }}
              <component :is="icons.chevron" :size="14" />
            </button>
            <button class="modelSelect">
              <component :is="icons.ratio" :size="14" />
              16:9 · 2K · 自动
              <component :is="icons.chevron" :size="14" />
            </button>
          </div>
          <div class="composerRight">
            <span class="cost">{{ modeCost }}</span>
            <button class="primaryButton" :disabled="!prompt.trim()" @click="submit">
              开始创作
              <component :is="icons.arrowUp" :size="15" />
            </button>
          </div>
        </div>
      </div>

      <div class="quickActions">
        <button v-for="action in quickActions" :key="action.title" class="quickAction" @click="applyQuickAction(action.prompt)">
          <component :is="action.icon" :size="16" class="quickIcon" />
          <div>
            <strong>{{ action.title }}</strong>
            <span>{{ action.description }}</span>
          </div>
        </button>
      </div>
    </section>

    <section class="section">
      <div class="sectionHeader">
        <div class="sectionTitleRow">
          <component :is="icons.clock" :size="15" class="sectionIcon" />
          <h2 class="sectionTitle">最近画布</h2>
        </div>
        <routerLink to="/canvas" class="ghostButton">
          查看全部
          <component :is="icons.arrowUpRight" :size="14" />
        </routerLink>
      </div>
      <div class="canvasRow">
        <button class="canvasCard isCreate" @click="createCanvas">
          <span class="createPlus"><component :is="icons.plus" :size="18" /></span>
          <strong>创建画布</strong>
          <span class="tiny">从空白开始</span>
        </button>
        <routerLink
          v-for="canvas in canvases"
          :key="canvas.id"
          :to="`/canvas/${canvas.id}`"
          class="canvasCard"
        >
          <div class="canvasThumb">
            <img :src="canvas.thumbnail" :alt="canvas.name" loading="lazy" />
          </div>
          <strong>{{ canvas.name }}</strong>
          <span class="tiny">{{ canvas.nodeCount }} 个节点 · {{ canvas.updatedAt }}</span>
        </routerLink>
      </div>
    </section>

    <section class="section">
      <div class="sectionHeader">
        <div>
          <h2 class="inspirationTitle">灵感大厅</h2>
          <p class="pageDescription">点开查看完整提示词，用喜欢的创意继续创作。</p>
        </div>
        <div class="inspirationActions">
          <button class="ghostButton isBordered" @click="showToast('灵感创建入口已打开')">
            <component :is="icons.plus" :size="14" />
            新建灵感
          </button>
          <button class="iconButton"><component :is="icons.more" :size="16" /></button>
        </div>
      </div>

      <div class="filterBar">
        <div class="filterTabs">
          <button
            v-for="tab in inspirationTabs"
            :key="tab.key"
            :class="['filterTab', { isActive: inspirationType === tab.key }]"
            @click="inspirationType = tab.key"
          >
            {{ tab.label }}
            <span>{{ tab.count }}</span>
          </button>
        </div>
        <div class="filterTools">
          <label class="searchBox">
            <component :is="icons.search" :size="14" />
            <input v-model="keyword" placeholder="搜索标题、描述或标签" />
          </label>
          <button class="ghostButton">
            <component :is="icons.sliders" :size="14" />
            多选筛选
          </button>
          <span class="tiny">共 {{ filteredInspirations.length }} 条</span>
        </div>
      </div>

      <div class="inspirationGrid">
        <article
          v-for="item in filteredInspirations"
          :key="item.id"
          class="inspirationCard"
          @click="useInspiration(item)"
        >
          <img :src="item.image" :alt="item.title" loading="lazy" />
          <div class="inspirationTop">
            <span class="tagPill">
              <component :is="typeIcon(item.type)" :size="11" />
              {{ item.tag }}
            </span>
          </div>
          <div class="inspirationBottom">
            <strong>{{ item.title }}</strong>
            <span>{{ item.likes }} 收藏</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowUp,
  ArrowUpRight,
  Atom,
  ChevronDown,
  Clock,
  FileText,
  Film,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Mic,
  MoreHorizontal,
  Plus,
  Ratio,
  Search,
  SlidersHorizontal,
  Sparkles,
  TextCursorInput,
  Wand2,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface CanvasSummary {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
  thumbnail: string;
}

interface Inspiration {
  id: string;
  title: string;
  type: "image" | "video" | "text";
  tag: string;
  image: string;
  likes: number;
}

const icons = {
  history: Clock,
  plus: Plus,
  mic: Mic,
  chevron: ChevronDown,
  ratio: Ratio,
  arrowUp: ArrowUp,
  arrowUpRight: ArrowUpRight,
  clock: Clock,
  more: MoreHorizontal,
  search: Search,
  sliders: SlidersHorizontal,
};

const router = useRouter();
const mode = ref<"video" | "image" | "text" | "agent">("image");
const prompt = ref("");
const keyword = ref("");
const inspirationType = ref<"all" | "image" | "video" | "text">("all");
const model = ref("GPT Image 2.5");
const canvases = ref<CanvasSummary[]>([]);
const inspos = ref<Inspiration[]>([]);

const modes = [
  { key: "video" as const, label: "视频", icon: Film },
  { key: "image" as const, label: "图片", icon: ImageIcon },
  { key: "text" as const, label: "文本", icon: FileText },
  { key: "agent" as const, label: "Agent", icon: Atom, badge: "+" },
];

const placeholder = computed(() => {
  if (mode.value === "video") return "描述你想生成的镜头：主体、动作、运镜与光线。";
  if (mode.value === "text") return "写下故事、角色或台词，云海帮你拆解与续写。";
  if (mode.value === "agent") return "告诉 Agent 你想在画布上完成什么。";
  return "输入你的镜头、画面或故事。也可以添加参考图开始创作。";
});

const modeCost = computed(() => {
  if (mode.value === "video") return "0.6";
  if (mode.value === "text") return "0.02";
  if (mode.value === "agent") return "0.08";
  return "0.1";
});

const quickActions = [
  { title: "生成第一个镜头", description: "描述画面、镜头运动与光线", icon: Wand2, prompt: "生成一个开场镜头：雨夜长街，主角撑伞回望，慢推近。" },
  { title: "从参考图开始", description: "上传风格图，生成同风格画面", icon: ImagePlus, prompt: "参考我上传的图片风格，生成一张同氛围的电影剧照。" },
  { title: "续写故事", description: "和 AI 讨论剧情、角色与对白", icon: TextCursorInput, prompt: "续写主角在云港第一次遇见旧友的场景。" },
  { title: "引用技能增强", description: "按技能调用分镜、配音等专业能力", icon: Sparkles, prompt: "@分镜方法 把这段剧本拆成 6 个镜头。" },
];

const inspirationTabs = computed(() => [
  { key: "all" as const, label: "全部", count: inspos.value.length },
  { key: "image" as const, label: "图片", count: inspos.value.filter((item) => item.type === "image").length },
  { key: "video" as const, label: "视频", count: inspos.value.filter((item) => item.type === "video").length },
  { key: "text" as const, label: "文本", count: inspos.value.filter((item) => item.type === "text").length },
]);

const filteredInspirations = computed(() => {
  const key = keyword.value.trim().toLowerCase();
  return inspos.value.filter((item) => {
    const matchesType = inspirationType.value === "all" || item.type === inspirationType.value;
    const matchesKeyword =
      !key ||
      item.title.toLowerCase().includes(key) ||
      item.tag.toLowerCase().includes(key);
    return matchesType && matchesKeyword;
  });
});

function typeIcon(type: Inspiration["type"]) {
  if (type === "video") return Film;
  if (type === "text") return FileText;
  return LayoutGrid;
}

function applyQuickAction(text: string) {
  prompt.value = text;
}

async function loadData() {
  const [canvasList, inspirationList] = await Promise.all([
    api.get<CanvasSummary[]>("/canvases"),
    api.get<Inspiration[]>("/inspirations"),
  ]);
  canvases.value = canvasList.slice(0, 4);
  inspos.value = inspirationList;
}

async function submit() {
  if (!prompt.value.trim()) return;
  const task = await api.post<{ title: string }>("/tasks", {
    title: prompt.value.slice(0, 36),
    type: mode.value,
    model: model.value,
    credits: Number(modeCost.value),
    canvasName: "自由画布 11",
  });
  showToast(`已提交：${task.title}`);
  prompt.value = "";
  router.push("/tasks");
}

async function createCanvas() {
  const canvas = await api.post<CanvasSummary>("/canvases", { name: `自由画布 ${canvases.value.length + 12}` });
  router.push(`/canvas/${canvas.id}`);
}

function useInspiration(item: Inspiration) {
  prompt.value = `${item.title}：保持画面风格与光线，生成一张电影剧照。`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

loadData();
</script>

<style scoped>
.createPage {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 40px 80px;
}

.hero {
  padding-top: 26px;
}

.heroHeading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  max-width: 760px;
  margin: 0 auto;
}

.heroTitle {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}

.heroSubtitle {
  margin: 6px 0 0;
  color: var(--textSecondary);
  font-size: 13px;
}

.modeTabs {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin: 34px auto 0;
  padding: 4px;
  width: fit-content;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.modeTab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 18px;
  border-radius: 999px;
  color: var(--textSecondary);
  font-size: 13px;
  transition: background 0.15s ease, color 0.15s ease;
}

.modeTab:hover {
  color: var(--text);
}

.modeTab.isActive {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadowSm);
  font-weight: 500;
}

.modeBadge {
  font-size: 11px;
  color: var(--textTertiary);
}

.composer {
  max-width: 760px;
  margin: 14px auto 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radiusXl);
  box-shadow: var(--shadowSm);
  padding: 18px 18px 14px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.composer:focus-within {
  border-color: var(--borderStrong);
  box-shadow: var(--shadowMd);
}

.composerInput {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  font-size: 14px;
  line-height: 1.7;
  min-height: 76px;
}

.composerInput::placeholder {
  color: var(--textTertiary);
}

.composerBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.composerLeft,
.composerRight {
  display: flex;
  align-items: center;
  gap: 6px;
}

.modelSelect {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  color: var(--textSecondary);
  font-size: 12px;
  white-space: nowrap;
}

.modelSelect:hover {
  background: var(--hover);
}

.modelDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.cost {
  font-size: 12px;
  color: var(--textTertiary);
  margin-right: 6px;
}

.quickActions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  max-width: 760px;
  margin: 16px auto 0;
}

.quickAction {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 12px;
  border-radius: 14px;
  text-align: left;
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.quickAction:hover {
  background: var(--panel);
  border-color: var(--border);
}

.quickAction div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.quickAction strong {
  font-size: 12px;
  font-weight: 500;
}

.quickAction span {
  font-size: 11px;
  color: var(--textTertiary);
  line-height: 1.45;
}

.quickIcon {
  color: var(--textSecondary);
  margin-top: 1px;
}

.section {
  margin-top: 44px;
}

.sectionHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.sectionTitleRow {
  display: flex;
  align-items: center;
  gap: 7px;
}

.sectionIcon {
  color: var(--textTertiary);
}

.canvasRow {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.canvasCard {
  width: 158px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid transparent;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.canvasCard:hover {
  background: var(--panel);
  border-color: var(--border);
}

.canvasCard.isCreate {
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 158px;
  background: var(--panel);
  border: 1px dashed var(--borderStrong);
}

.createPlus {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  margin-bottom: 4px;
}

.canvasThumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  background: var(--panelSoft);
  border: 1px solid var(--border);
}

.canvasThumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.canvasCard strong {
  font-size: 12px;
  font-weight: 500;
  margin-top: 4px;
}

.inspirationTitle {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.inspirationActions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filterBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 4px 0 16px;
  flex-wrap: wrap;
}

.filterTabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.filterTab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--textSecondary);
}

.filterTab span {
  font-size: 10px;
  color: var(--textTertiary);
}

.filterTab.isActive {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadowSm);
}

.filterTools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.searchBox {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 11px;
  width: 220px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--textTertiary);
}

.searchBox input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
}

.searchBox input::placeholder {
  color: var(--textTertiary);
}

.inspirationGrid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.inspirationCard {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  background: var(--panelSoft);
  border: 1px solid var(--border);
}

.inspirationCard img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.inspirationCard:hover img {
  transform: scale(1.05);
}

.inspirationTop {
  position: absolute;
  top: 8px;
  left: 8px;
}

.tagPill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 6px;
  font-size: 10px;
  color: #fff;
  background: rgba(10, 10, 14, 0.55);
  backdrop-filter: blur(8px);
}

.inspirationBottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 26px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  color: #fff;
  background: linear-gradient(to top, rgba(8, 8, 12, 0.72), transparent);
}

.inspirationBottom strong {
  font-size: 12px;
  font-weight: 500;
}

.inspirationBottom span {
  font-size: 10px;
  opacity: 0.72;
}

@media (max-width: 1280px) {
  .inspirationGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .quickActions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
