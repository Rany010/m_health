<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiRequest, clearToken } from "../services/api";
import { markFirstInteractive, markPerf, printPerfSummary } from "../services/perf";

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clampWeeks(value) {
  return Math.min(104, Math.max(4, Math.round(Number(value) || 0)));
}

const router = useRouter();
const profile = ref(null);
const loading = ref(false);
const initializing = ref(true);
const errorText = ref("");
const successText = ref("");
const saving = ref(false);
const presetsLoading = ref(false);
const calendarLoading = ref(false);
const forecastLoading = ref(false);
const dailyLogLoading = ref(false);
const trendLoading = ref(false);
const plan = ref(null);
const forecast = ref(null);
const presets = ref({ foods: [], exercises: [] });
const todayDate = localDateString();
const selectedDate = ref(todayDate);
const calendarDays = ref([]);
const trendDays = ref([]);
const streakDays = ref(0);
const weekSuccessRate = ref(0);
const selectedDateWeight = ref(null);
const currentLog = ref({ foods: [], exercises: [], note: "" });
const trendTab = ref("weight");
const creatingPlan = ref(false);
const planStep = ref(1);
const planForm = ref({
  sex: "male",
  age: 28,
  height_cm: 175,
  current_weight: 85,
  target_weight: 68,
  activity_type: "sedentary",
  exercise_freq: 2,
  exercise_duration: 40,
  expected_weeks: 12,
  start_date: todayDate
});
const activityLevelOptions = [
  { key: "sedentary", label: "久坐", factor: 1.2, desc: "办公族，极少运动" },
  { key: "light", label: "轻度", factor: 1.3, desc: "偶尔步行，家务劳动" },
  { key: "moderate", label: "中度", factor: 1.45, desc: "每周运动3-5次" },
  { key: "high", label: "高强度", factor: 1.6, desc: "高体力或每日训练" }
];
const mealGroups = [
  { key: "breakfast", label: "早餐" },
  { key: "lunch", label: "午餐" },
  { key: "dinner", label: "晚餐" }
];
const mealRatioMap = {
  breakfast: 0.2,
  lunch: 0.5,
  dinner: 0.3
};
const trendTabs = [
  { key: "weight", label: "体重变化趋势", unit: "kg" },
  { key: "deficit", label: "缺口趋势", unit: "kcal" },
  { key: "intake", label: "摄入趋势", unit: "kcal" },
  { key: "exercise", label: "运动消耗趋势", unit: "kcal" }
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
const weightDiffKg = computed(() =>
  Math.max(0, Number(planForm.value.current_weight) - Number(planForm.value.target_weight))
);
const recommendedWeeklyLoss = computed(() => {
  const currentWeight = Number(planForm.value.current_weight);
  const age = Number(planForm.value.age);
  if (!Number.isFinite(currentWeight) || currentWeight <= 0) {
    return { min: 0.25, max: 0.7, suggested: 0.5 };
  }
  let maxRatio = planForm.value.sex === "male" ? 0.01 : 0.009;
  if (age >= 40) maxRatio *= 0.9;
  if (age >= 55) maxRatio *= 0.8;
  if (age < 18) maxRatio *= 0.75;
  const max = Math.min(1.0, Math.max(0.25, currentWeight * maxRatio));
  const min = Math.max(0.2, Math.min(0.6, max * 0.7));
  const suggested = Math.max(min, Math.min(max, (min + max) / 2));
  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    suggested: Number(suggested.toFixed(2))
  };
});
const recommendedWeekRange = computed(() => {
  const diff = weightDiffKg.value;
  if (diff <= 0) {
    return { min: 8, max: 12, recommended: 10 };
  }
  const minWeeks = clampWeeks(Math.ceil(diff / Math.max(recommendedWeeklyLoss.value.max, 0.2)));
  const maxWeeks = clampWeeks(Math.ceil(diff / Math.max(recommendedWeeklyLoss.value.min, 0.1)));
  const recommended = clampWeeks(Math.ceil(diff / Math.max(recommendedWeeklyLoss.value.suggested, 0.1)));
  return {
    min: Math.min(minWeeks, maxWeeks),
    max: Math.max(minWeeks, maxWeeks),
    recommended: Math.min(Math.max(recommended, minWeeks), maxWeeks)
  };
});
const recommendedWeeks = computed(() => recommendedWeekRange.value.recommended);
const recommendedPlanDays = computed(() => recommendedWeeks.value * 7);
const expectedWeeklyLossKg = computed(() => {
  const weeks = Number(planForm.value.expected_weeks);
  if (!Number.isFinite(weeks) || weeks <= 0) return 0;
  return weightDiffKg.value / weeks;
});
const periodRiskLevel = computed(() => {
  if (weightDiffKg.value <= 0) return "normal";
  if (Number(planForm.value.expected_weeks) < recommendedWeekRange.value.min) return "fast";
  if (Number(planForm.value.expected_weeks) > recommendedWeekRange.value.max) return "slow";
  return "normal";
});
const periodRiskText = computed(() => {
  if (periodRiskLevel.value === "fast") {
    return `当前周期偏激进，建议至少 ${recommendedWeekRange.value.min} 周。`;
  }
  if (periodRiskLevel.value === "slow") {
    return `当前周期偏保守，建议控制在 ${recommendedWeekRange.value.max} 周以内。`;
  }
  return "当前周期处于建议范围内。";
});
const periodWeekOptions = computed(() => {
  const values = new Set([8, 10, 12, 16, 20, 24, 28, 32, Number(planForm.value.expected_weeks), recommendedWeekRange.value.min, recommendedWeekRange.value.max, recommendedWeeks.value]);
  return Array.from(values)
    .map((item) => Math.round(Number(item)))
    .filter((item) => Number.isInteger(item) && item >= 4 && item <= 104)
    .sort((a, b) => a - b);
});
const planDays = computed(() => Math.max(Number(planForm.value.expected_weeks) * 7, 7));
const recommendedDeficit = computed(() => {
  const weightDiff = weightDiffKg.value;
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
const recommendedEndDate = computed(() => {
  const end = new Date(planForm.value.start_date);
  end.setDate(end.getDate() + recommendedPlanDays.value);
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
const planStartDate = computed(() => {
  if (!plan.value?.start_date) return "";
  return String(plan.value.start_date).slice(0, 10);
});
const modelForecastPaused = computed(() => Boolean(forecast.value?.paused));
const forecastDateLabel = computed(() =>
  modelForecastPaused.value ? "预测暂停" : forecast.value?.estimated_finish_date || "待计算"
);
const forecastHintText = computed(() => {
  if (forecastLoading.value) {
    return "预测加载中...";
  }
  if (modelForecastPaused.value) {
    return forecast.value?.reason || "当前策略下无法预测";
  }
  return "基于最新执行质量预测";
});
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
const previewWeightChangeLabel = computed(() => deficitChangeLabel(previewDeficit.value));
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
const missingLogsForecastPaused = computed(() => {
  const recent = calendarDays.value.slice(-3);
  return recent.length === 3 && recent.every((day) => day.status === "gray");
});
const mealTargetKcalMap = computed(() => {
  const target = Math.max(0, Math.round(Number(plan.value?.daily_kcal_target ?? 0)));
  const breakfast = Math.round(target * mealRatioMap.breakfast);
  const lunch = Math.round(target * mealRatioMap.lunch);
  const dinner = Math.max(0, target - breakfast - lunch);
  return {
    breakfast,
    lunch,
    dinner
  };
});
const mealActualKcalMap = computed(() =>
  currentLog.value.foods.reduce(
    (totals, item) => {
      const key = normalizeMealType(item.meal_type);
      totals[key] += toNonNegativeInt(item.kcal);
      return totals;
    },
    {
      breakfast: 0,
      lunch: 0,
      dinner: 0
    }
  )
);
const activeTrendTab = computed(() => trendTabs.find((item) => item.key === trendTab.value) ?? trendTabs[0]);
const trendDayCount = computed(() => trendDays.value.length);
const trendChart = computed(() => {
  const width = 760;
  const height = 260;
  const plotLeft = 52;
  const plotRight = 12;
  const plotTop = 14;
  const plotBottom = 34;
  const plotWidth = width - plotLeft - plotRight;
  const plotHeight = height - plotTop - plotBottom;
  const rows = trendDays.value;
  const tabKey = activeTrendTab.value.key;

  const base = {
    width,
    height,
    plotLeft,
    plotTop,
    plotBottom,
    points: [],
    segments: [],
    yTicks: [],
    xTicks: []
  };
  if (!plan.value || rows.length === 0) {
    return base;
  }

  const points = [];
  const values = [];
  let lastWeight = Number(plan.value.start_weight ?? 0);
  if (!Number.isFinite(lastWeight)) lastWeight = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    let value = 0;
    let imputed = false;
    if (tabKey === "weight") {
      const measuredWeight = Number(row.weight);
      if (Number.isFinite(measuredWeight)) {
        lastWeight = measuredWeight;
      } else {
        imputed = true;
      }
      value = lastWeight;
    } else if (tabKey === "deficit") {
      value = Number(row.deficit ?? 0);
      if (!Number.isFinite(value)) value = 0;
    } else if (tabKey === "intake") {
      value = Number(row.intake_kcal ?? 0);
      if (!Number.isFinite(value)) value = 0;
    } else {
      value = Number(row.exercise_kcal ?? 0);
      if (!Number.isFinite(value)) value = 0;
    }
    values.push(value);
    points.push({
      index: i,
      date: row.date,
      value,
      imputed
    });
  }

  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  const range = maxValue - minValue;
  const pad = tabKey === "weight" ? 0.4 : Math.max(40, Math.round(range * 0.12));
  if (range < 0.001) {
    minValue -= pad;
    maxValue += pad;
  } else {
    minValue -= pad;
    maxValue += pad;
  }

  const toX = (index) => {
    if (points.length <= 1) return plotLeft;
    return plotLeft + (index / (points.length - 1)) * plotWidth;
  };
  const toY = (value) => {
    const ratio = (value - minValue) / (maxValue - minValue);
    return plotTop + (1 - ratio) * plotHeight;
  };

  const chartPoints = points.map((item) => ({
    ...item,
    x: toX(item.index),
    y: toY(item.value)
  }));
  const segments = [];
  for (let i = 1; i < chartPoints.length; i += 1) {
    segments.push({
      x1: chartPoints[i - 1].x,
      y1: chartPoints[i - 1].y,
      x2: chartPoints[i].x,
      y2: chartPoints[i].y,
      dashed: tabKey === "weight" && chartPoints[i].imputed
    });
  }

  const yTicks = [maxValue, (maxValue + minValue) / 2, minValue].map((value) => ({
    value,
    y: toY(value)
  }));
  const tickIndexes = points.length === 1 ? [0] : Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const xTicks = tickIndexes.map((index) => {
    const tickDate = String(points[index]?.date ?? "");
    const label = /^\d{4}-\d{2}-\d{2}$/.test(tickDate) ? tickDate.slice(5) : `第${index + 1}天`;
    return {
      index,
      x: toX(index),
      label,
      anchor: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
    };
  });

  return {
    ...base,
    points: chartPoints,
    segments,
    yTicks,
    xTicks
  };
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

function deficitChangeLabel(deficitValue) {
  const deficit = Number(deficitValue);
  if (!Number.isFinite(deficit) || deficit === 0) {
    return "持平0g";
  }
  const grams = Math.round(Math.abs(deficit) / 7.7);
  if (grams <= 0) {
    return "持平0g";
  }
  return deficit > 0 ? `减重${grams}g` : `增重${grams}g`;
}

function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function formatTrendAxisValue(value) {
  if (activeTrendTab.value.key === "weight") {
    return `${Number(value).toFixed(1)} kg`;
  }
  return `${Math.round(Number(value))} kcal`;
}

function findFoodPreset(foodName) {
  return presets.value.foods.find((f) => f.food_name === foodName) ?? null;
}

function isUnitBasedFoodPreset(preset) {
  return Number.isFinite(Number(preset?.kcal_per_unit));
}

function defaultFoodAmount(preset) {
  return isUnitBasedFoodPreset(preset) ? 1 : 100;
}

function computeFoodKcal(item) {
  const preset = findFoodPreset(item.food_name);
  if (!preset) return 0;
  const amount = toNonNegativeInt(item.weight_g ?? defaultFoodAmount(preset));
  if (isUnitBasedFoodPreset(preset)) {
    return Math.round(Number(preset.kcal_per_unit) * amount);
  }
  return Math.round((Number(preset.kcal_per_100g) * amount) / 100);
}

function syncFoodKcal(item, resetAmount = false) {
  const preset = findFoodPreset(item.food_name);
  if (!preset) {
    item.kcal = 0;
    return;
  }
  if (preset?.unit) {
    item.portion = String(preset.unit);
  }
  if (resetAmount) {
    item.weight_g = defaultFoodAmount(preset);
  } else {
    item.weight_g = toNonNegativeInt(item.weight_g ?? defaultFoodAmount(preset));
  }
  item.kcal = computeFoodKcal(item);
}

function foodInputUnit(item) {
  const preset = findFoodPreset(item.food_name);
  return String(preset?.unit ?? "g");
}

function foodInputMin(item) {
  const preset = findFoodPreset(item.food_name);
  return isUnitBasedFoodPreset(preset) ? 1 : 10;
}

function foodInputMax(item) {
  const preset = findFoodPreset(item.food_name);
  return isUnitBasedFoodPreset(preset) ? 200 : 1000;
}

function foodsByMeal(mealType) {
  return currentLog.value.foods.filter((item) => normalizeMealType(item.meal_type) === mealType);
}

function mealSuggestedKcal(mealType) {
  const key = normalizeMealType(mealType);
  return mealTargetKcalMap.value[key] ?? 0;
}

function mealActualKcal(mealType) {
  const key = normalizeMealType(mealType);
  return mealActualKcalMap.value[key] ?? 0;
}

function onExerciseTypeChange(item) {
  item.manual_kcal = true;
  item.duration_min = 0;
  if (!item.exercise_type) {
    item.kcal = 0;
  }
}

function onExerciseKcalInput(item) {
  item.manual_kcal = true;
  item.kcal = toNonNegativeInt(item.kcal ?? 0);
}

function newFoodRow(mealType = "breakfast") {
  const first = presets.value.foods[0];
  const amount = defaultFoodAmount(first);
  return {
    id: null,
    meal_type: normalizeMealType(mealType),
    food_name: first?.food_name ?? "",
    portion: first?.unit ?? "1份",
    weight_g: amount,
    kcal: first
      ? isUnitBasedFoodPreset(first)
        ? Math.round(Number(first.kcal_per_unit) * amount)
        : Math.round((Number(first.kcal_per_100g) * amount) / 100)
      : 0
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

function applyDailyLogPayload(payload) {
  selectedDateWeight.value =
    payload?.weight === null || payload?.weight === undefined ? null : Number(payload.weight);
  if (!payload?.daily_log) {
    currentLog.value = { foods: [newFoodRow()], exercises: [newExerciseRow()], note: "" };
    return;
  }
  const foods = payload.foods.map((f) => ({
    id: f.id,
    meal_type: normalizeMealType(f.meal_type),
    food_name: f.food_name,
    portion: f.portion,
    weight_g: toNonNegativeInt(f.weight_g ?? defaultFoodAmount(findFoodPreset(f.food_name))),
    kcal: toNonNegativeInt(f.kcal)
  }));
  const exercises = payload.exercises.map((e) => ({
    id: e.id,
    exercise_type: String(e.exercise_type ?? ""),
    duration_min: 0,
    kcal: toNonNegativeInt(e.kcal),
    manual_kcal: true
  }));
  currentLog.value = {
    foods: foods.length > 0 ? foods : [newFoodRow()],
    exercises: exercises.length > 0 ? exercises : [newExerciseRow()],
    note: payload.daily_log.note ?? ""
  };
}

function resetPlanPanels() {
  calendarDays.value = [];
  streakDays.value = 0;
  weekSuccessRate.value = 0;
  forecast.value = null;
  trendDays.value = [];
  applyDailyLogPayload(null);
}

async function loadDashboardBootstrap({ includePresets = false } = {}) {
  calendarLoading.value = true;
  forecastLoading.value = true;
  dailyLogLoading.value = true;
  trendLoading.value = true;
  if (includePresets) {
    presetsLoading.value = true;
  }
  try {
    const params = new URLSearchParams({
      selected_date: selectedDate.value,
      end_date: todayDate,
      include_presets: includePresets ? "1" : "0"
    });
    const payload = await apiRequest(`/dashboard-bootstrap?${params.toString()}`, { method: "GET" });

    profile.value = payload.profile ?? profile.value;
    if (includePresets && payload.presets) {
      presets.value = payload.presets;
    }

    plan.value = payload.plan;
    if (planStartDate.value && selectedDate.value < planStartDate.value) {
      selectedDate.value = planStartDate.value;
    }

    if (!plan.value) {
      resetPlanPanels();
      return;
    }

    calendarDays.value = Array.isArray(payload.calendar?.days) ? payload.calendar.days : [];
    streakDays.value = Number(payload.calendar?.current_streak ?? 0);
    weekSuccessRate.value = Number(payload.calendar?.week_success_rate ?? 0);
    forecast.value = payload.forecast ?? null;
    trendDays.value = Array.isArray(payload.trend?.days) ? payload.trend.days : [];
    applyDailyLogPayload(payload.dailyLog ?? null);
  } finally {
    calendarLoading.value = false;
    forecastLoading.value = false;
    dailyLogLoading.value = false;
    trendLoading.value = false;
    if (includePresets) {
      presetsLoading.value = false;
    }
  }
}

async function loadCalendar() {
  if (!plan.value) {
    calendarDays.value = [];
    streakDays.value = 0;
    weekSuccessRate.value = 0;
    return;
  }
  calendarLoading.value = true;
  try {
    const params = todayMonthParams();
    const payload = await apiRequest(
      `/calendar-month?plan_id=${plan.value.id}&year=${params.year}&month=${params.month}`,
      { method: "GET" }
    );
    calendarDays.value = payload.days;
    streakDays.value = payload.current_streak;
    weekSuccessRate.value = payload.week_success_rate;
  } finally {
    calendarLoading.value = false;
  }
}

async function loadDailyLog() {
  if (!plan.value) {
    applyDailyLogPayload(null);
    return;
  }
  dailyLogLoading.value = true;
  try {
    const payload = await apiRequest(
      `/daily-log-get?plan_id=${plan.value.id}&date=${selectedDate.value}`,
      { method: "GET" }
    );
    applyDailyLogPayload(payload);
  } finally {
    dailyLogLoading.value = false;
  }
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
    await loadDashboardBootstrap({ includePresets: false });
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
      portion: String(f.portion || findFoodPreset(f.food_name)?.unit || "1份"),
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
        note: ""
      })
    });
    successText.value = "当日记录已保存";
    await loadDashboardBootstrap({ includePresets: false });
  } catch (error) {
    errorText.value = error.message;
  } finally {
    saving.value = false;
  }
}

async function saveWeight() {
  if (!plan.value) return;
  const weight = Number(selectedDateWeight.value);
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
    errorText.value = "请输入20-300kg范围内的体重";
    return;
  }
  saving.value = true;
  errorText.value = "";
  successText.value = "";
  try {
    await apiRequest("/weight-log-upsert", {
      method: "POST",
      body: JSON.stringify({
        plan_id: plan.value.id,
        date: selectedDate.value,
        weight
      })
    });
    successText.value = "体重已更新并参与预测";
    await loadDashboardBootstrap({ includePresets: false });
  } catch (error) {
    errorText.value = error.message;
  } finally {
    saving.value = false;
  }
}

function addFood(mealType = "breakfast") {
  currentLog.value.foods.push(newFoodRow(mealType));
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

function applyRecommendedWeeks() {
  planForm.value.expected_weeks = recommendedWeeks.value;
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
    if (planStartDate.value && String(nextDate ?? "") < planStartDate.value) {
      selectedDate.value = planStartDate.value;
      return;
    }
    if (String(nextDate ?? "") > todayDate) {
      selectedDate.value = todayDate;
      return;
    }
    if (!plan.value) return;
    await Promise.all([loadCalendar(), loadDailyLog()]);
  },
  { immediate: false }
);

onMounted(async () => {
  markPerf("dashboard_init_start");
  initializing.value = true;
  try {
    await loadDashboardBootstrap({ includePresets: true });
    markPerf("dashboard_data_loaded");
    initializing.value = false;
    await nextTick();
    markFirstInteractive("dashboard_first_interactive");
    printPerfSummary("dashboard_init");
  } catch (error) {
    const message = String(error?.message ?? "");
    if (message.includes("登录状态失效")) {
      clearToken();
      errorText.value = "登录状态失效，请重新登录";
      await router.push("/");
    } else {
      errorText.value = error?.message || "初始化失败，请稍后重试";
    }
    printPerfSummary("dashboard_init_failed");
    initializing.value = false;
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

    <section v-if="initializing" class="loading-card">
      <p class="muted">正在加载数据...</p>
    </section>

    <section v-else-if="!plan" class="wizard-card">
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
              <input v-model="planForm.start_date" type="date" :max="todayDate" />
            </div>
            <div class="period-recommend-box">
              <p>
                推荐达标周期：<strong>{{ recommendedWeeks }} 周</strong>
                <span>（约 {{ recommendedPlanDays }} 天）</span>
              </p>
              <p>建议范围：{{ recommendedWeekRange.min }} - {{ recommendedWeekRange.max }} 周</p>
              <p>预计达标日期：{{ recommendedEndDate }}</p>
            </div>
          </div>
        </div>
        <div class="wizard-actions end">
          <button type="button" class="primary-btn" @click="nextPlanStep">下一步：生活方式</button>
        </div>
      </div>

      <div v-if="planStep === 2" class="wizard-body">
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
              <option v-for="weeks in periodWeekOptions" :key="weeks" :value="weeks">
                {{ weeks }} 周{{ weeks === recommendedWeeks ? "（推荐）" : "" }}
              </option>
            </select>
            <p class="period-suggest-line">
              推荐：{{ recommendedWeeks }} 周（{{ recommendedWeekRange.min }}-{{ recommendedWeekRange.max }} 周）
            </p>
            <p class="period-suggest-line">当前速度：约 {{ expectedWeeklyLossKg.toFixed(2) }} kg / 周</p>
            <p class="period-suggest-line" :class="periodRiskLevel === 'fast' ? 'risk-fast' : periodRiskLevel === 'slow' ? 'risk-slow' : 'risk-ok'">
              {{ periodRiskText }}
            </p>
            <button type="button" class="mini-btn" @click="applyRecommendedWeeks">采用推荐周期</button>
          </div>
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

    <p v-if="!initializing && plan && (calendarLoading || forecastLoading)" class="section-loading-text">
      核心指标加载中...
    </p>
    <section v-if="!initializing && plan" class="calendar-top-metrics">
      <article class="metric-card">
        <p class="metric-label">体重进度</p>
        <div class="metric-main">
          <span class="metric-value">{{ currentWeightNum.toFixed(1) }}</span>
          <span class="metric-unit">kg</span>
          <span class="metric-target">目标：{{ targetWeightNum.toFixed(1) }}kg</span>
        </div>
        <div class="metric-bar">
          <div class="metric-bar-inner" :style="{ width: `${planProgress}%` }"></div>
        </div>
      </article>
      <article class="metric-card">
        <p class="metric-label">预计达标</p>
        <div class="metric-main">
          <span class="metric-value metric-date">{{ forecastDateLabel }}</span>
        </div>
        <p class="metric-muted">{{ forecastHintText }}</p>
      </article>
      <article class="metric-card">
        <p class="metric-label">执行质量</p>
        <div class="metric-main">
          <span class="metric-value">🔥 {{ streakDays }} 天</span>
        </div>
        <p class="metric-muted">成功率：{{ weekSuccessRate }}%</p>
      </article>
    </section>

    <section v-if="!initializing && plan" class="calendar-layout">
      <div class="calendar-main">
        <div class="calendar-head">
          <h2>{{ monthLabel }}</h2>
          <input
            v-model="selectedDate"
            type="date"
            class="calendar-date-input"
            :min="planStartDate || undefined"
            :max="todayDate"
          />
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
        <p v-if="calendarLoading && calendarDays.length === 0" class="section-loading-text">日历数据加载中...</p>
        <div v-else class="calendar-grid-new">
          <button
            v-for="day in calendarDays"
            :key="day.date"
            type="button"
            class="calendar-cell"
            :class="[statusClass(day.status), { selected: day.date === selectedDate }]"
            @click="selectedDate = day.date"
          >
            <span class="day-number">{{ dayNumberLabel(day.date) }}</span>
            <span v-if="day.status !== 'gray'" class="day-deficit">{{ deficitChangeLabel(day.deficit) }}</span>
          </button>
        </div>
      </div>

      <aside class="calendar-side">
        <div class="record-card">
          <h3>{{ selectedDate }}</h3>
          <p class="record-hint">目标缺口 {{ plan.daily_deficit_target }} kcal</p>
          <p v-if="presetsLoading || dailyLogLoading" class="section-loading-text">当日记录加载中...</p>

          <section class="record-section">
            <div class="record-stats">
              <div>
                <small>摄入</small>
                <strong>{{ intakeTotal }} kcal</strong>
              </div>
              <div>
                <small>运动消耗</small>
                <strong>-{{ exerciseTotal }} kcal</strong>
              </div>
            </div>
          </section>

          <section class="record-section">
            <div class="section-head">
              <h4>食物记录</h4>
              <small>按餐次记录，可分多次补录</small>
            </div>

            <div v-for="meal in mealGroups" :key="meal.key" class="meal-block">
              <div class="meal-head">
                <h5>{{ meal.label }}</h5>
                <small class="meal-target">
                  建议 {{ mealSuggestedKcal(meal.key) }} kcal，已摄入 {{ mealActualKcal(meal.key) }}kcal
                </small>
                <button type="button" class="sub-btn" @click="addFood(meal.key)">+ 添加</button>
              </div>
              <p v-if="foodsByMeal(meal.key).length === 0" class="meal-empty">暂无记录</p>
              <div
                v-for="(food, mealIndex) in foodsByMeal(meal.key)"
                :key="`food-${meal.key}-${food.id ?? 'new'}-${mealIndex}`"
                class="entry-row"
              >
                <select v-model="food.food_name" @change="syncFoodKcal(food, true)">
                  <option v-for="item in presets.foods" :key="item.food_name" :value="item.food_name">
                    {{ item.food_name }}
                  </option>
                </select>
                <input
                  v-model.number="food.weight_g"
                  type="number"
                  :min="foodInputMin(food)"
                  :max="foodInputMax(food)"
                  @input="syncFoodKcal(food)"
                />
                <span class="entry-unit">{{ foodInputUnit(food) }}</span>
                <span class="entry-kcal">{{ toNonNegativeInt(food.kcal) }} kcal</span>
                <button type="button" class="danger-btn" @click="removeFood(food)">删</button>
              </div>
            </div>
          </section>

          <section class="record-section">
            <div class="section-head">
              <h4>运动记录</h4>
              <small>默认无运动，可选类型并填写消耗热量</small>
            </div>
            <div v-for="(exercise, index) in currentLog.exercises" :key="`exercise-${index}`" class="entry-row exercise-row">
              <select v-model="exercise.exercise_type" @change="onExerciseTypeChange(exercise)">
                <option value="">无</option>
                <option v-for="item in presets.exercises" :key="item.exercise_type" :value="item.exercise_type">
                  {{ item.exercise_type }}
                </option>
              </select>
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
              <label>更新体重 (kg)</label>
              <div class="weight-row">
                <input v-model.number="selectedDateWeight" type="number" min="20" max="300" step="0.1" />
                <button type="button" class="sub-btn" :disabled="saving || dailyLogLoading" @click="saveWeight">保存体重</button>
              </div>
            </div>

            <div class="preview-box">
              当日预估缺口：<strong>{{ previewDeficit }}</strong> kcal
              <span>；预计{{ previewWeightChangeLabel }}</span>
              <span v-if="selectedCalendarDay">；当前状态：{{ selectedCalendarDay.status }}</span>
            </div>
          </section>

          <button type="button" class="save-btn" :disabled="saving || loading || dailyLogLoading || presetsLoading" @click="saveDailyLog">
            {{ saving ? "保存中..." : "保存当日记录" }}
          </button>

          <p class="record-inline-tip">建议早晨空腹称重，以获得更稳定的趋势预测。</p>
        </div>

        <div v-if="modelForecastPaused && forecast?.reason" class="warn-card">{{ forecast.reason }}</div>
        <div v-if="missingLogsForecastPaused" class="warn-card">最近连续缺失记录，预测已暂停，补录后自动恢复。</div>
        <div v-if="continuousFailDays >= 3" class="warn-card red">
          已连续 {{ continuousFailDays }} 天未达标，建议复盘饮食与运动安排。
        </div>
      </aside>
    </section>

    <section v-if="!initializing && plan" class="trend-card">
      <div class="trend-head">
        <h3>趋势展示</h3>
        <small>从计划开始至今，共 {{ trendDayCount }} 天</small>
      </div>

      <div class="trend-tabs">
        <button
          v-for="tab in trendTabs"
          :key="tab.key"
          type="button"
          class="trend-tab-btn"
          :class="{ active: trendTab === tab.key }"
          @click="trendTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <p v-if="trendLoading && trendChart.points.length === 0" class="trend-empty">趋势加载中...</p>
      <div v-else-if="trendChart.points.length > 0" class="trend-chart-shell">
        <svg
          class="trend-chart-svg"
          :viewBox="`0 0 ${trendChart.width} ${trendChart.height}`"
          preserveAspectRatio="none"
          role="img"
          aria-label="趋势图"
        >
          <g>
            <line
              v-for="(tick, index) in trendChart.yTicks"
              :key="`y-grid-${index}`"
              class="trend-grid-line"
              :x1="trendChart.plotLeft"
              :y1="tick.y"
              :x2="trendChart.width - 12"
              :y2="tick.y"
            />
            <text
              v-for="(tick, index) in trendChart.yTicks"
              :key="`y-label-${index}`"
              class="trend-axis-text"
              x="4"
              :y="tick.y + 4"
            >
              {{ formatTrendAxisValue(tick.value) }}
            </text>
          </g>

          <g>
            <line
              v-for="(segment, index) in trendChart.segments"
              :key="`seg-${index}`"
              class="trend-line-segment"
              :class="{ dashed: segment.dashed }"
              :x1="segment.x1"
              :y1="segment.y1"
              :x2="segment.x2"
              :y2="segment.y2"
            />
            <circle
              v-for="(point, index) in trendChart.points"
              :key="`pt-${index}`"
              class="trend-point"
              :class="{ imputed: point.imputed }"
              :cx="point.x"
              :cy="point.y"
              r="3.5"
            />
          </g>

          <g>
            <text
              v-for="(tick, index) in trendChart.xTicks"
              :key="`x-label-${index}`"
              class="trend-axis-text"
              :x="tick.x"
              :y="trendChart.height - 8"
              :text-anchor="tick.anchor"
            >
              {{ tick.label }}
            </text>
          </g>
        </svg>
      </div>
      <p v-else class="trend-empty">暂无趋势数据</p>

      <p v-if="trendTab === 'weight'" class="trend-note">虚线段表示当日未登记体重，系统沿用前一日数据。</p>
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
  color: #0f172a;
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
  color: #334155;
}

.header-logout-btn {
  width: auto;
  padding: 7px 12px;
  border-radius: 8px;
}

.header-feedback {
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 10px;
}

.error.header-feedback {
  color: #fecaca;
  background: rgba(220, 38, 38, 0.15);
  border: 1px solid rgba(248, 113, 113, 0.35);
}

.success.header-feedback {
  color: #bbf7d0;
  background: rgba(22, 163, 74, 0.15);
  border: 1px solid rgba(74, 222, 128, 0.35);
}

.loading-card {
  background: #0f172a;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  padding: 16px;
  margin-bottom: 12px;
}

.loading-card .muted {
  margin: 0;
  color: #94a3b8;
}

.section-loading-text {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
}

.wizard-card {
  background: #0f172a;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  padding: 20px;
  margin-bottom: 16px;
}

.wizard-header h2 {
  margin: 0;
  font-size: 28px;
  color: #e2e8f0;
}

.wizard-header p {
  margin: 8px 0 0;
  color: #94a3b8;
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
  color: #cbd5e1;
}

.step span {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 2px solid rgba(148, 163, 184, 0.45);
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
  background: rgba(148, 163, 184, 0.35);
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
  color: #e2e8f0;
}

.field-stack {
  margin-bottom: 10px;
}

.field-stack label {
  display: block;
  margin-bottom: 6px;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 700;
}

.field-stack input,
.field-stack select {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}

.period-recommend-box {
  margin-top: 10px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 10px;
}

.period-recommend-box p {
  margin: 0 0 4px;
  color: #cbd5e1;
  font-size: 12px;
}

.period-recommend-box p:last-child {
  margin-bottom: 0;
}

.period-recommend-box strong {
  color: #93c5fd;
}

.period-suggest-line {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 11px;
}

.period-suggest-line.risk-fast {
  color: #fca5a5;
}

.period-suggest-line.risk-slow {
  color: #fcd34d;
}

.period-suggest-line.risk-ok {
  color: #86efac;
}

.mini-btn {
  margin-top: 6px;
  width: auto;
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  background: #1d4ed8;
  color: #ffffff;
}

.gender-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 10px;
}

.option-card {
  border: 2px solid rgba(148, 163, 184, 0.25);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.option-card:hover {
  border-color: #60a5fa;
  background: rgba(59, 130, 246, 0.22);
  color: #dbeafe;
}

.option-card.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.3);
  color: #eff6ff;
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
  color: #94a3b8;
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
  background: #334155;
  color: #e2e8f0;
}

.report-title {
  margin: 0 0 12px;
  font-size: 22px;
  color: #e2e8f0;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi-card {
  border-radius: 12px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #0f172a;
}

.kpi-card small {
  display: block;
  color: #94a3b8;
  font-weight: 700;
  margin-bottom: 4px;
}

.kpi-card strong {
  font-size: 24px;
  color: #e2e8f0;
}

.kpi-card.blue {
  background: rgba(30, 64, 175, 0.22);
  border-color: rgba(96, 165, 250, 0.4);
}

.kpi-card.green {
  background: rgba(6, 95, 70, 0.24);
  border-color: rgba(52, 211, 153, 0.35);
}

.kpi-card.dark {
  background: #0f172a;
  border-color: rgba(148, 163, 184, 0.24);
}

.kpi-card.dark small,
.kpi-card.dark strong {
  color: #e2e8f0;
}

.predict-box {
  margin-top: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
}

.predict-box small {
  color: #94a3b8;
}

.predict-box p {
  margin: 6px 0 0;
  font-weight: 700;
  color: #e2e8f0;
}

.warn-line {
  margin-top: 10px;
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(127, 29, 29, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #fca5a5;
  font-size: 13px;
}

.muted-line {
  margin-top: 8px;
  color: #94a3b8;
  font-size: 13px;
}

.wizard-card select option {
  background: #0f172a;
  color: #e2e8f0;
}

.calendar-top-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.metric-card {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.24);
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
  color: #e2e8f0;
}

.metric-date {
  font-size: 20px;
}

.metric-unit {
  color: #cbd5e1;
}

.metric-target {
  margin-left: auto;
  color: #93c5fd;
  font-weight: 700;
  font-size: 12px;
}

.metric-muted {
  margin: 8px 0 0;
  font-size: 12px;
  color: #cbd5e1;
}

.metric-bar {
  margin-top: 10px;
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.26);
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
  align-items: stretch;
}

.calendar-main {
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 14px;
  padding: 14px;
  height: 100%;
  display: flex;
  flex-direction: column;
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
  color: #e2e8f0;
}

.calendar-date-input {
  width: auto;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  color-scheme: dark;
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
  color: #6ee7b7;
  background: rgba(16, 185, 129, 0.16);
}

.legend.yellow {
  color: #fcd34d;
  background: rgba(245, 158, 11, 0.16);
}

.legend.red {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.16);
}

.legend.gray {
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.16);
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
  align-content: start;
}

.calendar-cell {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  min-height: 76px;
  background: #24334a;
  text-align: left;
  padding: 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
}

.calendar-cell.selected {
  transform: translateY(-1px);
}

.status-green {
  border-width: 2px;
  border-color: #4ade80;
}

.status-yellow {
  border-width: 2px;
  border-color: #fbbf24;
}

.status-red {
  border-width: 2px;
  border-color: #f87171;
}

.status-gray {
  background: #24334a;
  border-width: 1px;
  border-color: rgba(148, 163, 184, 0.35);
}

.day-number {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
}

.day-deficit {
  font-size: 10px;
  font-weight: 700;
  color: #cbd5e1;
}

.status-green .day-number,
.status-green .day-deficit {
  color: #86efac;
}

.status-yellow .day-number,
.status-yellow .day-deficit {
  color: #fde68a;
}

.status-red .day-number,
.status-red .day-deficit {
  color: #fca5a5;
}

.status-gray .day-number,
.status-gray .day-deficit {
  color: #dbe4f0;
}

.calendar-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.trend-card {
  margin-top: 12px;
  border-radius: 14px;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.24);
  padding: 14px;
}

.trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.trend-head h3 {
  margin: 0;
  font-size: 18px;
  color: #e2e8f0;
}

.trend-head small {
  color: #94a3b8;
  font-size: 12px;
}

.trend-tabs {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.trend-tab-btn {
  width: auto;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
}

.trend-tab-btn.active {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.28);
  color: #eff6ff;
}

.trend-chart-shell {
  margin-top: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.55);
  padding: 8px 10px;
}

.trend-chart-svg {
  display: block;
  width: 100%;
  height: 240px;
}

.trend-grid-line {
  stroke: rgba(148, 163, 184, 0.25);
  stroke-width: 1;
}

.trend-line-segment {
  stroke: #38bdf8;
  stroke-width: 2;
  fill: none;
}

.trend-line-segment.dashed {
  stroke-dasharray: 6 4;
  opacity: 0.95;
}

.trend-point {
  fill: #38bdf8;
  stroke: #0f172a;
  stroke-width: 1.5;
}

.trend-point.imputed {
  fill: rgba(56, 189, 248, 0.22);
  stroke: #38bdf8;
}

.trend-axis-text {
  fill: #94a3b8;
  font-size: 10px;
  font-weight: 600;
}

.trend-note {
  margin: 8px 0 0;
  color: #94a3b8;
  font-size: 11px;
}

.trend-empty {
  margin: 12px 0 0;
  color: #94a3b8;
  font-size: 12px;
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

.meal-block {
  margin-top: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  padding: 8px;
}

.meal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.meal-head h5 {
  margin: 0;
  font-size: 12px;
  color: #e2e8f0;
}

.meal-head .sub-btn {
  margin: 0;
  margin-left: auto;
}

.meal-target {
  font-size: 11px;
  color: #93c5fd;
  font-weight: 600;
}

.meal-empty {
  margin: 0;
  color: #94a3b8;
  font-size: 11px;
}

.entry-row {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) 76px 28px auto 32px;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}

.exercise-row {
  grid-template-columns: 1fr 96px 32px;
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
  padding-right: 24px;
  color-scheme: dark;
}

.record-card select option {
  background: #0f172a;
  color: #e2e8f0;
}

.entry-kcal {
  align-self: center;
  text-align: right;
  white-space: nowrap;
  color: #cbd5e1;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.entry-unit {
  color: #94a3b8;
  font-size: 11px;
  text-align: center;
}

.danger-btn {
  width: 32px;
  min-width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: #dc2626;
  color: #ffffff;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
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

.record-inline-tip {
  margin: 8px 2px 0;
  color: #94a3b8;
  font-size: 11px;
}

.tip-card,
.warn-card {
  border-radius: 12px;
  padding: 10px;
  font-size: 12px;
  background: #0f172a;
}

.tip-card {
  border: 1px solid rgba(96, 165, 250, 0.42);
  color: #bfdbfe;
}

.warn-card {
  border: 1px solid rgba(245, 158, 11, 0.42);
  color: #fcd34d;
}

.warn-card.red {
  border-color: rgba(239, 68, 68, 0.42);
  color: #fca5a5;
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

  .trend-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .trend-chart-svg {
    height: 220px;
  }
}
</style>
