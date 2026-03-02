import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const matched = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : String(value).slice(0, 10);
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const planId = Number(event.queryStringParameters?.plan_id);
    const endDateInput = String(event.queryStringParameters?.end_date ?? "");
    if (!Number.isInteger(planId)) {
      return badRequest("缺少有效 plan_id");
    }
    if (endDateInput && !validateDate(endDateInput)) {
      return badRequest("end_date 格式无效");
    }

    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) {
      return badRequest("计划不存在或无访问权限");
    }

    let startDate = toDateKey(plan.start_date);
    const endDate = endDateInput || new Date().toISOString().slice(0, 10);
    if (!validateDate(startDate) || !validateDate(endDate)) {
      return badRequest("日期参数无效");
    }

    const firstDataDateRes = await query(
      `
        SELECT MIN(log_date)::date AS first_data_date
        FROM (
          SELECT log_date FROM daily_logs WHERE plan_id = $1
          UNION ALL
          SELECT log_date FROM weight_logs WHERE plan_id = $1
        ) t
      `,
      [planId]
    );
    const firstDataDate = toDateKey(firstDataDateRes.rows[0]?.first_data_date);

    if (validateDate(firstDataDate) && firstDataDate < startDate) {
      startDate = firstDataDate;
    }
    if (startDate > endDate) {
      if (validateDate(firstDataDate) && firstDataDate <= endDate) {
        startDate = firstDataDate;
      } else {
        startDate = endDate;
      }
    }

    const { rows } = await query(
      `
        WITH day_series AS (
          SELECT generate_series($2::date, $3::date, INTERVAL '1 day')::date AS log_date
        ),
        weight_daily AS (
          SELECT DISTINCT ON (log_date)
            log_date,
            weight
          FROM weight_logs
          WHERE plan_id = $1
          ORDER BY log_date ASC, record_time DESC, id DESC
        )
        SELECT
          ds.log_date,
          wd.weight,
          dl.intake_kcal,
          dl.exercise_kcal,
          dl.deficit
        FROM day_series ds
        LEFT JOIN weight_daily wd ON wd.log_date = ds.log_date
        LEFT JOIN daily_logs dl ON dl.plan_id = $1 AND dl.log_date = ds.log_date
        ORDER BY ds.log_date ASC
      `,
      [planId, startDate, endDate]
    );

    const days = rows.map((row) => ({
      date: toDateKey(row.log_date),
      weight: row.weight === null || row.weight === undefined ? null : Number(row.weight),
      intake_kcal: Number(row.intake_kcal ?? 0),
      exercise_kcal: Number(row.exercise_kcal ?? 0),
      deficit: Number(row.deficit ?? 0)
    }));

    return ok({ days });
  } catch (error) {
    return serverError(error.message);
  }
}
