import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const planId = Number(event.queryStringParameters?.plan_id);
    const date = String(event.queryStringParameters?.date ?? "");
    if (!Number.isInteger(planId) || !validateDate(date)) {
      return badRequest("缺少有效参数");
    }
    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) {
      return badRequest("计划不存在或无访问权限");
    }

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
      return ok({ daily_log: null, foods: [], exercises: [] });
    }
    const dailyLog = rows[0];
    const foods = await query(
      `
        SELECT id, food_name, portion, weight_g, kcal
        FROM food_items
        WHERE daily_log_id = $1
      `,
      [dailyLog.id]
    );
    const exercises = await query(
      `
        SELECT id, exercise_type, duration_min, kcal
        FROM exercise_items
        WHERE daily_log_id = $1
      `,
      [dailyLog.id]
    );

    return ok({
      daily_log: dailyLog,
      foods: foods.rows,
      exercises: exercises.rows
    });
  } catch (error) {
    return serverError(error.message);
  }
}
