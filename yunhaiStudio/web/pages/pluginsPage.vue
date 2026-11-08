<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">插件中心</h1>
        <p class="pageDescription">模型协议以插件形式接入，覆盖文本、图片、视频、音频、存储与支付。</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton isBordered" @click="showToast('插件目录已刷新')">
          <component :is="icons.refresh" :size="14" />
          刷新目录
        </button>
        <button class="primaryButton" @click="showToast('自定义插件入口已打开')">
          <component :is="icons.plus" :size="14" />
          添加插件
        </button>
      </div>
    </header>

    <div class="categoryTabs">
      <button
        v-for="category in categories"
        :key="category"
        :class="['categoryTab', { isActive: activeCategory === category }]"
        @click="activeCategory = category"
      >
        {{ category }}
        <span>{{ categoryCount(category) }}</span>
      </button>
    </div>

    <div class="pluginGrid">
      <article v-for="plugin in filteredPlugins" :key="plugin.id" class="pluginCard">
        <div class="pluginTop">
          <span class="pluginIcon" :style="{ background: plugin.color }">
            <component :is="iconOf(plugin.icon)" :size="17" />
          </span>
          <div class="pluginHeading">
            <strong>{{ plugin.name }}</strong>
            <span class="tiny">{{ plugin.vendor }} · {{ plugin.category }}</span>
          </div>
          <button :class="['switch', { isOn: plugin.enabled }]" @click="togglePlugin(plugin)">
            <span />
          </button>
        </div>
        <p class="pluginDescription">{{ plugin.description }}</p>
        <div class="pluginFooter">
          <span :class="['statusDot', { isOn: plugin.enabled }]" />
          <span class="tiny">{{ plugin.enabled ? "已启用" : "未启用" }}</span>
          <button class="linkButton">配置</button>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Bot,
  Clapperboard,
  Cloud,
  Database,
  Film,
  Image as ImageIcon,
  Languages,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface PluginItem {
  id: string;
  name: string;
  category: string;
  vendor: string;
  description: string;
  enabled: boolean;
  color: string;
  icon: string;
}

const icons = { refresh: RefreshCw, plus: Plus };
const pluginIcons: Record<string, unknown> = {
  Film,
  Image: ImageIcon,
  Sparkles,
  MessageSquare,
  Languages,
  Clapperboard,
  Cloud,
  Database,
  Wallet,
  Bot,
};

const plugins = ref<PluginItem[]>([]);
const activeCategory = ref("全部");
const categories = ["全部", "文本", "图片", "视频", "存储", "支付协议", "应用插件"];

const filteredPlugins = computed(() =>
  plugins.value.filter((plugin) => activeCategory.value === "全部" || plugin.category === activeCategory.value),
);

function categoryCount(category: string) {
  return category === "全部" ? plugins.value.length : plugins.value.filter((plugin) => plugin.category === category).length;
}

function iconOf(name: string) {
  return pluginIcons[name] ?? Sparkles;
}

async function togglePlugin(plugin: PluginItem) {
  const enabled = !plugin.enabled;
  plugin.enabled = enabled;
  try {
    await api.post(`/plugins/${plugin.id}/toggle`, { enabled });
    showToast(`${plugin.name}${enabled ? "已启用" : "已停用"}`);
  } catch {
    plugin.enabled = !enabled;
    showToast("操作失败，请稍后重试");
  }
}

api.get<PluginItem[]>("/plugins").then((list) => {
  plugins.value = list;
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

.categoryTabs {
  display: flex;
  gap: 4px;
  margin: 26px 0 18px;
  padding: 3px;
  width: fit-content;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.categoryTab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--textSecondary);
}

.categoryTab span {
  font-size: 10px;
  color: var(--textTertiary);
}

.categoryTab.isActive {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadowSm);
}

.pluginGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.pluginCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radiusLg);
  background: var(--panel);
  border: 1px solid var(--border);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.pluginCard:hover {
  border-color: var(--borderStrong);
  box-shadow: var(--shadowSm);
}

.pluginTop {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.pluginIcon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.pluginHeading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.pluginHeading strong {
  font-size: 13px;
  font-weight: 500;
}

.switch {
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--bgDeep);
  border: 1px solid var(--border);
  padding: 2px;
  transition: background 0.18s ease;
}

.switch span {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--textTertiary);
  transition: transform 0.18s ease, background 0.18s ease;
}

.switch.isOn {
  background: var(--accent);
  border-color: transparent;
}

.switch.isOn span {
  transform: translateX(14px);
  background: #fff;
}

.pluginDescription {
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
  color: var(--textSecondary);
  min-height: 36px;
}

.pluginFooter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
}

.statusDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--textTertiary);
}

.statusDot.isOn {
  background: var(--success);
}

.linkButton {
  margin-left: auto;
  font-size: 11px;
  color: var(--accent);
}

@media (max-width: 1400px) {
  .pluginGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
