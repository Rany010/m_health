import { requireAuth } from "./_lib/auth.js";
import { buildDailyLogPayload } from "./_lib/daily-log.js";
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

    return ok(await buildDailyLogPayload({ plan, date, userId: auth.user.user_id }));
  } catch (error) {
    return serverError(error.message);
  }
}
