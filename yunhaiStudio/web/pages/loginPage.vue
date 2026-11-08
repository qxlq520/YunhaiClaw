<template>
  <div class="loginPage">
    <div class="loginGlow" />
    <div class="loginCard">
      <div class="brandRow">
        <img src="/logo.svg" alt="云海" class="brandMark" />
        <div class="brandText">
          <strong>云海创作台</strong>
          <span>YunHai Studio · 云海科技</span>
        </div>
      </div>

      <h1 class="loginTitle">让一个故事，从文字走向银幕</h1>
      <p class="loginSubtitle">登录后继续你的画布、短剧项目与生成任务。</p>

      <form class="loginForm" @submit.prevent="login">
        <label class="field">
          <span>账号</span>
          <input v-model="username" autocomplete="username" placeholder="用户名 / 邮箱" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="至少 8 位" />
        </label>

        <div class="formRow">
          <label class="remember">
            <input v-model="remember" type="checkbox" />
            <span>记住我</span>
          </label>
          <button type="button" class="linkButton">忘记密码？</button>
        </div>

        <p v-if="errorMessage" class="loginError">{{ errorMessage }}</p>

        <button class="primaryButton loginButton" type="submit" :disabled="loading">
          {{ loading ? "正在登录…" : "登录" }}
        </button>
      </form>

      <div class="loginFooter">
        <span class="tiny">{{ firstUser ? "首次使用，将创建管理员账号" : "还没有账号？输入密码即可自动注册" }}</span>
        <button class="ghostButton" type="button" :disabled="loading" @click="login">继续</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";
import { appState } from "@/lib/store";

const router = useRouter();
const username = ref("");
const password = ref("");
const remember = ref(true);
const loading = ref(false);
const errorMessage = ref("");
const firstUser = ref(false);

onMounted(async () => {
  try {
    const settings = await api.get<{ firstUser: boolean }>("/auth/settings");
    firstUser.value = settings.firstUser;
  } catch {
    firstUser.value = false;
  }
});

async function login() {
  errorMessage.value = "";
  loading.value = true;
  try {
    const body = { username: username.value.trim(), password: password.value };
    const result = await api.post<{ user: { id: string; username: string; displayName: string; role: string } }>(
      firstUser.value ? "/auth/register" : "/auth/login",
      body,
    );
    appState.profile = {
      id: result.user.id,
      name: result.user.displayName || result.user.username,
      handle: `@${result.user.username}`,
      credits: 0,
      plan: result.user.role === "admin" ? "管理员" : "专业版",
      avatar: "",
    };
    await router.push("/create");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "登录失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.loginPage {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  overflow: hidden;
}

.loginGlow {
  position: absolute;
  width: 720px;
  height: 720px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(77, 107, 254, 0.22), transparent 62%);
  top: -220px;
  right: -120px;
  filter: blur(10px);
}

.loginCard {
  position: relative;
  width: 400px;
  padding: 32px;
  border-radius: 22px;
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: var(--shadowLg);
}

.brandRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brandMark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
}

.brandText {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.brandText strong {
  font-size: 14px;
  font-weight: 600;
}

.brandText span {
  font-size: 10px;
  color: var(--textTertiary);
}

.loginTitle {
  margin: 26px 0 0;
  font-size: 20px;
  line-height: 1.4;
  letter-spacing: -0.01em;
  font-weight: 600;
}

.loginSubtitle {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--textSecondary);
}

.loginForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 11px;
  color: var(--textSecondary);
}

.field input {
  height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panelSoft);
  outline: none;
  font-size: 13px;
}

.field input:focus {
  border-color: var(--accent);
  background: var(--panel);
}

.formRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.remember {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--textSecondary);
}

.linkButton {
  font-size: 11px;
  color: var(--accent);
}

.loginButton {
  height: 42px;
  margin-top: 4px;
}

.loginError {
  margin: 0;
  font-size: 11px;
  color: #e5484d;
}

.loginFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
</style>
