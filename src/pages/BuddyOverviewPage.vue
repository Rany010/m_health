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
const suppressDateWatchOnce = ref(false);

const buddyAccountId = computed(() => String(route.params.accountId ?? ""));
const buddyName = computed(() => payload.value?.buddy?.nickname || payload.value?.buddy?.account_id || "--");
const metrics = computed(() => payload.value?.metrics ?? null);
const trendDays = computed(() => payload.value?.trend?.days ?? []);
const calendarDays = computed(() => payload.value?.calendar?.days ?? []);
const selectedStatus = computed(() => payload.value?.selected_date ?? null);
const calendarMonthLabel = computed(() => {
  const base = String(selectedDate.value || calendarDays.value[0]?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) {
    return "当月";
  }
  const d = new Date(`${base}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return `${base.slice(0, 7)} 状态日历`;
  }
  return `${d.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}状态日历`;
});

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
      const nextDate = String(data?.selected_date?.date || "");
      if (nextDate) {
        suppressDateWatchOnce.value = true;
        selectedDate.value = nextDate;
      }
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
  if (suppressDateWatchOnce.value) {
    suppressDateWatchOnce.value = false;
    return;
  }
  await loadOverview();
});

onMounted(loadOverview);
</script>

<template>
  <main class="container buddy-page">
    <section class="buddy-header">
      <button type="button" class="toolbar-btn ghost" @click="router.push('/dashboard')">
        返回工作台
      </button>
      <div class="title-block">
        <h1>{{ buddyName }} 的执行概览</h1>
        <p class="title-sub">账号 {{ payload?.buddy?.account_id || buddyAccountId }}</p>
      </div>
      <button type="button" class="toolbar-btn primary" @click="sendCheer">👏 给TA加油</button>
    </section>
    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-if="successText" class="success">{{ successText }}</p>

    <section v-if="loading" class="panel loading-panel">
      <p>加载中...</p>
    </section>

    <section v-else-if="payload" class="overview-grid">
      <article class="panel summary-panel">
        <div class="metric-grid">
          <div class="metric-card">
            <small>当前 streak</small>
            <strong>🔥 {{ metrics?.current_streak ?? 0 }}</strong>
          </div>
          <div class="metric-card">
            <small>本周成功率</small>
            <strong>{{ metrics?.week_success_rate ?? 0 }}%</strong>
          </div>
          <div class="metric-card">
            <small>共同 streak</small>
            <strong>🔥 {{ metrics?.common_streak ?? 0 }}</strong>
          </div>
          <div class="metric-card">
            <small>预计达标</small>
            <strong>{{ metrics?.estimated_finish_date || "待预测" }}</strong>
          </div>
        </div>

        <div class="detail-row">
          <label class="date-filter">
            <span>查看日期</span>
            <input v-model="selectedDate" type="date" />
          </label>
          <div v-if="selectedStatus" class="compare-box">
            <span class="compare-chip" :class="statusClass(selectedStatus.self_status)">
              你：{{ statusLabel(selectedStatus.self_status) }}
            </span>
            <span class="compare-chip" :class="statusClass(selectedStatus.buddy_status)">
              TA：{{ statusLabel(selectedStatus.buddy_status) }}
            </span>
          </div>
        </div>
      </article>

      <div class="content-grid">
        <article class="panel">
          <div class="panel-head">
            <h3>最近14天执行</h3>
            <small>按日状态同步</small>
          </div>
          <p v-if="trendDays.length === 0" class="muted-line">暂无趋势数据</p>
          <div v-else class="trend-list">
            <div v-for="item in trendDays" :key="item.date" class="trend-item">
              <span class="trend-date">{{ item.date }}</span>
              <span class="status-pill" :class="statusClass(item.status)">
                {{ statusLabel(item.status) }}
              </span>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-head">
            <h3>{{ calendarMonthLabel }}</h3>
            <small>{{ calendarDays.length }} 天</small>
          </div>
          <p v-if="calendarDays.length === 0" class="muted-line">暂无日历数据</p>
          <div v-else class="calendar-grid">
            <div
              v-for="day in calendarDays"
              :key="day.date"
              class="calendar-item"
              :class="statusClass(day.status)"
            >
              <small class="day-num">{{ day.date.slice(8) }}</small>
              <span class="day-status">{{ statusLabel(day.status) }}</span>
            </div>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.buddy-page {
  padding-bottom: 24px;
}

.buddy-header {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #0f172a;
  padding: 12px 14px;
  margin-bottom: 10px;
}

.title-block {
  min-width: 0;
  flex: 1;
}

.title-block h1 {
  margin: 0;
  font-size: 24px;
  color: #e2e8f0;
}

.title-sub {
  margin: 2px 0 0;
  color: #94a3b8;
  font-size: 12px;
}

.toolbar-btn {
  width: auto;
  border: none;
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.toolbar-btn.primary {
  background: #2563eb;
  color: #ffffff;
}

.toolbar-btn.ghost {
  background: #334155;
  color: #e2e8f0;
}

.overview-grid {
  display: grid;
  gap: 12px;
}

.panel {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
}

.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  padding: 10px;
}

.metric-card small {
  display: block;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 6px;
}

.metric-card strong {
  font-size: 20px;
  color: #e2e8f0;
}

.detail-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.date-filter {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #94a3b8;
  font-size: 12px;
}

.date-filter input {
  width: auto;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  color-scheme: dark;
}

.compare-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.compare-chip {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.panel-head h3 {
  margin: 0;
  font-size: 17px;
}

.panel-head small {
  color: #94a3b8;
  font-size: 11px;
}

.muted-line {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
}

.trend-list {
  display: grid;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
  padding-right: 2px;
}

.trend-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
}

.trend-date {
  font-size: 13px;
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
}

.status-pill {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.calendar-item {
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  min-height: 74px;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 11px;
  background: #24334a;
}

.day-num {
  font-size: 12px;
  font-weight: 700;
  color: #e2e8f0;
}

.day-status {
  color: #cbd5e1;
  font-size: 11px;
}

.status-green {
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.52);
  background: rgba(34, 197, 94, 0.16);
}

.status-yellow {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.52);
  background: rgba(245, 158, 11, 0.16);
}

.status-red {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.52);
  background: rgba(239, 68, 68, 0.14);
}

.status-gray {
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.14);
}

.calendar-item.status-green .day-num,
.calendar-item.status-green .day-status {
  color: #86efac;
}

.calendar-item.status-yellow .day-num,
.calendar-item.status-yellow .day-status {
  color: #fde68a;
}

.calendar-item.status-red .day-num,
.calendar-item.status-red .day-status {
  color: #fca5a5;
}

@media (max-width: 900px) {
  .buddy-header {
    flex-wrap: wrap;
  }

  .toolbar-btn {
    width: 100%;
  }

  .metric-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .detail-row {
    flex-direction: column;
    align-items: stretch;
  }

  .date-filter input {
    width: 100%;
  }

  .calendar-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
