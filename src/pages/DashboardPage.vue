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
  start_date: new Date().toISOString().slice(0, 10)
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
const calculatedBmr = computed(() => {
  const base =
    10 * Number(planForm.value.current_weight) +
    6.25 * Number(planForm.value.height_cm) -
    5 * Number(planForm.value.age);
  return Math.round(planForm.value.sex === "male" ? base + 5 : base - 161);
});
const calculatedTdee = computed(() => Math.round(calculatedBmr.value * selectedActivityFactor.value));
const recommendedDeficit = computed(() => {
  const dynamic = 350 + Math.round((Number(planForm.value.exercise_freq) * Number(planForm.value.exercise_duration)) / 12);
  return Math.min(Math.max(dynamic, 350), 800);
});
const dailyIntakeTarget = computed(() => Math.max(calculatedTdee.value - recommendedDeficit.value, 1000));
const weeklyLossKg = computed(() => (recommendedDeficit.value * 7 / 7700).toFixed(2));
const planDays = computed(() => {
  const lossNeeded = Math.max(Number(planForm.value.current_weight) - Number(planForm.value.target_weight), 0);
  const weekly = Math.max(Number(weeklyLossKg.value), 0.1);
  return Math.max(Math.ceil((lossNeeded / weekly) * 7), 7);
});
const isTooFast = computed(() => Number(weeklyLossKg.value) > 1.0);
const isBeyondExpectedWeeks = computed(
  () => Math.ceil(planDays.value / 7) > Number(planForm.value.expected_weeks)
);
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
  if (!canActivatePlan.value) {
    errorText.value = "请检查输入：当前体重需大于目标体重，且年龄/身高需要在合理范围。";
    return;
  }
  creatingPlan.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    const avgExerciseKcal = Math.round(
      (Number(planForm.value.exercise_freq) *
        Number(planForm.value.exercise_duration) *
        8) /
        7
    );
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
        average_exercise_kcal: avgExerciseKcal,
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

        <p v-if="dailyIntakeTarget < 1200" class="warn-line">
          建议摄入低于 1200kcal，可能存在代谢风险，建议放缓目标速度。
        </p>
        <p v-if="isTooFast" class="warn-line">
          当前预计每周降重超过 1.0kg，减重速度偏快，建议延长周期。
        </p>
        <p v-if="isBeyondExpectedWeeks" class="muted-line">
          预计 {{ Math.ceil(planDays / 7) }} 周达标，超过你设置的 {{ planForm.expected_weeks }} 周。
        </p>

        <div class="wizard-actions between">
          <button type="button" class="ghost-btn" @click="prevPlanStep">重新配置</button>
          <button type="button" class="primary-btn" :disabled="creatingPlan || !canActivatePlan" @click="createPlan">
            {{ creatingPlan ? "激活中..." : "激活减脂计划" }}
          </button>
        </div>
      </div>
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

<style scoped>
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

@media (max-width: 900px) {
  .wizard-grid-two,
  .wizard-grid-three,
  .activity-grid,
  .kpi-grid,
  .predict-box {
    grid-template-columns: 1fr;
  }

  .wizard-actions.between {
    gap: 10px;
    flex-direction: column;
  }
}
</style>
