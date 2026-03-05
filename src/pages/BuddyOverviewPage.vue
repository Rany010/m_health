<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiRequest } from "../services/api";

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const errorText = ref("");
const successText = ref("");
const payload = ref(null);
const selectedDate = ref("");

const buddyAccountId = computed(() => String(route.params.accountId ?? ""));
const buddyName = computed(() => payload.value?.buddy?.nickname || payload.value?.buddy?.account_id || "--");
const metrics = computed(() => payload.value?.metrics ?? null);
const trendDays = computed(() => payload.value?.trend?.days ?? []);
const calendarDays = computed(() => payload.value?.calendar?.days ?? []);
const selectedStatus = computed(() => payload.value?.selected_date ?? null);

function statusClass(status) {
  if (status === "green") return "status-green";
  if (status === "yellow") return "status-yellow";
  if (status === "red") return "status-red";
  return "status-gray";
}

function statusLabel(status) {
  if (status === "green") return "达标";
  if (status === "yellow") return "接近";
  if (status === "red") return "未达标";
  return "未记录";
}

async function loadOverview() {
  loading.value = true;
  errorText.value = "";
  try {
    const params = new URLSearchParams({
      account_id: buddyAccountId.value
    });
    if (selectedDate.value) {
      params.set("selected_date", selectedDate.value);
    }
    const data = await apiRequest(`/buddy-overview?${params.toString()}`, { method: "GET" });
    payload.value = data;
    if (!selectedDate.value) {
      selectedDate.value = data?.selected_date?.date || "";
    }
  } catch (error) {
    errorText.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function sendCheer() {
  errorText.value = "";
  successText.value = "";
  try {
    await apiRequest("/buddy-cheer", {
      method: "POST",
      body: JSON.stringify({ account_id: buddyAccountId.value })
    });
    successText.value = "已送出加油";
  } catch (error) {
    errorText.value = error.message;
  }
}

watch(
  () => route.params.accountId,
  () => {
    selectedDate.value = "";
    loadOverview();
  }
);

watch(selectedDate, async (value, oldValue) => {
  if (!value || value === oldValue) return;
  await loadOverview();
});

onMounted(loadOverview);
</script>

<template>
  <main class="container buddy-page">
    <section class="buddy-header">
      <button type="button" class="back-btn" @click="router.push('/dashboard')">返回工作台</button>
      <h1>{{ buddyName }} 的执行概览</h1>
      <button type="button" class="cheer-btn" @click="sendCheer">👏 给TA加油</button>
    </section>
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-if="successText" class="success">{{ successText }}</p>

    <section v-if="loading" class="panel"><p>加载中...</p></section>

    <section v-else-if="payload" class="panel-grid">
      <article class="panel metrics">
        <p>当前 streak：<strong>🔥 {{ metrics?.current_streak ?? 0 }}</strong></p>
        <p>本周成功率：<strong>{{ metrics?.week_success_rate ?? 0 }}%</strong></p>
        <p>共同 streak：<strong>🔥 {{ metrics?.common_streak ?? 0 }}</strong></p>
        <p>预计达标：<strong>{{ metrics?.estimated_finish_date || "待预测" }}</strong></p>
        <label>
          查看日期
          <input v-model="selectedDate" type="date" />
        </label>
        <p v-if="selectedStatus">
          当日你：<strong>{{ statusLabel(selectedStatus.self_status) }}</strong>
          ，TA：<strong>{{ statusLabel(selectedStatus.buddy_status) }}</strong>
        </p>
      </article>

      <article class="panel">
        <h3>最近14天执行</h3>
        <div class="trend-list">
          <div v-for="item in trendDays" :key="item.date" class="trend-item">
            <span>{{ item.date }}</span>
            <span class="status-pill" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
          </div>
        </div>
      </article>

      <article class="panel">
        <h3>当月状态日历</h3>
        <div class="calendar-grid">
          <div v-for="day in calendarDays" :key="day.date" class="calendar-item" :class="statusClass(day.status)">
            <small>{{ day.date.slice(8) }}</small>
            <span>{{ statusLabel(day.status) }}</span>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.buddy-page {
  padding-bottom: 30px;
}

.buddy-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.buddy-header h1 {
  margin: 0;
  font-size: 24px;
}

.back-btn,
.cheer-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  color: #fff;
  background: #1d4ed8;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.panel {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
}

.metrics p {
  margin: 0 0 8px;
}

.metrics label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.trend-list {
  display: grid;
  gap: 6px;
}

.trend-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  padding: 6px 8px;
}

.status-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.calendar-item {
  border-radius: 8px;
  padding: 6px 4px;
  text-align: center;
  font-size: 11px;
}

.status-green {
  background: rgba(34, 197, 94, 0.2);
}

.status-yellow {
  background: rgba(245, 158, 11, 0.2);
}

.status-red {
  background: rgba(239, 68, 68, 0.2);
}

.status-gray {
  background: rgba(100, 116, 139, 0.25);
}

@media (max-width: 900px) {
  .panel-grid {
    grid-template-columns: 1fr;
  }

  .buddy-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>

