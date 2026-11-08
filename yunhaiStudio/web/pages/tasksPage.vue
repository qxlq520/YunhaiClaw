<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">创作历史</h1>
        <p class="pageDescription">所有生成任务的状态、模型、所属画布和积分消耗。</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton isBordered">
          <component :is="icons.download" :size="14" />
          导出记录
        </button>
        <button class="primaryButton" @click="router.push('/create')">
          <component :is="icons.plus" :size="14" />
          新建创作
        </button>
      </div>
    </header>

    <div class="filterBar">
      <div class="statusTabs">
        <button
          v-for="tab in statusTabs"
          :key="tab.key"
          :class="['statusTab', { isActive: activeStatus === tab.key }]"
          @click="activeStatus = tab.key"
        >
          {{ tab.label }}
          <span>{{ statusCount(tab.key) }}</span>
        </button>
      </div>
      <label class="searchBox">
        <component :is="icons.search" :size="14" />
        <input v-model="keyword" placeholder="搜索任务或画布" />
      </label>
    </div>

    <div class="taskTable">
      <div class="tableHead">
        <span>任务</span>
        <span>类型</span>
        <span>模型</span>
        <span>所属画布</span>
        <span>积分</span>
        <span>状态</span>
        <span>时间</span>
        <span />
      </div>

      <div v-for="task in filteredTasks" :key="task.id" class="tableRow">
        <div class="taskTitle">
          <span :class="['typeIcon', `is-${task.type}`]">
            <component :is="typeIcon(task.type)" :size="13" />
          </span>
          <strong>{{ task.title }}</strong>
        </div>
        <span class="cell muted">{{ typeLabel(task.type) }}</span>
        <span class="cell">{{ task.model }}</span>
        <span class="cell muted">{{ task.canvasName }}</span>
        <span class="cell">{{ task.credits.toFixed(2) }}</span>
        <span class="cell">
          <span :class="['statusPill', `is-${task.status}`]">
            <i v-if="task.status === 'running'" class="spinner" />
            {{ statusLabel(task.status) }}
          </span>
        </span>
        <span class="cell muted">{{ task.createdAt }}</span>
        <button class="rowAction" @click="retry(task)">
          <component :is="icons.refresh" :size="13" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  Atom,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  Search,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface TaskItem {
  id: string;
  title: string;
  type: "video" | "image" | "text" | "agent";
  model: string;
  status: "running" | "completed" | "failed" | "queued";
  credits: number;
  canvasName: string;
  createdAt: string;
}

const icons = { download: Download, plus: Plus, search: Search, refresh: RefreshCw };
const router = useRouter();
const tasks = ref<TaskItem[]>([]);
const activeStatus = ref("all");
const keyword = ref("");

const statusTabs = [
  { key: "all", label: "全部" },
  { key: "running", label: "进行中" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

const filteredTasks = computed(() => {
  const key = keyword.value.trim();
  return tasks.value.filter((task) => {
    const matchesStatus =
      activeStatus.value === "all" || task.status === activeStatus.value || (activeStatus.value === "running" && task.status === "queued");
    return matchesStatus && (!key || task.title.includes(key) || task.canvasName.includes(key));
  });
});

function statusCount(status: string) {
  if (status === "all") return tasks.value.length;
  if (status === "running") return tasks.value.filter((task) => task.status === "running" || task.status === "queued").length;
  return tasks.value.filter((task) => task.status === status).length;
}

function typeIcon(type: string) {
  if (type === "video") return Film;
  if (type === "text") return FileText;
  if (type === "agent") return Atom;
  return ImageIcon;
}

function typeLabel(type: string) {
  return { video: "视频", image: "图片", text: "文本", agent: "Agent" }[type] ?? type;
}

function statusLabel(status: string) {
  return { running: "生成中", completed: "已完成", failed: "失败", queued: "排队中" }[status] ?? status;
}

function retry(task: TaskItem) {
  showToast(`已重新提交：${task.title}`);
}

api.get<TaskItem[]>("/tasks").then((list) => {
  tasks.value = list;
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
  gap: 8px;
}

.filterBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 26px 0 16px;
}

.statusTabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.statusTab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--textSecondary);
}

.statusTab span {
  font-size: 10px;
  color: var(--textTertiary);
}

.statusTab.isActive {
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

.taskTable {
  border-radius: var(--radiusLg);
  border: 1px solid var(--border);
  background: var(--panel);
  overflow: hidden;
}

.tableHead,
.tableRow {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) 0.7fr 1fr 1fr 0.6fr 0.8fr 0.9fr 32px;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.tableHead {
  height: 38px;
  font-size: 11px;
  color: var(--textTertiary);
  border-bottom: 1px solid var(--border);
  background: var(--panelSoft);
}

.tableRow {
  height: 52px;
  border-bottom: 1px solid var(--border);
  transition: background 0.14s ease;
}

.tableRow:last-child {
  border-bottom: none;
}

.tableRow:hover {
  background: var(--panelSoft);
}

.taskTitle {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.taskTitle strong {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.typeIcon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panelSoft);
  color: var(--textSecondary);
  border: 1px solid var(--border);
}

.typeIcon.is-image {
  color: #f59e0b;
}

.typeIcon.is-video {
  color: #ec4899;
}

.typeIcon.is-agent {
  color: #06b6d4;
}

.cell {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.statusPill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  color: var(--textSecondary);
}

.statusPill.is-completed {
  color: var(--success);
  background: rgba(22, 163, 74, 0.1);
  border-color: transparent;
}

.statusPill.is-running {
  color: var(--accent);
  background: var(--accentSoft);
  border-color: transparent;
}

.statusPill.is-failed {
  color: var(--danger);
  background: rgba(220, 38, 38, 0.1);
  border-color: transparent;
}

.spinner {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid rgba(77, 107, 254, 0.3);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.rowAction {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textTertiary);
}

.rowAction:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
