<template>
  <aside class="sideNav">
    <div class="brand">
      <img src="/logo.svg" alt="云海" class="brandMark" />
      <div class="brandText">
        <strong>云海</strong>
        <span>YunHai Studio</span>
      </div>
    </div>

    <nav class="navScroll scrollArea">
      <div class="navGroup">
        <routerLink to="/create" class="navItem" active-class="isActive">
          <component :is="icons.create" :size="17" />
          <span>创作</span>
        </routerLink>
        <routerLink to="/projects" class="navItem" active-class="isActive">
          <component :is="icons.projects" :size="17" />
          <span>短剧制作</span>
        </routerLink>
        <routerLink to="/canvas" class="navItem" active-class="isActive">
          <component :is="icons.canvas" :size="17" />
          <span>自由画布</span>
        </routerLink>
      </div>

      <div class="navGroup">
        <p class="navLabel">资源与工具</p>
        <routerLink to="/studio/image" class="navItem" active-class="isActive">
          <component :is="icons.image" :size="17" />
          <span>图片生成</span>
        </routerLink>
        <routerLink to="/studio/video" class="navItem" active-class="isActive">
          <component :is="icons.video" :size="17" />
          <span>视频生成</span>
        </routerLink>
        <routerLink to="/skills" class="navItem" active-class="isActive">
          <component :is="icons.skills" :size="17" />
          <span>技能</span>
        </routerLink>
        <routerLink to="/plugins" class="navItem" active-class="isActive">
          <component :is="icons.plugins" :size="17" />
          <span>插件</span>
        </routerLink>
      </div>

      <div class="navGroup">
        <p class="navLabel">资产与历史</p>
        <routerLink to="/assets" class="navItem" active-class="isActive">
          <component :is="icons.assets" :size="17" />
          <span>资产</span>
        </routerLink>
        <routerLink to="/tasks" class="navItem" active-class="isActive">
          <component :is="icons.tasks" :size="17" />
          <span>创作历史</span>
        </routerLink>
      </div>
    </nav>

    <div class="navFooter">
      <div class="storageCard">
        <div class="storageRow">
          <span>已用 95 GB</span>
          <span class="tiny">共 1000 GB</span>
        </div>
        <div class="storageTrack"><div class="storageFill" /></div>
        <div class="tiny">剩余 905 GB</div>
      </div>
      <routerLink to="/settings" class="workspaceCard">
        <span class="workspaceDot" />
        <div>
          <strong>云海 · 本地工作台</strong>
          <span class="tiny">创作工作台</span>
        </div>
        <component :is="icons.settings" :size="15" class="workspaceGear" />
      </routerLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
import {
  Blocks,
  Clapperboard,
  FolderOpen,
  History,
  ImagePlus,
  PenLine,
  Settings,
  Sparkles,
  SquareDashed,
  Video,
} from "lucide-vue-next";

const icons = {
  create: PenLine,
  projects: Clapperboard,
  canvas: SquareDashed,
  image: ImagePlus,
  video: Video,
  skills: Sparkles,
  plugins: Blocks,
  assets: FolderOpen,
  tasks: History,
  settings: Settings,
};
</script>

<style scoped>
.sideNav {
  width: var(--sidebarWidth);
  flex-shrink: 0;
  height: 100vh;
  background: var(--navBg);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 14px 10px 12px;
  position: sticky;
  top: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 16px;
}

.brandMark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
}

.brandText {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.brandText strong {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.brandText span {
  font-size: 10px;
  color: var(--textTertiary);
  letter-spacing: 0.02em;
}

.navScroll {
  flex: 1;
  min-height: 0;
  padding: 2px 2px 12px;
}

.navGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}

.navLabel {
  margin: 6px 0 4px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--textTertiary);
}

.navItem {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--textSecondary);
  font-size: 13px;
  transition: background 0.15s ease, color 0.15s ease;
}

.navItem:hover {
  background: var(--hover);
  color: var(--text);
}

.navItem.isActive {
  background: var(--active);
  color: var(--activeText);
  font-weight: 500;
}

.navFooter {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.storageCard {
  padding: 10px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.storageRow {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--textSecondary);
}

.storageTrack {
  height: 4px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.storageFill {
  width: 9.5%;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
}

.workspaceCard {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--panel);
  transition: border-color 0.15s ease;
}

.workspaceCard:hover {
  border-color: var(--borderStrong);
}

.workspaceCard div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.workspaceCard strong {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.workspaceDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
}

.workspaceGear {
  color: var(--textTertiary);
  flex-shrink: 0;
}
</style>
