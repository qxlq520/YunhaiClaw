<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">短剧制作</h1>
        <p class="pageDescription">从小说到成片，按集拆分剧本、建立角色、生成分镜。</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton isBordered">
          <component :is="icons.import" :size="14" />
          导入小说
        </button>
        <button class="primaryButton" @click="createProject">
          <component :is="icons.plus" :size="15" />
          新建制作
        </button>
      </div>
    </header>

    <div class="projectFilters">
      <div class="filterTabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="['filterTab', { isActive: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span>{{ countOf(tab.key) }}</span>
        </button>
      </div>
      <label class="searchBox">
        <component :is="icons.search" :size="14" />
        <input v-model="keyword" placeholder="搜索项目名称" />
      </label>
    </div>

    <div class="projectGrid">
      <routerLink v-for="project in filteredProjects" :key="project.id" :to="`/projects/${project.id}`" class="projectCard">
        <div class="projectCover">
          <img :src="project.cover" :alt="project.title" loading="lazy" />
          <span class="kindBadge">{{ project.kind }}</span>
          <div class="coverProgress">
            <div class="coverProgressFill" :style="{ width: `${project.progress}%` }" />
          </div>
        </div>
        <div class="projectInfo">
          <div class="projectTitleRow">
            <strong>{{ project.title }}</strong>
            <span class="tiny">{{ project.progress }}%</span>
          </div>
          <p class="tiny">{{ project.subtitle }}</p>
          <div class="projectMeta">
            <span>{{ project.episodeTotal }} 集</span>
            <span>·</span>
            <span>{{ project.updatedAt }}</span>
          </div>
        </div>
      </routerLink>

      <button class="projectCard isCreate" @click="createProject">
        <span class="createIcon"><component :is="icons.plus" :size="20" /></span>
        <strong>新建短剧项目</strong>
        <span class="tiny">上传小说或粘贴正文开始</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Plus, Search, Upload } from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface ProjectSummary {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  episodeTotal: number;
  updatedAt: string;
  cover: string;
  progress: number;
}

const icons = { plus: Plus, search: Search, import: Upload };
const projects = ref<ProjectSummary[]>([]);
const keyword = ref("");
const activeTab = ref<"all" | "短剧制作" | "电影预演" | "广告短片">("all");

const tabs = [
  { key: "all" as const, label: "全部" },
  { key: "短剧制作" as const, label: "短剧" },
  { key: "电影预演" as const, label: "电影预演" },
  { key: "广告短片" as const, label: "广告" },
];

const filteredProjects = computed(() => {
  const key = keyword.value.trim();
  return projects.value.filter((project) => {
    const matchesType = activeTab.value === "all" || project.kind === activeTab.value;
    return matchesType && (!key || project.title.includes(key));
  });
});

function countOf(key: string) {
  return key === "all" ? projects.value.length : projects.value.filter((item) => item.kind === key).length;
}

function createProject() {
  showToast("新建制作流程已打开");
}

api.get<ProjectSummary[]>("/projects").then((list) => {
  projects.value = list;
});
</script>

<style scoped>
.pageHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-top: 20px;
}

.headerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.projectFilters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 26px 0 18px;
}

.filterTabs {
  display: flex;
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

.searchBox {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
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

.projectGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.projectCard {
  display: flex;
  flex-direction: column;
  border-radius: var(--radiusLg);
  background: var(--panel);
  border: 1px solid var(--border);
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.projectCard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadowMd);
  border-color: var(--borderStrong);
}

.projectCover {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: var(--panelSoft);
}

.projectCover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.kindBadge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(10, 10, 14, 0.6);
  color: #fff;
  font-size: 10px;
  backdrop-filter: blur(8px);
}

.coverProgress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
}

.coverProgressFill {
  height: 100%;
  background: var(--accent);
}

.projectInfo {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.projectTitleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.projectTitleRow strong {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.projectMeta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--textTertiary);
}

.projectCard.isCreate {
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 240px;
  border-style: dashed;
  background: transparent;
}

.createIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  margin-bottom: 6px;
}

@media (max-width: 1400px) {
  .projectGrid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
