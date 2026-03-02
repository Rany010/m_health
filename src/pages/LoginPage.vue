<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, setToken } from "../services/api";

const router = useRouter();
const mode = ref("login");
const accountId = ref("");
const password = ref("");
const nickname = ref("");
const errorText = ref("");
const successText = ref("");
const loading = ref(false);

function normalizeAccountId(input) {
  return input.replace(/\D/g, "").slice(0, 6);
}

async function submit() {
  errorText.value = "";
  successText.value = "";
  const normalized = normalizeAccountId(accountId.value);
  accountId.value = normalized;

  if (!/^\d{6}$/.test(normalized)) {
    errorText.value = "账号必须是6位数字";
    return;
  }
  if (password.value.length < 8) {
    errorText.value = "密码至少8位";
    return;
  }

  loading.value = true;
  try {
    const payload =
      mode.value === "register"
        ? await apiRequest("/auth-register", {
            method: "POST",
            body: JSON.stringify({
              account_id: normalized,
              password: password.value,
              nickname: nickname.value.trim()
            })
          })
        : await apiRequest("/auth-login", {
            method: "POST",
            body: JSON.stringify({
              account_id: normalized,
              password: password.value
            })
          });
    setToken(payload.token);
    successText.value = "登录成功，正在跳转...";
    await router.push("/dashboard");
  } catch (error) {
    errorText.value = error.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="container">
    <section class="card">
      <h1 class="title">mHealth Fat Loss Planner</h1>
      <p class="muted">
        使用6位数字账号登录。为防撞库，登录失败会触发限流与短时锁定。
      </p>
      <div class="row">
        <button
          :class="mode === 'login' ? '' : 'secondary'"
          type="button"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          :class="mode === 'register' ? '' : 'secondary'"
          type="button"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <div>
          <label>6位数字账号</label>
          <input
            v-model="accountId"
            inputmode="numeric"
            maxlength="6"
            placeholder="例如 102938"
            @input="accountId = normalizeAccountId(accountId)"
          />
        </div>
        <div>
          <label>密码（至少8位）</label>
          <input v-model="password" type="password" placeholder="请输入密码" />
        </div>
      </div>
      <div v-if="mode === 'register'" class="row" style="margin-top: 10px">
        <div>
          <label>昵称（可选）</label>
          <input v-model="nickname" maxlength="24" placeholder="昵称" />
        </div>
      </div>
      <div style="margin-top: 12px">
        <button type="button" :disabled="loading" @click="submit">
          {{ loading ? "处理中..." : mode === "register" ? "注册并登录" : "登录" }}
        </button>
      </div>
      <p v-if="errorText" class="error">{{ errorText }}</p>
      <p v-if="successText" class="success">{{ successText }}</p>
    </section>
  </main>
</template>
