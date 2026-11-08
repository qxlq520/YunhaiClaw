<template>
  <header class="topBar">
    <div class="crumbs">
      <span class="crumbRoot">云海</span>
      <span class="crumbSep">/</span>
      <span class="crumbCurrent">{{ currentTitle }}</span>
    </div>

    <div class="topBarActions">
      <button class="ghostButton isBordered">
        <component :is="icons.feedback" :size="14" />
        反馈
      </button>
      <div class="creditChip">
        <component :is="icons.coin" :size="14" class="creditIcon" />
        <span class="tiny">积分</span>
        <strong>{{ credits }}</strong>
      </div>
      <button class="iconButton" title="通知">
        <component :is="icons.bell" :size="17" />
        <span class="noticeDot" />
      </button>
      <button class="iconButton" title="切换主题" @click="toggleTheme">
        <component :is="appState.theme === 'light' ? icons.moon : icons.sun" :size="17" />
      </button>
      <button class="avatarButton" @click="router.push('/settings')">
        <img v-if="appState.profile?.avatar" :src="appState.profile.avatar" alt="头像" />
        <span v-else class="avatarFallback">云</span>
        <span class="planBadge">{{ appState.profile?.plan ?? "专业版" }}</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Bell, Coins, MessageSquare, Moon, Sun } from "lucide-vue-next";
import { appState, formatCredits, toggleTheme } from "@/lib/store";

const icons = { feedback: MessageSquare, coin: Coins, bell: Bell, moon: Moon, sun: Sun };
const route = useRoute();
const router = useRouter();

const titles: Record<string, string> = {
  "/create": "创作",
  "/projects": "短剧制作",
  "/studio/image": "图片生成",
  "/studio/video": "视频生成",
  "/skills": "技能",
  "/plugins": "插件",
  "/assets": "资产",
  "/tasks": "创作历史",
  "/settings": "设置",
};

const currentTitle = computed(() => {
  if (route.path.startsWith("/projects/")) return "项目详情";
  if (route.path.startsWith("/canvas")) return "自由画布";
  return titles[route.path] ?? "创作";
});

const credits = computed(() => formatCredits(appState.profile?.credits ?? 0));
</script>

<style scoped>
.topBar {
  height: var(--topBarHeight);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px 0 32px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.crumbRoot {
  color: var(--textTertiary);
}

.crumbSep {
  color: var(--textTertiary);
}

.crumbCurrent {
  color: var(--text);
  font-weight: 500;
}

.topBarActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.creditChip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
}

.creditChip strong {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.creditIcon {
  color: var(--warning);
}

.iconButton {
  position: relative;
}

.noticeDot {
  position: absolute;
  top: 7px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid var(--bg);
}

.avatarButton {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: visible;
  margin-left: 4px;
}

.avatarButton img,
.avatarFallback {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, #2b3a6b, #10121c);
  color: #fff;
  font-size: 13px;
}

.planBadge {
  position: absolute;
  left: 50%;
  bottom: -8px;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 9px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 999px;
  background: var(--active);
  color: var(--activeText);
  border: 1.5px solid var(--bg);
}
</style>
