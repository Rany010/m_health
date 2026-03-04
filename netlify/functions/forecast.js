import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser, getLatestWeight } from "./_lib/domain.js";
import { estimateFinishDate, filterWeightOutliers } from "./_lib/forecast.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;
    const planId = Number(event.queryStringParameters?.plan_id);
    if (!Number.isInteger(planId)) return badRequest("缺少有效 plan_id");

    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) return badRequest("计划不存在或无访问权限");

    const deficitsRes = await query(
      `
        SELECT deficit
        FROM daily_logs
        WHERE plan_id = $1
        ORDER BY log_date DESC
        LIMIT 14
      `,
      [planId]
    );
    if (deficitsRes.rows.length < 2) {
      return ok({
        paused: true,
        reason: "记录不足，无法预测"
      });
    }
    const averageDeficit =
      deficitsRes.rows.reduce((sum, row) => sum + Number(row.deficit), 0) /
      deficitsRes.rows.length;
    if (averageDeficit <= 0) {
      return ok({
        paused: true,
        reason: "当前平均缺口<=0，按当前执行无法达标",
        average_deficit: Math.round(averageDeficit)
      });
    }

    const weightRes = await query(
      `
        SELECT weight, log_date, record_time
        FROM weight_logs
        WHERE plan_id = $1
        ORDER BY log_date DESC, record_time DESC, id DESC
        LIMIT 30
      `,
      [planId]
    );
    const filteredWeights = filterWeightOutliers(weightRes.rows);
    const latestWeight =
      filteredWeights.length > 0
        ? Number(filteredWeights[0].weight)
        : await getLatestWeight(planId, plan.start_weight);
    const estimate = estimateFinishDate({
      latestWeight,
      targetWeight: Number(plan.target_weight),
      averageDeficit
    });

    return ok({
      paused: false,
      latest_weight: latestWeight,
      average_deficit: Math.round(averageDeficit),
      estimated_finish_date: estimate.estimated_date,
      remain_days: estimate.remain_days
    });
  } catch (error) {
    return serverError(error.message);
  }
}
