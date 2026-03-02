import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

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
    const date = String(body.date ?? new Date().toISOString().slice(0, 10));
    const weight = Number(body.weight);
    if (!Number.isInteger(planId) || !validateDate(date) || !Number.isFinite(weight)) {
      return badRequest("参数无效");
    }
    if (weight < 20 || weight > 300) {
      return badRequest("体重超出合理范围");
    }
    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) return badRequest("计划不存在或无访问权限");

    await query(
      `
        INSERT INTO weight_logs (plan_id, log_date, weight, record_time)
        VALUES ($1, $2, $3, NOW())
      `,
      [planId, date, weight]
    );
    return ok({ success: true });
  } catch (error) {
    return serverError(error.message);
  }
}
