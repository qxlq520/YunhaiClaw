<template>
  <div class="detailPage" v-if="project">
    <header class="detailHeader">
      <div class="titleGroup">
        <button class="iconButton" @click="router.push('/projects')">
          <component :is="icons.back" :size="16" />
        </button>
        <div class="titleBlock">
          <div class="titleRow">
            <strong>{{ project.title }}</strong>
            <span class="donePill">已保存</span>
          </div>
          <div class="pipeline">
            <span>{{ project.episodes.length }}/{{ project.episodeTotal ?? project.episodes.length }} 集已合成</span>
            <span class="pipelineTrack"><i :style="{ width: `${project.progress}%` }" /></span>
            <span>{{ project.progress }}%</span>
          </div>
        </div>
      </div>

      <div class="headerActions">
        <button class="ghostButton isBordered" @click="showToast('正在精修当前画面')">
          <component :is="icons.sparkles" :size="14" />
          精修画面
        </button>
        <button class="ghostButton isBordered" @click="showToast('已开始批量生成视频')">
          <component :is="icons.film" :size="14" />
          全部生成视频 · 1 集
        </button>
        <button class="primaryButton" @click="showToast('继续制作已启动')">
          继续制作
          <component :is="icons.play" :size="13" />
        </button>
      </div>
    </header>

    <div class="viewTabs">
      <button
        v-for="tab in viewTabs"
        :key="tab"
        :class="['viewTab', { isActive: activeView === tab }]"
        @click="activeView = tab"
      >
        {{ tab }}
      </button>
      <button class="viewTab isLink" @click="router.push('/canvas/canvas-1')">
        在画布中打开
        <component :is="icons.external" :size="12" />
      </button>
    </div>

    <div class="detailBody">
      <aside class="episodePanel">
        <div class="episodeSearch">
          <component :is="icons.search" :size="13" />
          <input placeholder="搜索集数或标题" />
          <button class="iconButton" style="width: 24px; height: 24px">
            <component :is="icons.plus" :size="13" />
          </button>
        </div>
        <div class="episodeList scrollArea">
          <button
            v-for="episode in project.episodes"
            :key="episode.id"
            :class="['episodeItem', { isActive: activeEpisode?.id === episode.id }]"
            @click="activeEpisodeId = episode.id"
          >
            <div class="episodeTop">
              <span :class="['episodeNo', `is-${episode.status}`]">0{{ episode.no }}</span>
              <div class="episodeText">
                <strong>{{ episode.title }}</strong>
                <span class="tiny">{{ episode.shotCount }} 个镜头 · {{ statusLabel(episode.status) }}</span>
              </div>
            </div>
            <div class="episodeTrack">
              <i :style="{ width: episode.status === 'done' ? '100%' : episode.status === 'running' ? '58%' : '6%' }" />
            </div>
          </button>
          <button class="addEpisode">
            <component :is="icons.plus" :size="14" />
            添加第 {{ project.episodes.length + 1 }} 集
          </button>
        </div>
      </aside>

      <section class="shotArea scrollArea">
        <div class="shotHeader">
          <div class="shotTitleRow">
            <h2 class="sectionTitle">第 {{ activeEpisode?.no }} 集 {{ activeEpisode?.title }}</h2>
            <span class="pill">{{ activeEpisode?.status === "done" ? "已完成" : "进行中" }}</span>
            <span class="tiny">{{ activeEpisode?.shotCount }} 个镜头</span>
          </div>
          <div class="shotActions">
            <span class="tiny">本集进度</span>
            <span class="shotProgress"><i :style="{ width: shotProgress }" /></span>
            <span class="tiny">{{ shotProgress }}</span>
          </div>
        </div>

        <div class="noticeBar">
          <component :is="icons.info" :size="13" />
          制作已暂停，不会自动发起生成任务；重新生成或逐段生成会自动继续。
        </div>

        <div v-if="activeEpisode?.shots.length" class="shotGrid">
          <article v-for="shot in activeEpisode.shots" :key="shot.id" class="shotCard">
            <div class="shotImage">
              <img :src="shot.image" :alt="shot.title" loading="lazy" />
              <span class="shotNo">0{{ shot.no }}</span>
              <span :class="['shotStatus', `is-${shot.status}`]">{{ statusLabel(shot.status) }}</span>
            </div>
            <div class="shotInfo">
              <strong>{{ shot.title }}</strong>
              <p class="shotPrompt">{{ shot.prompt }}</p>
              <p class="shotDialogue">「{{ shot.dialogue }}」</p>
              <div class="shotFooter">
                <span class="tiny">{{ shot.duration }}</span>
                <button class="shotAction" @click="regenerate(shot.id)">
                  <component :is="icons.refresh" :size="12" />
                  重新生成
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="emptyShots">
          <component :is="icons.film" :size="22" />
          <p>本集还没有分镜</p>
          <span class="tiny">从剧本拆分，或让 Agent 在画布上补全镜头。</span>
        </div>
      </section>
    </div>

    <footer class="detailFooter">
      <div class="footerLeft">
        <span>剧本 第 {{ activeEpisode?.no }} 集</span>
        <span>{{ activeEpisode?.shotCount ?? 0 }} 个镜头</span>
        <span>运镜 0</span>
        <span>已完成 {{ doneCount }}</span>
        <span>待生成 {{ pendingCount }}</span>
      </div>
      <div class="footerRight">
        <span class="tiny">最近保存 · 刚刚</span>
        <button class="ghostButton">全部重试</button>
        <button class="ghostButton">展开对比</button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowLeft,
  ExternalLink,
  Film,
  Info,
  Plus,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface Shot {
  id: string;
  no: number;
  title: string;
  status: "ready" | "running" | "pending";
  duration: string;
  prompt: string;
  dialogue: string;
  image: string;
}

interface Episode {
  id: string;
  no: number;
  title: string;
  summary: string;
  shotCount: number;
  status: "done" | "running" | "pending";
  shots: Shot[];
}

interface ProjectDetail {
  id: string;
  title: string;
  subtitle: string;
  progress: number;
  episodeTotal?: number;
  episodes: Episode[];
}

const icons = {
  back: ArrowLeft,
  sparkles: Sparkles,
  film: Film,
  play: Play,
  external: ExternalLink,
  search: Search,
  plus: Plus,
  info: Info,
  refresh: RefreshCw,
};

const viewTabs = ["剧本", "分镜", "成片"];
const activeView = ref("分镜");
const route = useRoute();
const router = useRouter();
const project = ref<ProjectDetail | null>(null);
const activeEpisodeId = ref("");

const activeEpisode = computed(() => project.value?.episodes.find((item) => item.id === activeEpisodeId.value));

const doneCount = computed(
  () => activeEpisode.value?.shots.filter((shot) => shot.status === "ready").length ?? 0,
);

const pendingCount = computed(
  () => activeEpisode.value?.shots.filter((shot) => shot.status !== "ready").length ?? 0,
);

const shotProgress = computed(() => {
  const shots = activeEpisode.value?.shots ?? [];
  if (!shots.length) return "0%";
  return `${Math.round((doneCount.value / shots.length) * 100)}%`;
});

function statusLabel(status: string) {
  if (status === "ready" || status === "done") return "已完成";
  if (status === "running") return "生成中";
  return "待生成";
}

function regenerate(id: string) {
  showToast(`已重新提交分镜 ${id.slice(-3)}`);
}

api.get<ProjectDetail>(`/projects/${route.params.id}`).then((detail) => {
  project.value = { ...detail, episodeTotal: detail.episodes.length };
  activeEpisodeId.value = detail.episodes[0]?.id ?? "";
});
</script>

<style scoped>
.detailPage {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--topBarHeight));
  background: var(--bg);
}

.detailHeader {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
}

.titleGroup {
  display: flex;
  align-items: center;
  gap: 10px;
}

.titleBlock {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.titleRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.titleRow strong {
  font-size: 15px;
  font-weight: 600;
}

.donePill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--success);
  background: rgba(22, 163, 74, 0.12);
}

.pipeline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--textTertiary);
}

.pipelineTrack {
  width: 160px;
  height: 3px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.pipelineTrack i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.viewTabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--border);
}

.viewTab {
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--textSecondary);
}

.viewTab:hover {
  background: var(--hover);
  color: var(--text);
}

.viewTab.isActive {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
}

.viewTab.isLink {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.detailBody {
  flex: 1;
  min-height: 0;
  display: flex;
}

.episodePanel {
  width: 288px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.episodeSearch {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px;
  padding: 0 9px;
  height: 32px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--textTertiary);
}

.episodeSearch input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
}

.episodeList {
  flex: 1;
  min-height: 0;
  padding: 0 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.episodeItem {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  text-align: left;
}

.episodeItem:hover {
  background: var(--hover);
}

.episodeItem.isActive {
  background: var(--panel);
  border-color: var(--border);
  box-shadow: var(--shadowSm);
}

.episodeTop {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.episodeNo {
  font-size: 16px;
  font-weight: 600;
  color: var(--textTertiary);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.episodeNo.is-done {
  color: var(--success);
}

.episodeNo.is-running {
  color: var(--accent);
}

.episodeText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.episodeText strong {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.episodeTrack {
  height: 3px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.episodeTrack i {
  display: block;
  height: 100%;
  background: var(--accent);
}

.addEpisode {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  border-radius: 9px;
  border: 1px dashed var(--borderStrong);
  color: var(--textSecondary);
  font-size: 12px;
}

.shotArea {
  flex: 1;
  min-width: 0;
  padding: 16px 24px 24px;
}

.shotHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.shotTitleRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shotActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shotProgress {
  width: 180px;
  height: 4px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.shotProgress i {
  display: block;
  height: 100%;
  background: var(--success);
}

.noticeBar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0;
  padding: 8px 12px;
  border-radius: 9px;
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--textSecondary);
  font-size: 11px;
}

.shotGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.shotCard {
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--border);
}

.shotImage {
  position: relative;
  aspect-ratio: 16 / 10;
  background: var(--panelSoft);
  overflow: hidden;
}

.shotImage img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.shotNo {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(10, 10, 14, 0.62);
  color: #fff;
  font-size: 10px;
  backdrop-filter: blur(6px);
}

.shotStatus {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  color: #fff;
  background: rgba(10, 10, 14, 0.62);
  backdrop-filter: blur(6px);
}

.shotStatus.is-ready {
  background: rgba(22, 163, 74, 0.8);
}

.shotStatus.is-running {
  background: rgba(77, 107, 254, 0.85);
}

.shotInfo {
  padding: 10px 11px 11px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.shotInfo strong {
  font-size: 12px;
  font-weight: 500;
}

.shotPrompt {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--textSecondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.shotDialogue {
  margin: 0;
  font-size: 11px;
  color: var(--textTertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shotFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 7px;
  border-top: 1px solid var(--border);
}

.shotAction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--textSecondary);
}

.shotAction:hover {
  color: var(--text);
}

.emptyShots {
  margin-top: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--textTertiary);
}

.emptyShots p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--textSecondary);
}

.detailFooter {
  flex-shrink: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.footerLeft {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--textTertiary);
}

.footerRight {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 1400px) {
  .shotGrid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
