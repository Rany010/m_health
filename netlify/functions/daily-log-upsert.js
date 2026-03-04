import { requireAuth } from "./_lib/auth.js";
import { classifyDailyStatus } from "./_lib/calc.js";
import { EXERCISE_PRESETS, FOOD_PRESETS } from "./_lib/presets.js";
import { transaction } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function toKcal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.round(n);
}

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function normalizeMealType(value) {
  const mealType = String(value ?? "breakfast");
  if (mealType === "breakfast" || mealType === "lunch" || mealType === "dinner") {
    return mealType;
  }
  return "breakfast";
}

function toOptionalId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function buildFoodPresetMap() {
  const map = new Map();
  for (const item of FOOD_PRESETS) {
    map.set(item.food_name, {
      kcal_per_100g: Number(item.kcal_per_100g),
      kcal_per_unit: Number(item.kcal_per_unit)
    });
  }
  return map;
}

function buildExercisePresetMap() {
  const map = new Map();
  for (const item of EXERCISE_PRESETS) {
    map.set(item.exercise_type, Number(item.kcal_per_min));
  }
  return map;
}

function resolveFoodKcal(food, oldFoodById, foodPresetMap) {
  const foodId = toOptionalId(food.id);
  const mealType = normalizeMealType(food.meal_type);
  const foodName = String(food.food_name ?? "未知食物").slice(0, 80);
  const portion = String(food.portion ?? "1份").slice(0, 20);
  const weightRaw = Number(food.weight_g);
  const weightG = Number.isFinite(weightRaw) ? Math.max(0, Math.round(weightRaw)) : null;
  const oldFood = foodId ? oldFoodById.get(foodId) : null;
  const unchanged =
    oldFood &&
    oldFood.food_name === foodName &&
    Number(oldFood.weight_g ?? 0) === Number(weightG ?? 0);

  if (unchanged) {
    return {
      id: foodId,
      meal_type: mealType,
      food_name: foodName,
      portion,
      weight_g: weightG,
      kcal: toKcal(oldFood.kcal)
    };
  }

  const preset = foodPresetMap.get(foodName);
  if (!preset) {
    throw new Error(`未知食物: ${foodName}`);
  }
  let kcal = 0;
  if (Number.isFinite(preset.kcal_per_unit)) {
    kcal = Math.round(preset.kcal_per_unit * Number(weightG ?? 0));
  } else if (Number.isFinite(preset.kcal_per_100g)) {
    kcal = Math.round((preset.kcal_per_100g * Number(weightG ?? 0)) / 100);
  } else {
    throw new Error(`未知食物: ${foodName}`);
  }
  return {
    id: foodId,
    meal_type: mealType,
    food_name: foodName,
    portion,
    weight_g: weightG,
    kcal
  };
}

function resolveExerciseKcal(exercise, oldExerciseById, exercisePresetMap) {
  const exerciseId = toOptionalId(exercise.id);
  const exerciseType = String(exercise.exercise_type ?? "").slice(0, 80);
  const durationMin = toKcal(exercise.duration_min);
  const manualKcal = Boolean(exercise.manual_kcal);
  const providedKcal = toKcal(exercise.kcal);
  const oldExercise = exerciseId ? oldExerciseById.get(exerciseId) : null;
  const unchanged =
    !manualKcal &&
    oldExercise &&
    oldExercise.exercise_type === exerciseType &&
    Number(oldExercise.duration_min ?? 0) === Number(durationMin ?? 0);

  if (unchanged) {
    return {
      id: exerciseId,
      exercise_type: exerciseType,
      duration_min: durationMin,
      kcal: toKcal(oldExercise.kcal)
    };
  }

  if (!exerciseType || manualKcal) {
    return {
      id: exerciseId,
      exercise_type: exerciseType,
      duration_min: durationMin,
      kcal: providedKcal
    };
  }

  const kcalPerMin = exercisePresetMap.get(exerciseType);
  if (!Number.isFinite(kcalPerMin)) {
    throw new Error(`未知运动类型: ${exerciseType}`);
  }
  const kcal = Math.round(kcalPerMin * durationMin);
  return {
    id: exerciseId,
    exercise_type: exerciseType,
    duration_min: durationMin,
    kcal
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const body = parseJsonBody(event);
    if (!body) return badRequest("请求体不是合法 JSON");

    const planId = Number(body.plan_id);
    const logDate = String(body.date ?? "");
    const note = String(body.note ?? "").slice(0, 200);
    const foods = Array.isArray(body.foods) ? body.foods : [];
    const exercises = Array.isArray(body.exercises) ? body.exercises : [];

    if (!Number.isInteger(planId) || !validateDate(logDate)) {
      return badRequest("缺少有效 plan_id 或 date");
    }

    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) {
      return badRequest("计划不存在或无访问权限");
    }

    const output = await transaction(async (client) => {
      const oldFoodsRes = await client.query(
        `
          SELECT id, meal_type, food_name, weight_g, kcal
          FROM food_items
          WHERE daily_log_id IN (
            SELECT id FROM daily_logs WHERE plan_id = $1 AND log_date = $2
          )
        `,
        [planId, logDate]
      );
      const oldExercisesRes = await client.query(
        `
          SELECT id, exercise_type, duration_min, kcal
          FROM exercise_items
          WHERE daily_log_id IN (
            SELECT id FROM daily_logs WHERE plan_id = $1 AND log_date = $2
          )
        `,
        [planId, logDate]
      );
      const oldFoodById = new Map(oldFoodsRes.rows.map((item) => [Number(item.id), item]));
      const oldExerciseById = new Map(oldExercisesRes.rows.map((item) => [Number(item.id), item]));
      const foodPresetMap = buildFoodPresetMap();
      const exercisePresetMap = buildExercisePresetMap();
      const normalizedFoods = foods.map((item) =>
        resolveFoodKcal(item, oldFoodById, foodPresetMap)
      );
      const normalizedExercises = exercises.map((item) =>
        resolveExerciseKcal(item, oldExerciseById, exercisePresetMap)
      );
      const effectiveExercises = normalizedExercises.filter(
        (item) => item.exercise_type || item.duration_min > 0 || item.kcal > 0
      );
      const intakeKcal = normalizedFoods.reduce((sum, item) => sum + item.kcal, 0);
      const exerciseKcal = effectiveExercises.reduce((sum, item) => sum + item.kcal, 0);
      const deficit = Number(plan.tdee) - intakeKcal + exerciseKcal;
      const status = classifyDailyStatus(deficit, Number(plan.daily_deficit_target));

      const upsert = await client.query(
        `
          INSERT INTO daily_logs (plan_id, log_date, intake_kcal, exercise_kcal, deficit, status, note, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (plan_id, log_date)
          DO UPDATE SET
            intake_kcal = EXCLUDED.intake_kcal,
            exercise_kcal = EXCLUDED.exercise_kcal,
            deficit = EXCLUDED.deficit,
            status = EXCLUDED.status,
            note = EXCLUDED.note,
            updated_at = NOW()
          RETURNING id, plan_id, log_date, intake_kcal, exercise_kcal, deficit, status, note
        `,
        [planId, logDate, intakeKcal, exerciseKcal, deficit, status, note || null]
      );
      const dailyLog = upsert.rows[0];
      await client.query(`DELETE FROM food_items WHERE daily_log_id = $1`, [dailyLog.id]);
      await client.query(`DELETE FROM exercise_items WHERE daily_log_id = $1`, [dailyLog.id]);

      for (const food of normalizedFoods) {
        await client.query(
          `
            INSERT INTO food_items (daily_log_id, meal_type, food_name, portion, weight_g, kcal)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            dailyLog.id,
            food.meal_type,
            food.food_name,
            food.portion,
            food.weight_g === null ? null : toKcal(food.weight_g),
            toKcal(food.kcal)
          ]
        );
      }
      for (const ex of effectiveExercises) {
        await client.query(
          `
            INSERT INTO exercise_items (daily_log_id, exercise_type, duration_min, kcal)
            VALUES ($1, $2, $3, $4)
          `,
          [
            dailyLog.id,
            ex.exercise_type,
            toKcal(ex.duration_min),
            toKcal(ex.kcal)
          ]
        );
      }
      return dailyLog;
    });

    return ok({
      daily_log: output
    });
  } catch (error) {
    if (String(error.message).startsWith("未知食物") || String(error.message).startsWith("未知运动类型")) {
      return badRequest(error.message);
    }
    return serverError(error.message);
  }
}
