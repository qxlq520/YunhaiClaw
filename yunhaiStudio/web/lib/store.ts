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

interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export async function initApp() {
  applyTheme(appState.theme);
  try {
    const result = await api.get<{ user: AuthUser }>("/auth/session");
    appState.profile = {
      id: result.user.id,
      name: result.user.displayName || result.user.username,
      handle: `@${result.user.username}`,
      credits: 0,
      plan: result.user.role === "admin" ? "管理员" : "专业版",
      avatar: "",
    };
  } catch {
    appState.profile = null;
  } finally {
    appState.ready = true;
  }
}

export function formatCredits(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
