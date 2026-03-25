<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, setToken } from "../services/api";

const router = useRouter();
const mode = ref("login");
const accountId = ref("");
const password = ref("");
const rememberSevenDays = ref(true);
const loading = ref(false);
const errorText = ref("");
const failCount = ref(0);
const lockUntilTs = ref(0);
const nowTs = ref(Date.now());
const weakAccounts = new Set(["000000", "123456", "111111"]);

let timerId = null;

function normalizeAccountId(input) {
  return input.replace(/\D/g, "").slice(0, 6);
}

const isValidAccountId = computed(() => /^\d{6}$/.test(accountId.value));
const isWeakAccount = computed(() => weakAccounts.has(accountId.value));
const isLocked = computed(() => nowTs.value < lockUntilTs.value);
const loginLocked = computed(() => mode.value === "login" && isLocked.value);
const canSubmit = computed(
  () => isValidAccountId.value && password.value.length >= 8 && !loginLocked.value && !loading.value
);
const lockRemainMs = computed(() => Math.max(lockUntilTs.value - nowTs.value, 0));
const lockRemainMinutes = computed(() => String(Math.floor(lockRemainMs.value / 60000)).padStart(2, "0"));
const lockRemainSeconds = computed(() =>
  String(Math.floor((lockRemainMs.value % 60000) / 1000)).padStart(2, "0")
);

async function submit() {
  errorText.value = "";
  accountId.value = normalizeAccountId(accountId.value);
  if (!canSubmit.value) {
    if (password.value.length > 0 && password.value.length < 8) {
      errorText.value = "密码至少8位。";
    }
    return;
  }

  loading.value = true;
  try {
    const endpoint = mode.value === "register" ? "/auth-register" : "/auth-login";
    const payload = await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        account_id: accountId.value,
        password: password.value
      })
    });
    setToken(payload.token);
    window.localStorage.setItem("mhealth_remember_7d", rememberSevenDays.value ? "1" : "0");
    await router.push("/dashboard");
  } catch (error) {
    const message = String(error?.message || "").trim();
    if (mode.value === "login") {
      if (message === "账号或密码错误") {
        failCount.value += 1;
        errorText.value = "账号或密码错误，请重试。";
        if (failCount.value >= 5) {
          lockUntilTs.value = Date.now() + 15 * 60 * 1000;
          errorText.value = "账号或密码错误，请稍后再试。";
        }
      } else {
        errorText.value = message || "登录失败，请稍后重试。";
      }
    } else {
      errorText.value = message || "注册失败，请稍后重试。";
    }
  } finally {
    loading.value = false;
  }
}

function switchMode(nextMode) {
  if (loading.value) return;
  mode.value = nextMode;
  errorText.value = "";
}

onMounted(() => {
  const rememberValue = window.localStorage.getItem("mhealth_remember_7d");
  if (rememberValue === "0") {
    rememberSevenDays.value = false;
  }
  timerId = window.setInterval(() => {
    nowTs.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timerId !== null) {
    window.clearInterval(timerId);
  }
});
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <div class="brand">
        <div class="logo">🔥</div>
        <h1>Fat Loss Planner</h1>
        <p>{{ mode === "login" ? "欢迎回来，继续保持节奏。" : "创建账号，开启你的减脂计划。" }}</p>
      </div>

      <form class="form" @submit.prevent="submit">
        <div class="field">
          <label for="account-id">Account ID (6 Digits)</label>
          <input
            id="account-id"
            v-model="accountId"
            inputmode="numeric"
            maxlength="6"
            placeholder="000000"
            :disabled="loginLocked || loading"
            @input="accountId = normalizeAccountId(accountId)"
          />
          <p v-if="accountId && !isValidAccountId" class="hint error-text">账号必须为6位数字。</p>
          <p v-if="isWeakAccount" class="hint warn-text">不建议使用弱账号（如000000/123456/111111）。</p>
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="••••••••"
            :disabled="loginLocked || loading"
          />
        </div>
        <p v-if="password && password.length < 8" class="hint error-text">密码至少8位。</p>

        <label class="remember">
          <input v-model="rememberSevenDays" type="checkbox" :disabled="loginLocked || loading" />
          <span>保持登录7天（会话自动续期）</span>
        </label>

        <p v-if="errorText" class="error-box">{{ errorText }}</p>
        <p v-if="loginLocked" class="lock-text">
          账号已锁定，请在 {{ lockRemainMinutes }}分{{ lockRemainSeconds }}秒后重试
        </p>

        <button class="submit-btn" type="submit" :disabled="!canSubmit">
          {{
            loading
              ? mode === "login"
                ? "SIGNING IN..."
                : "SIGNING UP..."
              : mode === "login"
                ? "SIGN IN"
                : "SIGN UP"
          }}
        </button>
      </form>

      <div class="entry-switch">
        <span>{{ mode === "login" ? "还没有账号？" : "已有账号？" }}</span>
        <button
          class="entry-link-btn"
          type="button"
          :disabled="loading"
          @click="switchMode(mode === 'login' ? 'register' : 'login')"
        >
          {{ mode === "login" ? "去注册" : "返回登录" }}
        </button>
      </div>

      <p class="security-note">Security Note: 5 failed attempts will lock your account for 15 minutes.</p>
      <p class="security-note">统一错误提示，不区分“账号不存在”与“密码错误”。</p>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #ffffff;
}

.login-card {
  width: 100%;
  max-width: 460px;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #0f172a;
  padding: 36px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
}

.brand {
  text-align: center;
  margin-bottom: 28px;
}

.logo {
  width: 56px;
  height: 56px;
  margin: 0 auto 12px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2563eb;
  color: #ffffff;
  font-size: 26px;
}

.brand h1 {
  margin: 0;
  color: #e2e8f0;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.brand p {
  margin: 8px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.form {
  display: grid;
  gap: 14px;
}

.field label {
  display: block;
  margin-bottom: 6px;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.field input[type="text"],
.field input[type="password"] {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 12px;
  padding: 12px 14px;
  outline: none;
  font-size: 15px;
  transition: border-color 0.2s, box-shadow 0.2s;
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}

.field input[type="text"] {
  text-align: center;
  letter-spacing: 0.2em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.field input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35);
}

.field input:disabled {
  background: rgba(148, 163, 184, 0.16);
  color: #94a3b8;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
}

.error-text {
  color: #dc2626;
}

.warn-text {
  color: #d97706;
}

.remember {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #cbd5e1;
  font-size: 12px;
}

.remember input {
  width: auto;
}

.error-box {
  margin: 0;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(127, 29, 29, 0.22);
  color: #fca5a5;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 12px;
}

.lock-text {
  margin: 0;
  color: #fcd34d;
  font-size: 12px;
}

.submit-btn {
  border: none;
  border-radius: 12px;
  padding: 13px 14px;
  background: #2563eb;
  color: #ffffff;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: background-color 0.2s;
}

.submit-btn:hover {
  background: #1d4ed8;
}

.submit-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.security-note {
  margin: 12px 0 0;
  text-align: center;
  color: #94a3b8;
  font-size: 11px;
}

.entry-switch {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.entry-link-btn {
  width: auto;
  border: none;
  background: transparent;
  color: #2563eb;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
}

.entry-link-btn:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

.entry-link-btn:disabled {
  color: #94a3b8;
  cursor: not-allowed;
  text-decoration: none;
}
</style>
