<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">资产</h1>
        <p class="pageDescription">文本、图片、视频、音频和 3D 模型统一归档，按角色、场景、道具分类。</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton isBordered">
          <component :is="icons.upload" :size="14" />
          上传资产
        </button>
        <button class="primaryButton" @click="showToast('已打开生成入口')">
          <component :is="icons.sparkles" :size="14" />
          去生成
        </button>
      </div>
    </header>

    <div class="filterBar">
      <div class="typeTabs">
        <button
          v-for="tab in typeTabs"
          :key="tab.key"
          :class="['typeTab', { isActive: activeType === tab.key }]"
          @click="activeType = tab.key"
        >
          {{ tab.label }}
          <span>{{ countByType(tab.key) }}</span>
        </button>
      </div>
      <div class="filterTools">
        <label class="searchBox">
          <component :is="icons.search" :size="14" />
          <input v-model="keyword" placeholder="搜索资产名称" />
        </label>
        <button class="ghostButton isBordered">
          <component :is="icons.filter" :size="14" />
          筛选
        </button>
      </div>
    </div>

    <div class="categoryRow">
      <button
        v-for="category in categories"
        :key="category"
        :class="['categoryChip', { isActive: activeCategory === category }]"
        @click="activeCategory = category"
      >
        {{ category }}
      </button>
    </div>

    <div class="assetGrid">
      <article v-for="asset in filteredAssets" :key="asset.id" class="assetCard">
        <div class="assetThumb">
          <img v-if="asset.url" :src="asset.url" :alt="asset.name" loading="lazy" />
          <div v-else class="thumbFallback">
            <component :is="typeIcon(asset.type)" :size="22" />
          </div>
          <span class="typeBadge">
            <component :is="typeIcon(asset.type)" :size="10" />
            {{ typeLabel(asset.type) }}
          </span>
        </div>
        <div class="assetInfo">
          <strong>{{ asset.name }}</strong>
          <div class="assetMeta">
            <span>{{ asset.category }}</span>
            <span>·</span>
            <span>{{ asset.size }}</span>
            <span>·</span>
            <span>{{ asset.createdAt }}</span>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { AudioLines, Box, FileText, Film, Image as ImageIcon, Search, SlidersHorizontal, Sparkles, Upload } from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

type AssetType = "image" | "video" | "audio" | "text" | "model";

interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  category: string;
  url: string;
  size: string;
  createdAt: string;
}

const icons = { upload: Upload, sparkles: Sparkles, search: Search, filter: SlidersHorizontal };
const assets = ref<AssetItem[]>([]);
const activeType = ref<"all" | AssetType>("all");
const activeCategory = ref("全部");
const keyword = ref("");

const typeTabs = [
  { key: "all" as const, label: "全部" },
  { key: "image" as const, label: "图片" },
  { key: "video" as const, label: "视频" },
  { key: "audio" as const, label: "音频" },
  { key: "text" as const, label: "文本" },
  { key: "model" as const, label: "3D" },
];

const categories = ["全部", "角色", "场景", "道具", "分镜", "声音", "剧本"];

const filteredAssets = computed(() => {
  const key = keyword.value.trim();
  return assets.value.filter((asset) => {
    const matchesType = activeType.value === "all" || asset.type === activeType.value;
    const matchesCategory = activeCategory.value === "全部" || asset.category === activeCategory.value;
    return matchesType && matchesCategory && (!key || asset.name.includes(key));
  });
});

function countByType(type: string) {
  return type === "all" ? assets.value.length : assets.value.filter((asset) => asset.type === type).length;
}

function typeLabel(type: AssetType) {
  return { image: "图片", video: "视频", audio: "音频", text: "文本", model: "3D" }[type];
}

function typeIcon(type: AssetType) {
  if (type === "video") return Film;
  if (type === "audio") return AudioLines;
  if (type === "text") return FileText;
  if (type === "model") return Box;
  return ImageIcon;
}

api.get<AssetItem[]>("/assets").then((list) => {
  assets.value = list;
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
  margin: 26px 0 10px;
}

.typeTabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.typeTab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--textSecondary);
}

.typeTab span {
  font-size: 10px;
  color: var(--textTertiary);
}

.typeTab.isActive {
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

.categoryRow {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.categoryChip {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--textSecondary);
  border: 1px solid var(--border);
}

.categoryChip.isActive {
  background: var(--active);
  color: var(--activeText);
  border-color: transparent;
}

.assetGrid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

.assetCard {
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--border);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.assetCard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadowMd);
}

.assetThumb {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--panelSoft);
  overflow: hidden;
}

.assetThumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbFallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textTertiary);
}

.typeBadge {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 5px;
  font-size: 10px;
  color: #fff;
  background: rgba(10, 10, 14, 0.62);
  backdrop-filter: blur(6px);
}

.assetInfo {
  padding: 9px 10px 11px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.assetInfo strong {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assetMeta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--textTertiary);
}

@media (max-width: 1400px) {
  .assetGrid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
