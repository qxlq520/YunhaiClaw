<template>
  <div class="appShell">
    <sideNav />
    <div class="shellMain">
      <topBar v-if="showChrome" />
      <main :class="['shellContent', { isFullscreen: !showChrome }]">
        <router-view v-slot="{ Component }">
          <transition name="pageFade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
    <transition name="toastFade">
      <div v-if="appState.toast" class="toast">{{ appState.toast }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import sideNav from "@/components/sideNav.vue";
import topBar from "@/components/topBar.vue";
import { appState } from "@/lib/store";

const route = useRoute();
const showChrome = computed(() => route.meta.chrome !== false);
</script>

<style scoped>
.shellMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.shellContent {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.shellContent.isFullscreen {
  overflow: hidden;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  transform: translateX(-50%);
  background: var(--active);
  color: var(--activeText);
  padding: 9px 16px;
  border-radius: 999px;
  font-size: 13px;
  box-shadow: var(--shadowMd);
  z-index: 300;
}

.pageFade-enter-active,
.pageFade-leave-active {
  transition: opacity 0.16s ease;
}

.pageFade-enter-from,
.pageFade-leave-to {
  opacity: 0;
}

.toastFade-enter-active,
.toastFade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toastFade-enter-from,
.toastFade-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
