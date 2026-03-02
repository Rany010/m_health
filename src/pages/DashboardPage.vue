<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, clearToken } from "../services/api";

const router = useRouter();
const profile = ref(null);
const loading = ref(true);
const errorText = ref("");
const successText = ref("");
const saving = ref(false);
const plan = ref(null);
const forecast = ref(null);
const presets = ref({ foods: [], exercises: [] });
const selectedDate = ref(new Date().toISOString().slice(0, 10));
const calendarDays = ref([]);
const streakDays = ref(0);
const weekSuccessRate = ref(0);
const currentLog = ref({ foods: [], exercises: [], note: "" });
const creatingPlan = ref(false);
const planForm = ref({
  sex: "male",
  age: 30,
  height_cm: 170,
  current_weight: 75,
  target_weight: 68,
  desired_days: 90,
  activity_type: "sedentary",
  average_exercise_kcal: 150,
  start_date: new Date().toISOString().slice(0, 10)
});

const planProgress = computed(() => {
  if (!plan.value) return 0;
  const total = Number(plan.value.start_weight) - Number(plan.value.target_weight);
  if (total <= 0) return 100;
  const done = Number(plan.value.start_weight) - Number(plan.value.latest_weight);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
});

function todayMonthParams() {
  const d = new Date(selectedDate.value);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1
  };
}

function computeFoodKcal(item) {
  const preset = presets.value.foods.find((f) => f.food_name === item.food_name);
  if (!preset) return 0;
  const grams = Number(item.weight_g ?? 100);
  return Math.round((Number(preset.kcal_per_100g) * grams) / 100);
}

function computeExerciseKcal(item) {
  const preset = presets.value.exercises.find((e) => e.exercise_type === item.exercise_type);
  if (!preset) return 0;
  return Math.round(Number(preset.kcal_per_min) * Number(item.duration_min ?? 0));
}

function newFoodRow() {
  const first = presets.value.foods[0];
  return {
    food_name: first?.food_name ?? "",
    portion: "1份",
    weight_g: 100,
    kcal: first ? Math.round(first.kcal_per_100g) : 0
  };
}

function newExerciseRow() {
  const first = presets.value.exercises[0];
  return {
    exercise_type: first?.exercise_type ?? "",
    duration_min: 20,
    kcal: first ? Math.round(first.kcal_per_min * 20) : 0
  };
}

async function loadProfile() {
  loading.value = true;
  errorText.value = "";
  try {
    profile.value = await apiRequest("/me", { method: "GET" });
  } catch (error) {
    clearToken();
    errorText.value = "登录状态失效，请重新登录";
    await router.push("/");
  } finally {
    loading.value = false;
  }
}

async function loadActivePlan() {
  const payload = await apiRequest("/plan-active", { method: "GET" });
  plan.value = payload.plan;
}

async function loadPresets() {
  presets.value = await apiRequest("/presets", { method: "GET" });
}

async function loadCalendar() {
  if (!plan.value) return;
  const params = todayMonthParams();
  const payload = await apiRequest(
    `/calendar-month?plan_id=${plan.value.id}&year=${params.year}&month=${params.month}`,
    { method: "GET" }
  );
  calendarDays.value = payload.days;
  streakDays.value = payload.current_streak;
  weekSuccessRate.value = payload.week_success_rate;
}

async function loadForecast() {
  if (!plan.value) return;
  forecast.value = await apiRequest(`/forecast?plan_id=${plan.value.id}`, { method: "GET" });
}

async function loadDailyLog() {
  if (!plan.value) return;
  const payload = await apiRequest(
    `/daily-log-get?plan_id=${plan.value.id}&date=${selectedDate.value}`,
    { method: "GET" }
  );
  if (!payload.daily_log) {
    currentLog.value = { foods: [newFoodRow()], exercises: [newExerciseRow()], note: "" };
    return;
  }
  currentLog.value = {
    foods: payload.foods.map((f) => ({
      food_name: f.food_name,
      portion: f.portion,
      weight_g: f.weight_g ?? 100,
      kcal: f.kcal
    })),
    exercises: payload.exercises.map((e) => ({
      exercise_type: e.exercise_type,
      duration_min: e.duration_min,
      kcal: e.kcal
    })),
    note: payload.daily_log.note ?? ""
  };
}

async function createPlan() {
  creatingPlan.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    await apiRequest("/plan-create", {
      method: "POST",
      body: JSON.stringify(planForm.value)
    });
    successText.value = "计划已创建";
    await loadActivePlan();
    await loadCalendar();
    await loadForecast();
    await loadDailyLog();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    creatingPlan.value = false;
  }
}

async function saveDailyLog() {
  if (!plan.value) return;
  saving.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    const foods = currentLog.value.foods.map((f) => ({
      ...f,
      kcal: computeFoodKcal(f)
    }));
    const exercises = currentLog.value.exercises.map((e) => ({
      ...e,
      kcal: computeExerciseKcal(e)
    }));
    await apiRequest("/daily-log-upsert", {
      method: "POST",
      body: JSON.stringify({
        plan_id: plan.value.id,
        date: selectedDate.value,
        foods,
        exercises,
        note: currentLog.value.note
      })
    });
    successText.value = "当日记录已保存";
    await loadCalendar();
    await loadForecast();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    saving.value = false;
  }
}

async function saveWeight() {
  if (!plan.value) return;
  saving.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    await apiRequest("/weight-log-upsert", {
      method: "POST",
      body: JSON.stringify({
        plan_id: plan.value.id,
        date: selectedDate.value,
        weight: plan.value.latest_weight
      })
    });
    successText.value = "体重已更新并参与预测";
    await loadActivePlan();
    await loadForecast();
  } catch (error) {
    errorText.value = error.message;
  } finally {
    saving.value = false;
  }
}

function addFood() {
  currentLog.value.foods.push(newFoodRow());
}

function addExercise() {
  currentLog.value.exercises.push(newExerciseRow());
}

function removeFood(index) {
  currentLog.value.foods.splice(index, 1);
}

function removeExercise(index) {
  currentLog.value.exercises.splice(index, 1);
}

async function logout() {
  try {
    await apiRequest("/auth-logout", { method: "POST" });
  } catch (_error) {
    // Ignore backend error and clear local session anyway.
  }
  clearToken();
  await router.push("/");
}

watch(
  selectedDate,
  async () => {
    if (!plan.value) return;
    await loadCalendar();
    await loadDailyLog();
  },
  { immediate: false }
);

onMounted(async () => {
  await loadProfile();
  await loadPresets();
  await loadActivePlan();
  if (plan.value) {
    await loadCalendar();
    await loadForecast();
    await loadDailyLog();
  }
});
</script>

<template>
  <main class="container">
    <section class="card">
      <h1 class="title">工作台</h1>
      <p class="muted">账号：{{ profile?.account_id }}，当前已进入严格MVP功能闭环。</p>
      <button class="secondary" type="button" @click="logout">退出登录</button>
      <p v-if="errorText" class="error">{{ errorText }}</p>
      <p v-if="successText" class="success">{{ successText }}</p>
    </section>

    <section v-if="!plan" class="card">
      <h2 class="title" style="font-size: 18px">创建减脂计划</h2>
      <div class="row">
        <div>
          <label>性别</label>
          <select v-model="planForm.sex">
            <option value="male">男</option>
            <option value="female">女</option>
          </select>
        </div>
        <div>
          <label>年龄</label>
          <input v-model.number="planForm.age" type="number" min="12" max="90" />
        </div>
        <div>
          <label>身高(cm)</label>
          <input v-model.number="planForm.height_cm" type="number" min="120" max="220" />
        </div>
      </div>
      <div class="row">
        <div>
          <label>当前体重(kg)</label>
          <input
            v-model.number="planForm.current_weight"
            type="number"
            min="20"
            max="250"
            step="0.1"
          />
        </div>
        <div>
          <label>目标体重(kg)</label>
          <input
            v-model.number="planForm.target_weight"
            type="number"
            min="20"
            max="250"
            step="0.1"
          />
        </div>
        <div>
          <label>期望周期(天)</label>
          <input
            v-model.number="planForm.desired_days"
            type="number"
            min="30"
            max="365"
          />
        </div>
      </div>
      <div class="row">
        <div>
          <label>活动水平</label>
          <select v-model="planForm.activity_type">
            <option value="sedentary">久坐</option>
            <option value="light">轻度</option>
            <option value="moderate">中度</option>
            <option value="high">高活动</option>
          </select>
        </div>
        <div>
          <label>平均运动消耗(kcal/天)</label>
          <input
            v-model.number="planForm.average_exercise_kcal"
            type="number"
            min="0"
            max="1200"
          />
        </div>
        <div>
          <label>开始日期</label>
          <input v-model="planForm.start_date" type="date" />
        </div>
      </div>
      <button type="button" :disabled="creatingPlan" @click="createPlan">
        {{ creatingPlan ? "创建中..." : "创建计划" }}
      </button>
    </section>

    <section v-if="plan" class="card">
      <h2 class="title" style="font-size: 18px">计划进度</h2>
      <p>当前体重：{{ plan.latest_weight }}kg → 目标 {{ plan.target_weight }}kg</p>
      <p>每日摄入目标：{{ plan.daily_kcal_target }} kcal（缺口 {{ plan.daily_deficit_target }}）</p>
      <p>进度：{{ planProgress }}%</p>
      <div class="row">
        <div>
          <label>更新体重(kg)</label>
          <input
            v-model.number="plan.latest_weight"
            type="number"
            min="20"
            max="250"
            step="0.1"
          />
        </div>
        <div style="align-self: end">
          <button type="button" :disabled="saving" @click="saveWeight">保存体重</button>
        </div>
      </div>
      <p class="muted">
        连续达标 {{ streakDays }} 天；本周成功率 {{ weekSuccessRate }}%；预计达成
        {{ forecast?.estimated_finish_date || "待计算" }}
      </p>
    </section>

    <section v-if="plan" class="card">
      <h2 class="title" style="font-size: 18px">执行日历</h2>
      <div class="row">
        <div>
          <label>选择日期</label>
          <input v-model="selectedDate" type="date" />
        </div>
      </div>
      <div class="calendar">
        <div
          v-for="day in calendarDays"
          :key="day.date"
          class="day-cell"
          :class="`state-${day.status}`"
          @click="selectedDate = day.date"
        >
          {{ day.date.slice(-2) }}
        </div>
      </div>
    </section>

    <section v-if="plan" class="card">
      <h2 class="title" style="font-size: 18px">每日记录（{{ selectedDate }}）</h2>
      <h3 style="font-size: 16px">食物</h3>
      <div v-for="(food, index) in currentLog.foods" :key="`food-${index}`" class="row">
        <div>
          <label>食物</label>
          <select v-model="food.food_name" @change="food.kcal = computeFoodKcal(food)">
            <option v-for="item in presets.foods" :key="item.food_name" :value="item.food_name">
              {{ item.food_name }} ({{ item.kcal_per_100g }} kcal/100g)
            </option>
          </select>
        </div>
        <div>
          <label>克重(g)</label>
          <input
            v-model.number="food.weight_g"
            type="number"
            min="10"
            max="1000"
            @input="food.kcal = computeFoodKcal(food)"
          />
        </div>
        <div>
          <label>热量(kcal)</label>
          <input :value="computeFoodKcal(food)" disabled />
        </div>
        <div>
          <label>操作</label>
          <button class="danger" type="button" @click="removeFood(index)">删除</button>
        </div>
      </div>
      <button type="button" class="secondary" style="margin-bottom: 12px" @click="addFood">
        + 添加食物
      </button>

      <h3 style="font-size: 16px">运动</h3>
      <div v-for="(exercise, index) in currentLog.exercises" :key="`exercise-${index}`" class="row">
        <div>
          <label>类型</label>
          <select
            v-model="exercise.exercise_type"
            @change="exercise.kcal = computeExerciseKcal(exercise)"
          >
            <option
              v-for="item in presets.exercises"
              :key="item.exercise_type"
              :value="item.exercise_type"
            >
              {{ item.exercise_type }} ({{ item.kcal_per_min }} kcal/分钟)
            </option>
          </select>
        </div>
        <div>
          <label>时长(分钟)</label>
          <input
            v-model.number="exercise.duration_min"
            type="number"
            min="0"
            max="240"
            @input="exercise.kcal = computeExerciseKcal(exercise)"
          />
        </div>
        <div>
          <label>消耗(kcal)</label>
          <input :value="computeExerciseKcal(exercise)" disabled />
        </div>
        <div>
          <label>操作</label>
          <button class="danger" type="button" @click="removeExercise(index)">删除</button>
        </div>
      </div>
      <button
        type="button"
        class="secondary"
        style="margin-bottom: 12px"
        @click="addExercise"
      >
        + 添加运动
      </button>

      <label>备注</label>
      <textarea v-model="currentLog.note" rows="3" placeholder="可选"></textarea>
      <div style="margin-top: 12px">
        <button type="button" :disabled="saving || loading" @click="saveDailyLog">
          {{ saving ? "保存中..." : "保存当日记录" }}
        </button>
      </div>
    </section>
  </main>
</template>
