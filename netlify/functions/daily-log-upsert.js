import { requireAuth } from "./_lib/auth.js";
import { classifyDailyStatus } from "./_lib/calc.js";
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

    const intakeKcal = foods.reduce((sum, item) => sum + toKcal(item.kcal), 0);
    const exerciseKcal = exercises.reduce((sum, item) => sum + toKcal(item.kcal), 0);
    const deficit = Number(plan.tdee) - intakeKcal + exerciseKcal;
    const status = classifyDailyStatus(deficit, Number(plan.daily_deficit_target));

    const output = await transaction(async (client) => {
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

      for (const food of foods) {
        await client.query(
          `
            INSERT INTO food_items (daily_log_id, food_name, portion, weight_g, kcal)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            dailyLog.id,
            String(food.food_name ?? "未知食物").slice(0, 80),
            String(food.portion ?? "1份").slice(0, 20),
            food.weight_g ? toKcal(food.weight_g) : null,
            toKcal(food.kcal)
          ]
        );
      }
      for (const ex of exercises) {
        await client.query(
          `
            INSERT INTO exercise_items (daily_log_id, exercise_type, duration_min, kcal)
            VALUES ($1, $2, $3, $4)
          `,
          [
            dailyLog.id,
            String(ex.exercise_type ?? "运动").slice(0, 80),
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
    return serverError(error.message);
  }
}
