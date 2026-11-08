import { reactive } from "vue";
import { api } from "@/api/client";

export interface Profile {
  id: string;
  name: string;
  handle: string;
  credits: number;
  plan: string;
  avatar: string;
}

const themeKey = "yunhai.theme";

export const appState = reactive({
  ready: false,
  theme: (localStorage.getItem(themeKey) as "light" | "dark") ?? "light",
  profile: null as Profile | null,
  toast: "",
  toastTimer: 0,
});

export function applyTheme(theme: "light" | "dark") {
  appState.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeKey, theme);
}

export function toggleTheme() {
  applyTheme(appState.theme === "light" ? "dark" : "light");
}

export function showToast(message: string) {
  appState.toast = message;
  window.clearTimeout(appState.toastTimer);
  appState.toastTimer = window.setTimeout(() => {
    appState.toast = "";
  }, 2200);
}

export async function initApp() {
  applyTheme(appState.theme);
  try {
    appState.profile = await api.get<Profile>("/me");
  } catch {
    appState.profile = {
      id: "local",
      name: "云海导演",
      handle: "@yunhai",
      credits: 9963.73,
      plan: "专业版",
      avatar: "",
    };
  } finally {
    appState.ready = true;
  }
}

export function formatCredits(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
