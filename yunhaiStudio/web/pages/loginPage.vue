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
          <input v-model="account" autocomplete="username" placeholder="手机号 / 邮箱" />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" />
        </label>

        <div class="formRow">
          <label class="remember">
            <input v-model="remember" type="checkbox" />
            <span>记住我</span>
          </label>
          <button type="button" class="linkButton">忘记密码？</button>
        </div>

        <button class="primaryButton loginButton" type="submit" :disabled="loading">
          {{ loading ? "正在登录…" : "登录" }}
        </button>
      </form>

      <div class="loginFooter">
        <span class="tiny">演示账号：test / test123456</span>
        <button class="ghostButton" type="button" @click="login">体验演示</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";

const router = useRouter();
const account = ref("test");
const password = ref("test123456");
const remember = ref(true);
const loading = ref(false);

async function login() {
  loading.value = true;
  try {
    await api.post("/auth/login", { account: account.value || "test", password: password.value });
    await router.push("/create");
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

.loginFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
</style>
