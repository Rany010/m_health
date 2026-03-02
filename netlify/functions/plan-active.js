import { requireAuth } from "./_lib/auth.js";
import { getActivePlanByUser, getLatestWeight } from "./_lib/domain.js";
import { query } from "./_lib/db.js";
import { ok, serverError } from "./_lib/response.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return ok({});
  }

  try {
    const auth = await requireAuth(event);
    if (auth.error) {
      return auth.error;
    }
    const plan = await getActivePlanByUser(auth.user.user_id);
    if (!plan) {
      return ok({ plan: null });
    }
    const latestWeight = await getLatestWeight(plan.id, plan.start_weight);
    const { rows } = await query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'green')::int AS green_days,
          COUNT(*)::int AS total_logged_days
        FROM daily_logs
        WHERE plan_id = $1
      `,
      [plan.id]
    );

    return ok({
      plan: {
        id: plan.id,
        start_date: plan.start_date,
        end_date: plan.end_date,
        start_weight: Number(plan.start_weight),
        target_weight: Number(plan.target_weight),
        daily_kcal_target: Number(plan.daily_kcal_target),
        daily_deficit_target: Number(plan.daily_deficit_target),
        tdee: Number(plan.tdee),
        latest_weight: latestWeight,
        green_days: rows[0]?.green_days ?? 0,
        total_logged_days: rows[0]?.total_logged_days ?? 0
      }
    });
  } catch (error) {
    return serverError(error.message);
  }
}
