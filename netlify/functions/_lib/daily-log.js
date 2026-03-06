import { query } from "./db.js";
import { shiftDateKey, validateDateKey } from "./date.js";
import { EXERCISE_PRESETS, FOOD_PRESETS } from "./presets.js";

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const matched = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : "";
}

function defaultFoodAmount(preset) {
  return Number.isFinite(Number(preset?.kcal_per_unit)) ? 1 : 100;
}

function defaultExerciseDuration(exercisePreset) {
  return Math.max(10, Math.round(Number(exercisePreset?.default_duration_min ?? 30) || 30));
}

async function getWeightSnapshot(planId, date, fallbackWeight) {
  const weightResult = await query(
    `
      SELECT weight
      FROM weight_logs
      WHERE plan_id = $1 AND log_date = $2
      ORDER BY record_time DESC, id DESC
      LIMIT 1
    `,
    [planId, date]
  );

  if (weightResult.rows.length > 0) {
    return {
      weight: Number(weightResult.rows[0].weight),
      weight_source: "recorded"
    };
  }

  const inheritedWeightRes = await query(
    `
      SELECT weight
      FROM weight_logs
      WHERE plan_id = $1 AND log_date < $2
      ORDER BY log_date DESC, record_time DESC, id DESC
      LIMIT 1
    `,
    [planId, date]
  );
  if (inheritedWeightRes.rows.length > 0) {
    return {
      weight: Number(inheritedWeightRes.rows[0].weight),
      weight_source: "inherited"
    };
  }

  return {
    weight: Number(fallbackWeight),
    weight_source: "plan_start"
  };
}

async function getDailyLogRows(planId, date) {
  const { rows } = await query(
    `
      SELECT *
      FROM daily_logs
      WHERE plan_id = $1 AND log_date = $2
      LIMIT 1
    `,
    [planId, date]
  );
  if (rows.length === 0) {
    return {
      daily_log: null,
      foods: [],
      exercises: []
    };
  }

  const dailyLog = rows[0];
  const [foods, exercises] = await Promise.all([
    query(
      `
        SELECT id, meal_type, food_name, portion, weight_g, kcal
        FROM food_items
        WHERE daily_log_id = $1
        ORDER BY id ASC
      `,
      [dailyLog.id]
    ),
    query(
      `
        SELECT id, exercise_type, duration_min, kcal
        FROM exercise_items
        WHERE daily_log_id = $1
        ORDER BY id ASC
      `,
      [dailyLog.id]
    )
  ]);

  return {
    daily_log: dailyLog,
    foods: foods.rows,
    exercises: exercises.rows
  };
}

async function getFavoriteFoods(userId) {
  const presetMap = new Map(FOOD_PRESETS.map((item) => [item.food_name, item]));
  const { rows } = await query(
    `
      SELECT
        fi.food_name,
        COUNT(*)::int AS total_count,
        ROUND(AVG(COALESCE(fi.weight_g, 0)))::int AS avg_weight_g,
        MAX(dl.log_date)::date AS recent_date
      FROM food_items fi
      INNER JOIN daily_logs dl ON dl.id = fi.daily_log_id
      INNER JOIN plans p ON p.id = dl.plan_id
      WHERE p.user_id = $1
      GROUP BY fi.food_name
      ORDER BY total_count DESC, recent_date DESC, fi.food_name ASC
      LIMIT 6
    `,
    [userId]
  );

  return rows
    .map((row) => {
      const preset = presetMap.get(String(row.food_name));
      if (!preset) return null;
      const amount = Math.max(1, Number(row.avg_weight_g) || defaultFoodAmount(preset));
      const kcal = Number.isFinite(Number(preset.kcal_per_unit))
        ? Math.round(Number(preset.kcal_per_unit) * amount)
        : Math.round((Number(preset.kcal_per_100g) * amount) / 100);
      return {
        food_name: preset.food_name,
        unit: String(preset.unit ?? "g"),
        weight_g: amount,
        kcal,
        total_count: Number(row.total_count ?? 0),
        recent_date: toDateKey(row.recent_date)
      };
    })
    .filter(Boolean);
}

async function getFavoriteExercises(userId) {
  const presetMap = new Map(EXERCISE_PRESETS.map((item) => [item.exercise_type, item]));
  const { rows } = await query(
    `
      SELECT
        ei.exercise_type,
        COUNT(*)::int AS total_count,
        ROUND(AVG(NULLIF(ei.duration_min, 0)))::int AS avg_duration_min,
        MAX(dl.log_date)::date AS recent_date
      FROM exercise_items ei
      INNER JOIN daily_logs dl ON dl.id = ei.daily_log_id
      INNER JOIN plans p ON p.id = dl.plan_id
      WHERE p.user_id = $1
        AND ei.exercise_type <> ''
      GROUP BY ei.exercise_type
      ORDER BY total_count DESC, recent_date DESC, ei.exercise_type ASC
      LIMIT 4
    `,
    [userId]
  );

  return rows
    .map((row) => {
      const preset = presetMap.get(String(row.exercise_type));
      if (!preset) return null;
      const durationMin = Math.max(10, Number(row.avg_duration_min) || defaultExerciseDuration(preset));
      return {
        exercise_type: preset.exercise_type,
        duration_min: durationMin,
        kcal: Math.round(Number(preset.kcal_per_min) * durationMin),
        total_count: Number(row.total_count ?? 0),
        recent_date: toDateKey(row.recent_date)
      };
    })
    .filter(Boolean);
}

async function getPreviousDayLog(planId, date) {
  if (!validateDateKey(date)) {
    return {
      date: "",
      has_data: false,
      foods: [],
      exercises: [],
      note: ""
    };
  }
  const previousDate = shiftDateKey(date, -1);
  const previousLog = await getDailyLogRows(planId, previousDate);
  return {
    date: previousDate,
    has_data: Boolean(previousLog.daily_log),
    foods: previousLog.foods.map((item) => ({
      meal_type: item.meal_type,
      food_name: item.food_name,
      portion: item.portion,
      weight_g: Number(item.weight_g ?? 0),
      kcal: Number(item.kcal ?? 0)
    })),
    exercises: previousLog.exercises.map((item) => ({
      exercise_type: item.exercise_type,
      duration_min: Number(item.duration_min ?? 0),
      kcal: Number(item.kcal ?? 0),
      manual_kcal: false
    })),
    note: String(previousLog.daily_log?.note ?? "")
  };
}

export async function buildDailyLogPayload({ plan, date, userId }) {
  const [weightSnapshot, logRows, favoriteFoods, favoriteExercises, previousDay] = await Promise.all([
    getWeightSnapshot(plan.id, date, plan.start_weight),
    getDailyLogRows(plan.id, date),
    getFavoriteFoods(userId),
    getFavoriteExercises(userId),
    getPreviousDayLog(plan.id, date)
  ]);

  return {
    ...logRows,
    weight: weightSnapshot.weight,
    weight_source: weightSnapshot.weight_source,
    quick_actions: {
      favorite_foods: favoriteFoods,
      favorite_exercises: favoriteExercises,
      previous_day: previousDay
    }
  };
}
