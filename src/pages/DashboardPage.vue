<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, clearToken } from "../services/api";

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const router = useRouter();
const profile = ref(null);
const loading = ref(true);
const errorText = ref("");
const successText = ref("");
const saving = ref(false);
const plan = ref(null);
const forecast = ref(null);
const presets = ref({ foods: [], exercises: [] });
const todayDate = localDateString();
const selectedDate = ref(todayDate);
const calendarDays = ref([]);
const streakDays = ref(0);
const weekSuccessRate = ref(0);
const currentLog = ref({ foods: [], exercises: [], note: "" });
const creatingPlan = ref(false);
const planStep = ref(1);
const planForm = ref({
  sex: "male",
  age: 28,
  height_cm: 175,
  current_weight: 85,
  target_weight: 68,
  desired_days: 120,
  activity_type: "sedentary",
  average_exercise_kcal: 220,
  work_type: "sedentary",
  steps_tier: "3000_6000",
  commute_type: "bus",
  sleep_tier: "normal",
  exercise_freq: 2,
  exercise_duration: 40,
  exercise_types: ["run"],
  expected_weeks: 12,
  start_date: todayDate
});
const activityLevelOptions = [
  { key: "sedentary", label: "久坐", factor: 1.2, desc: "办公族，极少运动" },
  { key: "light", label: "轻度", factor: 1.3, desc: "偶尔步行，家务劳动" },
  { key: "moderate", label: "中度", factor: 1.45, desc: "每周运动3-5次" },
  { key: "high", label: "高强度", factor: 1.6, desc: "高体力或每日训练" }
];
const workTypeOptions = [
  { key: "sedentary", label: "久坐办公", desc: "长期坐姿工作" },
  { key: "standing", label: "站立服务", desc: "长时间站立，活动中等" },
  { key: "labor", label: "体力工作", desc: "日常体力消耗较高" }
];
const exerciseTypeOptions = [
  { key: "run", label: "跑步" },
  { key: "strength", label: "力量" },
  { key: "swim", label: "游泳" },
  { key: "ride", label: "骑行" },
  { key: "ball", label: "球类" },
  { key: "hiit", label: "HIIT" }
];
const mealGroups = [
  { key: "breakfast", label: "早餐" },
  { key: "lunch", label: "午餐" },
  { key: "dinner", label: "晚餐" }
];
const quickAddMealType = ref("breakfast");

const planProgress = computed(() => {
  if (!plan.value) return 0;
  const total = Number(plan.value.start_weight) - Number(plan.value.target_weight);
  if (total <= 0) return 100;
  const done = Number(plan.value.start_weight) - Number(plan.value.latest_weight);
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
});
const selectedActivityFactor = computed(() => {
  const found = activityLevelOptions.find((item) => item.key === planForm.value.activity_type);
  return found ? found.factor : 1.2;
});
const averageExerciseKcal = computed(() =>
  Math.round(
    (Number(planForm.value.exercise_freq) * Number(planForm.value.exercise_duration) * 8) / 7
  )
);
const calculatedBmr = computed(() => {
  const base =
    10 * Number(planForm.value.current_weight) +
    6.25 * Number(planForm.value.height_cm) -
    5 * Number(planForm.value.age);
  return Math.round(planForm.value.sex === "male" ? base + 5 : base - 161);
});
const calculatedTdee = computed(() =>
  Math.round(calculatedBmr.value * selectedActivityFactor.value + averageExerciseKcal.value)
);
const planDays = computed(() => Math.max(Number(planForm.value.expected_weeks) * 7, 7));
const recommendedDeficit = computed(() => {
  const weightDiff = Math.max(
    0,
    Number(planForm.value.current_weight) - Number(planForm.value.target_weight)
  );
  if (weightDiff <= 0) return 300;
  const deficit = Math.round((weightDiff * 7700) / Math.max(1, Number(planDays.value)));
  if (deficit < 300) return 300;
  if (deficit > 900) return 900;
  return deficit;
});
const dailyIntakeFloor = computed(() => (planForm.value.sex === "male" ? 1200 : 1000));
const dailyIntakeRaw = computed(() => calculatedTdee.value - recommendedDeficit.value);
const dailyIntakeTarget = computed(() => Math.max(dailyIntakeRaw.value, dailyIntakeFloor.value));
const weeklyLossKg = computed(() => (recommendedDeficit.value * 7 / 7700).toFixed(2));
const isTooFast = computed(() => Number(weeklyLossKg.value) > 1.0);
const planEndDate = computed(() => {
  const end = new Date(planForm.value.start_date);
  end.setDate(end.getDate() + planDays.value);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const d = String(end.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
});
const canActivatePlan = computed(
  () =>
    Number(planForm.value.current_weight) > Number(planForm.value.target_weight) &&
    Number(planForm.value.age) >= 12 &&
    Number(planForm.value.height_cm) >= 120
);
const monthLabel = computed(() => {
  const base = selectedDate.value || todayDate;
  const d = new Date(`${base}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return base.slice(0, 7);
  }
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
});
const forecastDateLabel = computed(() => forecast.value?.estimated_finish_date || "待计算");
const currentWeightNum = computed(() => Number(plan.value?.latest_weight ?? plan.value?.start_weight ?? 0));
const targetWeightNum = computed(() => Number(plan.value?.target_weight ?? 0));
const intakeTotal = computed(() =>
  currentLog.value.foods.reduce((sum, item) => sum + toNonNegativeInt(item.kcal), 0)
);
const exerciseTotal = computed(() =>
  currentLog.value.exercises.reduce((sum, item) => sum + toNonNegativeInt(item.kcal), 0)
);
const previewDeficit = computed(() => {
  const tdee = Number(plan.value?.tdee ?? 0);
  return tdee - intakeTotal.value + exerciseTotal.value;
});
const quickFoods = computed(() => presets.value.foods.slice(0, 6));
const selectedCalendarDay = computed(() => {
  const selected = calendarDays.value.find((day) => day.date === selectedDate.value);
  return selected || null;
});
const continuousFailDays = computed(() => {
  let count = 0;
  for (let i = calendarDays.value.length - 1; i >= 0; i -= 1) {
    if (calendarDays.value[i].status === "red") {
      count += 1;
    } else {
      break;
    }
  }
  return count;
});
const forecastPaused = computed(() => {
  const recent = calendarDays.value.slice(-3);
  return recent.length === 3 && recent.every((day) => day.status === "gray");
});

function dayNumberLabel(dateValue) {
  if (!dateValue) return "";
  const value = String(dateValue);
  return value.length >= 2 ? value.slice(-2) : value;
}

function statusClass(status) {
  if (status === "green") return "status-green";
  if (status === "yellow") return "status-yellow";
  if (status === "red") return "status-red";
  return "status-gray";
}

function todayMonthParams() {
  const d = new Date(selectedDate.value);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1
  };
}

function normalizeMealType(value) {
  if (value === "breakfast" || value === "lunch" || value === "dinner") {
    return value;
  }
  return "breakfast";
}

function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function computeFoodKcal(item) {
  const preset = presets.value.foods.find((f) => f.food_name === item.food_name);
  if (!preset) return 0;
  const grams = toNonNegativeInt(item.weight_g ?? 100);
  return Math.round((Number(preset.kcal_per_100g) * grams) / 100);
}

function computeExerciseKcal(item) {
  const preset = presets.value.exercises.find((e) => e.exercise_type === item.exercise_type);
  if (!preset) return 0;
  return Math.round(Number(preset.kcal_per_min) * toNonNegativeInt(item.duration_min ?? 0));
}

function isExerciseManualKcal(exerciseType, durationMin, kcal) {
  if (!exerciseType) return true;
  const expected = computeExerciseKcal({ exercise_type: exerciseType, duration_min: durationMin });
  return expected !== toNonNegativeInt(kcal);
}

function syncFoodKcal(item) {
  item.kcal = computeFoodKcal(item);
}

function foodsByMeal(mealType) {
  return currentLog.value.foods.filter((item) => normalizeMealType(item.meal_type) === mealType);
}

function syncExerciseKcal(item) {
  if (item.manual_kcal) return;
  item.kcal = computeExerciseKcal(item);
}

function onExerciseTypeChange(item) {
  if (!item.exercise_type) {
    item.manual_kcal = true;
    item.duration_min = 0;
    item.kcal = 0;
    return;
  }
  item.manual_kcal = false;
  item.kcal = computeExerciseKcal(item);
}

function onExerciseDurationInput(item) {
  item.duration_min = toNonNegativeInt(item.duration_min ?? 0);
  syncExerciseKcal(item);
}

function onExerciseKcalInput(item) {
  item.manual_kcal = true;
  item.kcal = toNonNegativeInt(item.kcal ?? 0);
}

function newFoodRow(mealType = "breakfast") {
  const first = presets.value.foods[0];
  return {
    id: null,
    meal_type: normalizeMealType(mealType),
    food_name: first?.food_name ?? "",
    portion: "1份",
    weight_g: 100,
    kcal: first ? Math.round(first.kcal_per_100g) : 0
  };
}

function newExerciseRow() {
  return {
    id: null,
    exercise_type: "",
    duration_min: 0,
    kcal: 0,
    manual_kcal: true
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
  const foods = payload.foods.map((f) => ({
    id: f.id,
    meal_type: normalizeMealType(f.meal_type),
    food_name: f.food_name,
    portion: f.portion,
    weight_g: toNonNegativeInt(f.weight_g ?? 100),
    kcal: toNonNegativeInt(f.kcal)
  }));
  const exercises = payload.exercises.map((e) => ({
    id: e.id,
    exercise_type: String(e.exercise_type ?? ""),
    duration_min: toNonNegativeInt(e.duration_min),
    kcal: toNonNegativeInt(e.kcal),
    manual_kcal: isExerciseManualKcal(
      String(e.exercise_type ?? ""),
      toNonNegativeInt(e.duration_min),
      toNonNegativeInt(e.kcal)
    )
  }));
  currentLog.value = {
    foods: foods.length > 0 ? foods : [newFoodRow()],
    exercises: exercises.length > 0 ? exercises : [newExerciseRow()],
    note: payload.daily_log.note ?? ""
  };
}

async function createPlan() {
  if (!canActivatePlan.value) {
    errorText.value = "请检查输入：当前体重需大于目标体重，且年龄/身高需要在合理范围。";
    return;
  }
  creatingPlan.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    await apiRequest("/plan-create", {
      method: "POST",
      body: JSON.stringify({
        sex: planForm.value.sex,
        age: Number(planForm.value.age),
        height_cm: Number(planForm.value.height_cm),
        current_weight: Number(planForm.value.current_weight),
        target_weight: Number(planForm.value.target_weight),
        desired_days: Number(planDays.value),
        activity_type: planForm.value.activity_type,
        average_exercise_kcal: Number(averageExerciseKcal.value),
        start_date: planForm.value.start_date
      })
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
      id: f.id ?? null,
      meal_type: normalizeMealType(f.meal_type),
      food_name: String(f.food_name ?? ""),
      portion: String(f.portion ?? "1份"),
      weight_g: toNonNegativeInt(f.weight_g ?? 0),
      kcal: toNonNegativeInt(f.kcal)
    }));
    const exercises = currentLog.value.exercises.map((e) => ({
      id: e.id ?? null,
      exercise_type: String(e.exercise_type ?? ""),
      duration_min: toNonNegativeInt(e.duration_min ?? 0),
      kcal: toNonNegativeInt(e.kcal),
      manual_kcal: Boolean(e.manual_kcal)
    }))
      .filter((e) => e.exercise_type || e.duration_min > 0 || e.kcal > 0);
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
    await loadDailyLog();
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

function addFood(mealType = "breakfast") {
  currentLog.value.foods.push(newFoodRow(mealType));
}

function addQuickFood(foodPreset, mealType = quickAddMealType.value) {
  currentLog.value.foods.push({
    id: null,
    meal_type: normalizeMealType(mealType),
    food_name: foodPreset.food_name,
    portion: "1份",
    weight_g: 100,
    kcal: Math.round(Number(foodPreset.kcal_per_100g ?? 0))
  });
}

function addExercise() {
  currentLog.value.exercises.push(newExerciseRow());
}

function removeFood(food) {
  const index = currentLog.value.foods.indexOf(food);
  if (index >= 0) {
    currentLog.value.foods.splice(index, 1);
  }
}

function removeExercise(index) {
  currentLog.value.exercises.splice(index, 1);
}

function nextPlanStep() {
  errorText.value = "";
  if (planStep.value === 1 && Number(planForm.value.current_weight) <= Number(planForm.value.target_weight)) {
    errorText.value = "当前体重应大于目标体重，请调整后继续。";
    return;
  }
  if (planStep.value < 3) {
    planStep.value += 1;
  }
}

function prevPlanStep() {
  if (planStep.value > 1) {
    planStep.value -= 1;
  }
}

function toggleExerciseType(typeKey) {
  const selected = planForm.value.exercise_types;
  const index = selected.indexOf(typeKey);
  if (index >= 0) {
    selected.splice(index, 1);
    return;
  }
  selected.push(typeKey);
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
  async (nextDate) => {
    if (String(nextDate ?? "") > todayDate) {
      selectedDate.value = todayDate;
      return;
    }
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
    <section class="dashboard-header">
      <h1 class="title">工作台</h1>
      <div class="header-tools">
        <p class="muted header-account">账号：{{ profile?.account_id }}</p>
        <button class="secondary header-logout-btn" type="button" @click="logout">退出登录</button>
      </div>
    </section>
    <p v-if="errorText" class="error header-feedback">{{ errorText }}</p>
    <p v-if="successText" class="success header-feedback">{{ successText }}</p>

    <section v-if="!plan" class="wizard-card">
      <div class="wizard-header">
        <h2>定制你的减脂蓝图</h2>
        <p>科学计算 BMR 与 TDEE，生成可执行的周期计划。</p>
      </div>

      <div class="wizard-steps">
        <div class="step" :class="{ active: planStep >= 1 }">
          <span>1</span>
          <small>身体基础</small>
        </div>
        <div class="step-line" :class="{ active: planStep >= 2 }"></div>
        <div class="step" :class="{ active: planStep >= 2 }">
          <span>2</span>
          <small>生活方式</small>
        </div>
        <div class="step-line" :class="{ active: planStep >= 3 }"></div>
        <div class="step" :class="{ active: planStep >= 3 }">
          <span>3</span>
          <small>计划确认</small>
        </div>
      </div>

      <div v-if="planStep === 1" class="wizard-body">
        <div class="wizard-grid-two">
          <div>
            <h3 class="block-title">核心生理指标</h3>
            <div class="gender-grid">
              <button
                type="button"
                class="option-card"
                :class="{ active: planForm.sex === 'male' }"
                @click="planForm.sex = 'male'"
              >
                男性
              </button>
              <button
                type="button"
                class="option-card"
                :class="{ active: planForm.sex === 'female' }"
                @click="planForm.sex = 'female'"
              >
                女性
              </button>
            </div>
            <div class="field-stack">
              <label>年龄</label>
              <input v-model.number="planForm.age" type="number" min="12" max="90" />
            </div>
            <div class="field-stack">
              <label>身高 (cm)</label>
              <input v-model.number="planForm.height_cm" type="number" min="120" max="220" />
            </div>
          </div>

          <div class="weight-panel">
            <h3 class="block-title">体重目标</h3>
            <div class="field-stack">
              <label>当前体重 (kg)</label>
              <input v-model.number="planForm.current_weight" type="number" min="20" max="250" step="0.1" />
            </div>
            <div class="field-stack">
              <label>目标体重 (kg)</label>
              <input v-model.number="planForm.target_weight" type="number" min="20" max="250" step="0.1" />
            </div>
            <div class="field-stack">
              <label>计划开始日期</label>
              <input v-model="planForm.start_date" type="date" />
            </div>
          </div>
        </div>
        <div class="wizard-actions end">
          <button type="button" class="primary-btn" @click="nextPlanStep">下一步：生活方式</button>
        </div>
      </div>

      <div v-if="planStep === 2" class="wizard-body">
        <h3 class="block-title">工作与活动模式</h3>
        <div class="activity-grid">
          <button
            v-for="item in workTypeOptions"
            :key="item.key"
            type="button"
            class="option-card left"
            :class="{ active: planForm.work_type === item.key }"
            @click="planForm.work_type = item.key"
          >
            <strong>{{ item.label }}</strong>
            <small>{{ item.desc }}</small>
          </button>
        </div>

        <h3 class="block-title">日常活动强度</h3>
        <div class="activity-grid">
          <button
            v-for="item in activityLevelOptions"
            :key="item.key"
            type="button"
            class="option-card left"
            :class="{ active: planForm.activity_type === item.key }"
            @click="planForm.activity_type = item.key"
          >
            <strong>{{ item.label }}</strong>
            <small>{{ item.desc }}</small>
          </button>
        </div>

        <div class="wizard-grid-three">
          <div class="field-stack">
            <label>平均每日步数</label>
            <select v-model="planForm.steps_tier">
              <option value="lt3000">少于 3000</option>
              <option value="3000_6000">3000 - 6000</option>
              <option value="6000_10000">6000 - 10000</option>
              <option value="gt10000">超过 10000</option>
            </select>
          </div>
          <div class="field-stack">
            <label>通勤方式</label>
            <select v-model="planForm.commute_type">
              <option value="none">无</option>
              <option value="walk">步行</option>
              <option value="bike">骑车</option>
              <option value="bus">公交</option>
              <option value="car">开车</option>
            </select>
          </div>
          <div class="field-stack">
            <label>睡眠情况</label>
            <select v-model="planForm.sleep_tier">
              <option value="poor">不足 6h</option>
              <option value="normal">6-8h</option>
              <option value="good">8h 以上</option>
            </select>
          </div>
        </div>

        <h3 class="block-title">运动习惯</h3>
        <div class="wizard-grid-three">
          <div class="field-stack">
            <label>每周运动次数</label>
            <select v-model.number="planForm.exercise_freq">
              <option :value="0">几乎不</option>
              <option :value="2">1-2 次 / 周</option>
              <option :value="4">3-5 次 / 周</option>
              <option :value="6">6+ 次 / 周</option>
            </select>
          </div>
          <div class="field-stack">
            <label>每次运动时长</label>
            <select v-model.number="planForm.exercise_duration">
              <option :value="20">15-30 分钟</option>
              <option :value="40">30-45 分钟</option>
              <option :value="60">45-60 分钟</option>
              <option :value="75">60+ 分钟</option>
            </select>
          </div>
          <div class="field-stack">
            <label>期望达标周期</label>
            <select v-model.number="planForm.expected_weeks">
              <option :value="8">8 周</option>
              <option :value="12">12 周</option>
              <option :value="16">16 周</option>
              <option :value="20">20 周</option>
              <option :value="24">24 周</option>
            </select>
          </div>
        </div>

        <div class="chips">
          <button
            v-for="type in exerciseTypeOptions"
            :key="type.key"
            type="button"
            class="chip"
            :class="{ active: planForm.exercise_types.includes(type.key) }"
            @click="toggleExerciseType(type.key)"
          >
            {{ type.label }}
          </button>
        </div>

        <div class="wizard-actions between">
          <button type="button" class="ghost-btn" @click="prevPlanStep">返回修改</button>
          <button type="button" class="primary-btn" @click="nextPlanStep">生成预测报告</button>
        </div>
      </div>

      <div v-if="planStep === 3" class="wizard-body">
        <h3 class="report-title">计划评估报告</h3>
        <div class="kpi-grid">
          <div class="kpi-card blue">
            <small>基础代谢 (BMR)</small>
            <strong>{{ calculatedBmr }} kcal</strong>
          </div>
          <div class="kpi-card green">
            <small>每日消耗 (TDEE)</small>
            <strong>{{ calculatedTdee }} kcal</strong>
          </div>
          <div class="kpi-card dark">
            <small>建议日摄入</small>
            <strong>{{ dailyIntakeTarget }} kcal</strong>
          </div>
        </div>

        <div class="predict-box">
          <div>
            <small>预计减重速度</small>
            <p>{{ weeklyLossKg }} kg / 周</p>
          </div>
          <div>
            <small>预计达标日期</small>
            <p>{{ planEndDate }}</p>
          </div>
          <div>
            <small>计划周期</small>
            <p>{{ planDays }} 天</p>
          </div>
        </div>

        <p v-if="dailyIntakeRaw < dailyIntakeFloor" class="warn-line">
          按当前目标推算摄入低于 {{ dailyIntakeFloor }}kcal，已按安全下限修正，建议放缓目标速度。
        </p>
        <p v-if="isTooFast" class="warn-line">
          当前预计每周降重超过 1.0kg，减重速度偏快，建议延长周期。
        </p>
        <div class="wizard-actions between">
          <button type="button" class="ghost-btn" @click="prevPlanStep">重新配置</button>
          <button type="button" class="primary-btn" :disabled="creatingPlan || !canActivatePlan" @click="createPlan">
            {{ creatingPlan ? "激活中..." : "激活减脂计划" }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="plan" class="calendar-top-metrics">
      <article class="metric-card">
        <p class="metric-label">Weight Progress</p>
        <div class="metric-main">
          <span class="metric-value">{{ currentWeightNum.toFixed(1) }}</span>
          <span class="metric-unit">kg</span>
          <span class="metric-target">Target: {{ targetWeightNum.toFixed(1) }}kg</span>
        </div>
        <div class="metric-bar">
          <div class="metric-bar-inner" :style="{ width: `${planProgress}%` }"></div>
        </div>
      </article>
      <article class="metric-card">
        <p class="metric-label">Estimated Goal</p>
        <div class="metric-main">
          <span class="metric-value metric-date">{{ forecastDateLabel }}</span>
        </div>
        <p class="metric-muted">Based on latest execution quality</p>
      </article>
      <article class="metric-card">
        <p class="metric-label">Execution Quality</p>
        <div class="metric-main">
          <span class="metric-value">🔥 {{ streakDays }} Days</span>
        </div>
        <p class="metric-muted">Success Rate: {{ weekSuccessRate }}%</p>
      </article>
    </section>

    <section v-if="plan" class="calendar-layout">
      <div class="calendar-main">
        <div class="calendar-head">
          <h2>{{ monthLabel }}</h2>
          <input v-model="selectedDate" type="date" class="calendar-date-input" :max="todayDate" />
        </div>
        <div class="calendar-legend">
          <span class="legend green">Green: 达标</span>
          <span class="legend yellow">Yellow: 接近(80%+)</span>
          <span class="legend red">Red: 未达标</span>
          <span class="legend gray">Gray: 未记录</span>
        </div>
        <div class="calendar-weekdays">
          <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
        </div>
        <div class="calendar-grid-new">
          <button
            v-for="day in calendarDays"
            :key="day.date"
            type="button"
            class="calendar-cell"
            :class="[statusClass(day.status), { selected: day.date === selectedDate }]"
            @click="selectedDate = day.date"
          >
            <span class="day-number">{{ dayNumberLabel(day.date) }}</span>
            <span v-if="day.status !== 'gray'" class="day-deficit">{{ day.deficit }} kcal</span>
          </button>
        </div>
      </div>

      <aside class="calendar-side">
        <div class="record-card">
          <h3>{{ selectedDate }}</h3>
          <p class="record-hint">目标缺口 {{ plan.daily_deficit_target }} kcal</p>

          <section class="record-section">
            <div class="record-stats">
              <div>
                <small>Intake</small>
                <strong>{{ intakeTotal }} kcal</strong>
              </div>
              <div>
                <small>Exercise</small>
                <strong>-{{ exerciseTotal }} kcal</strong>
              </div>
            </div>
          </section>

          <section class="record-section">
            <div class="section-head">
              <h4>食物记录</h4>
              <small>按餐次记录，可分多次补录</small>
            </div>
            <div class="meal-switch">
              <button
                v-for="meal in mealGroups"
                :key="meal.key"
                type="button"
                class="meal-chip"
                :class="{ active: quickAddMealType === meal.key }"
                @click="quickAddMealType = meal.key"
              >
                {{ meal.label }}
              </button>
            </div>
            <div class="quick-add">
              <label>快速添加到：{{ mealGroups.find((item) => item.key === quickAddMealType)?.label }}</label>
              <div class="quick-btns">
                <button
                  v-for="food in quickFoods"
                  :key="food.food_name"
                  type="button"
                  class="quick-pill"
                  @click="addQuickFood(food, quickAddMealType)"
                >
                  + {{ food.food_name }}
                </button>
              </div>
            </div>

            <div v-for="meal in mealGroups" :key="meal.key" class="meal-block">
              <div class="meal-head">
                <h5>{{ meal.label }}</h5>
                <button type="button" class="sub-btn" @click="addFood(meal.key)">+ 添加</button>
              </div>
              <p v-if="foodsByMeal(meal.key).length === 0" class="meal-empty">暂无记录</p>
              <div
                v-for="(food, mealIndex) in foodsByMeal(meal.key)"
                :key="`food-${meal.key}-${food.id ?? 'new'}-${mealIndex}`"
                class="entry-row"
              >
                <select v-model="food.food_name" @change="syncFoodKcal(food)">
                  <option v-for="item in presets.foods" :key="item.food_name" :value="item.food_name">
                    {{ item.food_name }}
                  </option>
                </select>
                <input v-model.number="food.weight_g" type="number" min="10" max="1000" @input="syncFoodKcal(food)" />
                <span class="entry-kcal">{{ toNonNegativeInt(food.kcal) }} kcal</span>
                <button type="button" class="danger-btn" @click="removeFood(food)">删</button>
              </div>
            </div>
          </section>

          <section class="record-section">
            <div class="section-head">
              <h4>运动记录</h4>
              <small>默认无运动，可选类型或手动填写消耗</small>
            </div>
            <div v-for="(exercise, index) in currentLog.exercises" :key="`exercise-${index}`" class="entry-row">
              <select v-model="exercise.exercise_type" @change="onExerciseTypeChange(exercise)">
                <option value="">无</option>
                <option v-for="item in presets.exercises" :key="item.exercise_type" :value="item.exercise_type">
                  {{ item.exercise_type }}
                </option>
              </select>
              <input
                v-model.number="exercise.duration_min"
                type="number"
                min="0"
                max="240"
                @input="onExerciseDurationInput(exercise)"
              />
              <input
                v-model.number="exercise.kcal"
                type="number"
                min="0"
                max="2000"
                @input="onExerciseKcalInput(exercise)"
              />
              <button type="button" class="danger-btn" @click="removeExercise(index)">删</button>
            </div>
            <button type="button" class="sub-btn" @click="addExercise">+ 添加运动</button>
          </section>

          <section class="record-section">
            <div class="weight-box">
              <label>Update Weight (kg)</label>
              <div class="weight-row">
                <input v-model.number="plan.latest_weight" type="number" min="20" max="250" step="0.1" />
                <button type="button" class="sub-btn" :disabled="saving" @click="saveWeight">保存体重</button>
              </div>
            </div>

            <div class="preview-box">
              当日预估缺口：<strong>{{ previewDeficit }}</strong> kcal
              <span v-if="selectedCalendarDay">；当前状态：{{ selectedCalendarDay.status }}</span>
            </div>
          </section>

          <section class="record-section">
            <label>备注</label>
            <textarea v-model="currentLog.note" rows="2" placeholder="可选备注"></textarea>
          </section>

          <button type="button" class="save-btn" :disabled="saving || loading" @click="saveDailyLog">
            {{ saving ? "保存中..." : "保存当日记录" }}
          </button>
        </div>

        <div class="tip-card">建议早晨空腹称重，以获得更稳定的趋势预测。</div>
        <div v-if="forecastPaused" class="warn-card">最近连续缺失记录，预测已暂停，补录后自动恢复。</div>
        <div v-if="continuousFailDays >= 3" class="warn-card red">
          已连续 {{ continuousFailDays }} 天未达标，建议复盘饮食与运动安排。
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.dashboard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.dashboard-header .title {
  margin: 0;
}

.header-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.header-account {
  margin: 0;
  white-space: nowrap;
}

.header-logout-btn {
  width: auto;
  padding: 7px 12px;
  border-radius: 8px;
}

.header-feedback {
  margin: 0 0 10px;
}

.wizard-card {
  background: #ffffff;
  border-radius: 18px;
  border: 1px solid #e5e7eb;
  padding: 20px;
  margin-bottom: 16px;
}

.wizard-header h2 {
  margin: 0;
  font-size: 28px;
  color: #0f172a;
}

.wizard-header p {
  margin: 8px 0 0;
  color: #64748b;
}

.wizard-steps {
  margin-top: 18px;
  display: flex;
  align-items: center;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 84px;
  color: #94a3b8;
}

.step span {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.step.active {
  color: #2563eb;
}

.step.active span {
  border-color: #2563eb;
  background: #2563eb;
  color: #ffffff;
}

.step small {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 700;
}

.step-line {
  height: 2px;
  flex: 1;
  background: #e2e8f0;
  margin: 0 10px;
}

.step-line.active {
  background: #2563eb;
}

.wizard-body {
  margin-top: 18px;
}

.wizard-grid-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.wizard-grid-three {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.block-title {
  margin: 0 0 10px;
  font-size: 18px;
  color: #0f172a;
}

.field-stack {
  margin-bottom: 10px;
}

.field-stack label {
  display: block;
  margin-bottom: 6px;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.field-stack input,
.field-stack select {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
}

.gender-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.option-card {
  border: 2px solid #f1f5f9;
  border-radius: 12px;
  background: #ffffff;
  color: #334155;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.option-card:hover {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.option-card.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.option-card.left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.option-card strong {
  font-size: 14px;
}

.option-card small {
  margin-top: 4px;
  color: #64748b;
}

.activity-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.weight-panel {
  border-radius: 14px;
  background: #0f172a;
  padding: 14px;
}

.weight-panel .block-title,
.weight-panel label {
  color: #e2e8f0;
}

.weight-panel input {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #ffffff;
}

.chips {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  border: 1px solid #cbd5e1;
  border-radius: 999px;
  padding: 6px 12px;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
}

.chip.active {
  border-color: #2563eb;
  background: #dbeafe;
  color: #1d4ed8;
}

.wizard-actions {
  display: flex;
  margin-top: 12px;
}

.wizard-actions.end {
  justify-content: flex-end;
}

.wizard-actions.between {
  justify-content: space-between;
}

.primary-btn,
.ghost-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
}

.primary-btn {
  background: #2563eb;
  color: #ffffff;
}

.primary-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.ghost-btn {
  background: #f1f5f9;
  color: #475569;
}

.report-title {
  margin: 0 0 12px;
  font-size: 22px;
  color: #0f172a;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi-card {
  border-radius: 12px;
  padding: 12px;
  border: 1px solid #dbeafe;
}

.kpi-card small {
  display: block;
  color: #64748b;
  font-weight: 700;
  margin-bottom: 4px;
}

.kpi-card strong {
  font-size: 24px;
}

.kpi-card.blue {
  background: #eff6ff;
}

.kpi-card.green {
  background: #ecfdf5;
}

.kpi-card.dark {
  background: #0f172a;
  border-color: #0f172a;
}

.kpi-card.dark small,
.kpi-card.dark strong {
  color: #e2e8f0;
}

.predict-box {
  margin-top: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.predict-box small {
  color: #64748b;
}

.predict-box p {
  margin: 6px 0 0;
  font-weight: 700;
  color: #0f172a;
}

.warn-line {
  margin-top: 10px;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 13px;
}

.muted-line {
  margin-top: 8px;
  color: #64748b;
  font-size: 13px;
}

.calendar-top-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.metric-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 14px;
}

.metric-label {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
}

.metric-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
}

.metric-value {
  font-size: 26px;
  font-weight: 800;
  color: #0f172a;
}

.metric-date {
  font-size: 20px;
}

.metric-unit {
  color: #94a3b8;
}

.metric-target {
  margin-left: auto;
  color: #2563eb;
  font-weight: 700;
  font-size: 12px;
}

.metric-muted {
  margin: 8px 0 0;
  font-size: 12px;
  color: #64748b;
}

.metric-bar {
  margin-top: 10px;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
}

.metric-bar-inner {
  height: 100%;
  border-radius: 999px;
  background: #2563eb;
}

.calendar-layout {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 12px;
}

.calendar-main {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  padding: 14px;
}

.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.calendar-head h2 {
  margin: 0;
  font-size: 24px;
  color: #0f172a;
}

.calendar-date-input {
  width: auto;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 8px 10px;
}

.calendar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.legend {
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 999px;
}

.legend.green {
  color: #059669;
  background: #ecfdf5;
}

.legend.yellow {
  color: #b45309;
  background: #fefce8;
}

.legend.red {
  color: #dc2626;
  background: #fef2f2;
}

.legend.gray {
  color: #64748b;
  background: #f8fafc;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 6px;
}

.calendar-weekdays span {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-align: center;
}

.calendar-grid-new {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.calendar-cell {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  min-height: 76px;
  background: #ffffff;
  text-align: left;
  padding: 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
}

.calendar-cell.selected {
  outline: 2px solid #3b82f6;
}

.status-green {
  background: #ecfdf5;
  border-top: 4px solid #10b981;
}

.status-yellow {
  background: #fffbeb;
  border-top: 4px solid #f59e0b;
}

.status-red {
  background: #fef2f2;
  border-top: 4px solid #ef4444;
}

.status-gray {
  background: #f8fafc;
  border-top: 4px solid #e2e8f0;
}

.day-number {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.day-deficit {
  font-size: 10px;
  font-weight: 700;
  color: #334155;
}

.calendar-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-card {
  border-radius: 14px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 14px;
}

.record-section {
  margin-top: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.45);
  border-radius: 12px;
  padding: 10px;
}

.record-card h3 {
  margin: 0;
  font-size: 20px;
}

.record-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.record-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.record-stats > div {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px;
}

.record-stats small {
  display: block;
  color: #94a3b8;
  font-size: 10px;
}

.record-stats strong {
  font-size: 15px;
}

.quick-add {
  margin-top: 8px;
}

.quick-add label {
  font-size: 11px;
  color: #94a3b8;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-head h4 {
  margin: 0;
  font-size: 13px;
  color: #e2e8f0;
}

.section-head small {
  color: #94a3b8;
  font-size: 11px;
}

.meal-switch {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}

.meal-chip {
  width: auto;
  border: 1px solid rgba(148, 163, 184, 0.32);
  background: transparent;
  color: #cbd5e1;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
}

.meal-chip.active {
  border-color: #38bdf8;
  background: rgba(14, 165, 233, 0.18);
  color: #e0f2fe;
}

.quick-btns {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.quick-pill {
  width: auto;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: #e2e8f0;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
}

.meal-block {
  margin-top: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  padding: 8px;
}

.meal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.meal-head h5 {
  margin: 0;
  font-size: 12px;
  color: #e2e8f0;
}

.meal-head .sub-btn {
  margin: 0;
}

.meal-empty {
  margin: 0;
  color: #94a3b8;
  font-size: 11px;
}

.entry-list {
  margin-top: 10px;
}

.entry-list h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #cbd5e1;
}

.entry-row {
  display: grid;
  grid-template-columns: 1fr 88px 88px 40px;
  gap: 6px;
  margin-bottom: 6px;
}

.entry-row select,
.entry-row input,
.weight-row input,
.record-card textarea {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  border-radius: 8px;
  padding: 7px 8px;
}

.entry-row select {
  min-width: 0;
  color-scheme: dark;
}

.record-card select option {
  background: #0f172a;
  color: #e2e8f0;
}

.entry-kcal {
  align-self: center;
  text-align: right;
  color: #cbd5e1;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.danger-btn {
  border: none;
  border-radius: 8px;
  background: #dc2626;
  color: #ffffff;
  font-size: 12px;
}

.sub-btn {
  margin-top: 4px;
  width: auto;
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  background: #334155;
  color: #ffffff;
}

.weight-box {
  margin-top: 0;
}

.weight-box label {
  font-size: 12px;
  color: #94a3b8;
}

.weight-row {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.weight-row .sub-btn {
  margin: 0;
}

.preview-box {
  margin-top: 10px;
  font-size: 12px;
  color: #cbd5e1;
}

.record-card textarea {
  margin-top: 6px;
  width: 100%;
}

.save-btn {
  margin-top: 8px;
  border: none;
  width: 100%;
  border-radius: 10px;
  padding: 10px;
  background: #2563eb;
  color: #ffffff;
  font-weight: 700;
}

.save-btn:disabled {
  background: #64748b;
}

.tip-card,
.warn-card {
  border-radius: 12px;
  padding: 10px;
  font-size: 12px;
}

.tip-card {
  background: #eff6ff;
  color: #1d4ed8;
}

.warn-card {
  background: #fefce8;
  color: #a16207;
}

.warn-card.red {
  background: #fef2f2;
  color: #dc2626;
}

@media (max-width: 900px) {
  .dashboard-header {
    flex-direction: column;
    gap: 6px;
  }

  .header-tools {
    width: 100%;
  }

  .wizard-grid-two,
  .wizard-grid-three,
  .activity-grid,
  .kpi-grid,
  .predict-box,
  .calendar-top-metrics,
  .calendar-layout,
  .calendar-grid-new,
  .calendar-weekdays,
  .record-stats {
    grid-template-columns: 1fr;
  }

  .wizard-actions.between {
    gap: 10px;
    flex-direction: column;
  }
}
</style>
