<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">技能</h1>
        <p class="pageDescription">把分镜方法、角色设计与导演思路沉淀成技能，在对话里用 @技能 调用。</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton isBordered">
          <component :is="icons.github" :size="14" />
          从 GitHub 安装
        </button>
        <button class="primaryButton" @click="showToast('技能创建入口已打开')">
          <component :is="icons.plus" :size="14" />
          新建技能
        </button>
      </div>
    </header>

    <div class="skillLayout">
      <aside class="categoryPanel">
        <button
          v-for="category in categories"
          :key="category"
          :class="['categoryItem', { isActive: activeCategory === category }]"
          @click="activeCategory = category"
        >
          {{ category }}
          <span>{{ categoryCount(category) }}</span>
        </button>
      </aside>

      <section class="skillMain">
        <div class="skillToolbar">
          <label class="searchBox">
            <component :is="icons.search" :size="14" />
            <input v-model="keyword" placeholder="搜索技能、标签或作者" />
          </label>
          <span class="tiny">共 {{ filteredSkills.length }} 个技能</span>
        </div>

        <div class="skillGrid">
          <article v-for="skill in filteredSkills" :key="skill.id" class="skillCard">
            <div class="skillTop">
              <span class="skillIcon" :style="{ background: skill.color }">
                <component :is="iconOf(skill.icon)" :size="16" />
              </span>
              <div class="skillHeading">
                <strong>{{ skill.name }}</strong>
                <span class="tiny">{{ skill.category }}</span>
              </div>
              <button :class="['installButton', { isInstalled: installed.includes(skill.id) }]" @click="toggleInstall(skill.id)">
                {{ installed.includes(skill.id) ? "已安装" : "安装" }}
              </button>
            </div>
            <p class="skillDescription">{{ skill.description }}</p>
            <div class="skillFooter">
              <div class="tagRow">
                <span v-for="tag in skill.tags" :key="tag" class="tagPill"># {{ tag }}</span>
              </div>
              <span class="tiny">{{ formatInstalls(skill.installs) }} 次使用</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AudioLines,
  Github,
  Megaphone,
  Plus,
  ScrollText,
  Search,
  ShoppingBag,
  Sparkles,
  Sun,
  UserRound,
  Video,
} from "lucide-vue-next";
import { api } from "@/api/client";
import { showToast } from "@/lib/store";

interface SkillItem {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  installs: number;
  color: string;
  icon: string;
}

const icons = { github: Github, plus: Plus, search: Search };
const skillIcons: Record<string, unknown> = {
  Clapperboard: Video,
  UserRound,
  Megaphone,
  Video,
  AudioLines,
  ScrollText,
  Sun,
  ShoppingBag,
  Sparkles,
};

const skills = ref<SkillItem[]>([]);
const installed = ref<string[]>([]);
const activeCategory = ref("全部");
const keyword = ref("");

const categories = computed(() => ["全部", ...Array.from(new Set(skills.value.map((skill) => skill.category)))]);

const filteredSkills = computed(() => {
  const key = keyword.value.trim();
  return skills.value.filter((skill) => {
    const matchesCategory = activeCategory.value === "全部" || skill.category === activeCategory.value;
    return matchesCategory && (!key || skill.name.includes(key) || skill.tags.some((tag) => tag.includes(key)));
  });
});

function categoryCount(category: string) {
  return category === "全部" ? skills.value.length : skills.value.filter((skill) => skill.category === category).length;
}

function iconOf(name: string) {
  return skillIcons[name] ?? Sparkles;
}

function formatInstalls(value: number) {
  return value >= 10000 ? `${(value / 10000).toFixed(1)} 万` : String(value);
}

function toggleInstall(id: string) {
  if (installed.value.includes(id)) {
    installed.value = installed.value.filter((item) => item !== id);
    showToast("已卸载技能");
    return;
  }
  installed.value = [...installed.value, id];
  showToast("技能已安装");
}

api.get<SkillItem[]>("/skills").then((list) => {
  skills.value = list;
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

.skillLayout {
  display: flex;
  gap: 20px;
  margin-top: 26px;
}

.categoryPanel {
  width: 184px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.categoryItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--textSecondary);
}

.categoryItem span {
  font-size: 10px;
  color: var(--textTertiary);
}

.categoryItem:hover {
  background: var(--hover);
  color: var(--text);
}

.categoryItem.isActive {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-weight: 500;
}

.skillMain {
  flex: 1;
  min-width: 0;
}

.skillToolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.searchBox {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 11px;
  width: 260px;
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

.skillGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.skillCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radiusLg);
  background: var(--panel);
  border: 1px solid var(--border);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.skillCard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadowMd);
}

.skillTop {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.skillIcon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.skillHeading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.skillHeading strong {
  font-size: 13px;
  font-weight: 500;
}

.installButton {
  height: 26px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--textSecondary);
}

.installButton:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}

.installButton.isInstalled {
  color: var(--success);
  border-color: transparent;
  background: rgba(22, 163, 74, 0.1);
}

.skillDescription {
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
  color: var(--textSecondary);
  min-height: 36px;
}

.skillFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tagRow {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tagPill {
  font-size: 10px;
  color: var(--textTertiary);
}

@media (max-width: 1400px) {
  .skillGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
