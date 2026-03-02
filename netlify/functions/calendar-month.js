import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function monthRange(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
    totalDays: last.getUTCDate()
  };
}

function computeCurrentStreak(dayRows) {
  let streak = 0;
  const sorted = [...dayRows].sort((a, b) =>
    String(a.log_date).localeCompare(String(b.log_date))
  );
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].status === "green") {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const planId = Number(event.queryStringParameters?.plan_id);
    const year = Number(event.queryStringParameters?.year);
    const month = Number(event.queryStringParameters?.month);

    if (!Number.isInteger(planId) || !Number.isInteger(year) || !Number.isInteger(month)) {
      return badRequest("缺少有效参数");
    }
    const plan = await getPlanByIdAndUser(planId, auth.user.user_id);
    if (!plan) {
      return badRequest("计划不存在或无访问权限");
    }
    const range = monthRange(year, month);
    const monthLogs = await query(
      `
        SELECT log_date, status, deficit
        FROM daily_logs
        WHERE plan_id = $1 AND log_date BETWEEN $2 AND $3
        ORDER BY log_date ASC
      `,
      [planId, range.start, range.end]
    );

    const statusByDate = {};
    for (const row of monthLogs.rows) {
      statusByDate[String(row.log_date).slice(0, 10)] = row.status;
    }
    const days = [];
    for (let i = 1; i <= range.totalDays; i += 1) {
      const date = `${year.toString().padStart(4, "0")}-${month
        .toString()
        .padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
      days.push({
        date,
        status: statusByDate[date] ?? "gray"
      });
    }

    const weekStats = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'green')::int AS green
        FROM daily_logs
        WHERE plan_id = $1
          AND log_date >= (CURRENT_DATE - INTERVAL '6 days')::date
      `,
      [planId]
    );
    const total = Number(weekStats.rows[0]?.total ?? 0);
    const green = Number(weekStats.rows[0]?.green ?? 0);
    const successRate = total === 0 ? 0 : Math.round((green / total) * 100);

    return ok({
      days,
      current_streak: computeCurrentStreak(monthLogs.rows),
      week_success_rate: successRate
    });
  } catch (error) {
    return serverError(error.message);
  }
}
