<template>
  <div class="pageContent">
    <header class="pageHeader">
      <div>
        <h1 class="pageTitle">设置</h1>
        <p class="pageDescription">调整外观、生成默认项与本地存储。</p>
      </div>
    </header>

    <div class="settingsGrid">
      <section class="settingsCard">
        <div class="cardHeader">
          <div>
            <h2 class="sectionTitle">账号</h2>
            <p class="tiny">当前登录的云海工作台账号。</p>
          </div>
        </div>
        <div class="profileRow">
          <img v-if="appState.profile?.avatar" :src="appState.profile.avatar" alt="头像" class="profileAvatar" />
          <span v-else class="profileAvatar fallback">云</span>
          <div class="profileInfo">
            <strong>{{ appState.profile?.name ?? "云海导演" }}</strong>
            <span class="tiny">{{ appState.profile?.handle }} · {{ appState.profile?.plan }}</span>
          </div>
          <div class="creditBadge">
            <component :is="icons.coin" :size="13" />
            {{ formatCredits(appState.profile?.credits ?? 0) }} 积分
          </div>
        </div>
        <div class="cardActions">
          <button class="ghostButton isBordered" @click="showToast('账号信息已同步')">同步账号</button>
          <button class="ghostButton dangerText" @click="router.push('/login')">退出登录</button>
        </div>
      </section>

      <section class="settingsCard">
        <div class="cardHeader">
          <div>
            <h2 class="sectionTitle">外观</h2>
            <p class="tiny">工作台跟随你的选择，不会自动切换。</p>
          </div>
        </div>
        <div class="themeOptions">
          <button
            v-for="option in themeOptions"
            :key="option.key"
            :class="['themeCard', { isActive: appState.theme === option.key }]"
            @click="applyTheme(option.key)"
          >
            <div :class="['themePreview', option.key]">
              <span class="previewNav" />
              <span class="previewPanel" />
            </div>
            <span>{{ option.label }}</span>
            <component :is="appState.theme === option.key ? icons.check : icons.circle" :size="14" class="themeCheck" />
          </button>
        </div>
      </section>

      <section class="settingsCard">
        <div class="cardHeader">
          <div>
            <h2 class="sectionTitle">生成默认项</h2>
            <p class="tiny">新建任务时优先使用的模型与参数。</p>
          </div>
        </div>
        <div class="settingRow">
          <div>
            <strong>默认模型</strong>
            <span class="tiny">图片与视频任务分别记忆</span>
          </div>
          <button class="selectButton">
            {{ defaultModel }}
            <component :is="icons.chevron" :size="13" />
          </button>
        </div>
        <div class="settingRow">
          <div>
            <strong>自动保存画布</strong>
            <span class="tiny">拖动节点后自动写入后端</span>
          </div>
          <button :class="['switch', { isOn: autoSave }]" @click="autoSave = !autoSave">
            <span />
          </button>
        </div>
        <div class="settingRow">
          <div>
            <strong>生成前确认参数</strong>
            <span class="tiny">提交前检查比例、清晰度与积分</span>
          </div>
          <button :class="['switch', { isOn: confirmBeforeRun }]" @click="confirmBeforeRun = !confirmBeforeRun">
            <span />
          </button>
        </div>
      </section>

      <section class="settingsCard">
        <div class="cardHeader">
          <div>
            <h2 class="sectionTitle">存储与数据</h2>
            <p class="tiny">媒体与画布存放在本地数据目录。</p>
          </div>
        </div>
        <div class="storageRow">
          <div class="storageInfo">
            <strong>本地工作目录</strong>
            <code>~/Library/Application Support/YunHai/data</code>
          </div>
          <button class="ghostButton isBordered" @click="showToast('已打开目录选择器')">更换目录</button>
        </div>
        <div class="usageRow">
          <div class="usageTrack"><div class="usageFill" /></div>
          <span class="tiny">已用 95 GB / 1000 GB</span>
        </div>
      </section>

      <section class="settingsCard isAbout">
        <img src="/logo.svg" alt="云海" class="aboutLogo" />
        <div>
          <strong>云海创作台</strong>
          <span class="tiny">云海科技 · YunHai Studio · v0.1.0</span>
        </div>
        <span class="pill">Electron + Vue 3 + TypeScript</span>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { Check, ChevronDown, Circle, Coins } from "lucide-vue-next";
import { appState, applyTheme, formatCredits, showToast } from "@/lib/store";

const icons = { check: Check, circle: Circle, chevron: ChevronDown, coin: Coins };
const router = useRouter();
const defaultModel = ref("Seedream 图片");
const autoSave = ref(true);
const confirmBeforeRun = ref(true);

const themeOptions = [
  { key: "light" as const, label: "浅色" },
  { key: "dark" as const, label: "深色" },
];
</script>

<style scoped>
.pageHeader {
  padding-top: 20px;
}

.settingsGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 24px;
  max-width: 1080px;
}

.settingsCard {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px;
  border-radius: var(--radiusLg);
  background: var(--panel);
  border: 1px solid var(--border);
}

.cardHeader {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.profileRow {
  display: flex;
  align-items: center;
  gap: 12px;
}

.profileAvatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
}

.profileAvatar.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(140deg, #2b3a6b, #10121c);
  color: #fff;
  font-size: 16px;
}

.profileInfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.profileInfo strong {
  font-size: 13px;
  font-weight: 500;
}

.creditBadge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--panelSoft);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--textSecondary);
}

.creditBadge svg {
  color: var(--warning);
}

.cardActions {
  display: flex;
  gap: 8px;
}

.dangerText {
  color: var(--danger);
}

.themeOptions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.themeCard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  text-align: left;
  font-size: 12px;
}

.themeCard.isActive {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.themePreview {
  height: 74px;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  overflow: hidden;
}

.themePreview.light {
  background: #f5f5f6;
}

.themePreview.dark {
  background: #0b0c10;
}

.previewNav {
  width: 30%;
  border-right: 1px solid rgba(128, 128, 140, 0.25);
}

.previewPanel {
  flex: 1;
  margin: 8px;
  border-radius: 5px;
}

.themePreview.light .previewNav {
  background: #ececee;
}

.themePreview.light .previewPanel {
  background: #ffffff;
}

.themePreview.dark .previewNav {
  background: #14151a;
}

.themePreview.dark .previewPanel {
  background: #1b1c23;
}

.themeCheck {
  position: absolute;
  top: 14px;
  right: 14px;
  color: var(--accent);
}

.settingRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settingRow div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settingRow strong {
  font-size: 12px;
  font-weight: 500;
}

.selectButton {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--textSecondary);
}

.switch {
  width: 34px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--bgDeep);
  border: 1px solid var(--border);
  padding: 2px;
}

.switch span {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--textTertiary);
  transition: transform 0.18s ease;
}

.switch.isOn {
  background: var(--accent);
  border-color: transparent;
}

.switch.isOn span {
  transform: translateX(14px);
  background: #fff;
}

.storageRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.storageInfo {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.storageInfo strong {
  font-size: 12px;
  font-weight: 500;
}

.storageInfo code {
  font-family: var(--fontMono);
  font-size: 10px;
  color: var(--textTertiary);
}

.usageRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.usageTrack {
  flex: 1;
  height: 5px;
  border-radius: 999px;
  background: var(--bgDeep);
  overflow: hidden;
}

.usageFill {
  width: 9.5%;
  height: 100%;
  background: var(--accent);
}

.settingsCard.isAbout {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  grid-column: 1 / -1;
}

.aboutLogo {
  width: 38px;
  height: 38px;
  border-radius: 11px;
}

.isAbout div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.isAbout strong {
  font-size: 13px;
  font-weight: 500;
}
</style>
