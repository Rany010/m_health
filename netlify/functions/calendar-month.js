import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getPlanByIdAndUser } from "./_lib/domain.js";
import {
  computeCurrentStreak,
  computeWeekSuccessRate,
  getStatusMapByPlan,
  getTimeContext,
  normalizeUserTimeZone
} from "./_lib/buddy.js";
import { shiftDateKey } from "./_lib/date.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function utcDateFromKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split("-").map((item) => Number(item));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function monthRange(year, month, planStartDate) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const cappedLast = last.getTime() > todayUtc.getTime() ? todayUtc : last;
  const planStartUtc = utcDateFromKey(planStartDate);
  const start =
    planStartUtc && planStartUtc.getTime() > first.getTime() ? planStartUtc : first;
  if (start.getTime() > cappedLast.getTime()) {
    return {
      start: start.toISOString().slice(0, 10),
      end: cappedLast.toISOString().slice(0, 10),
      startDay: 0,
      endDay: -1,
      totalDays: 0
    };
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: cappedLast.toISOString().slice(0, 10),
    startDay: start.getUTCDate(),
    endDay: cappedLast.getUTCDate(),
    totalDays: cappedLast.getUTCDate() - start.getUTCDate() + 1
  };
}

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value);
  const matched = raw.match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : raw.slice(0, 10);
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
    const range = monthRange(year, month, toDateKey(plan.start_date));
    const monthLogsPromise =
      range.totalDays > 0
        ? query(
            `
              SELECT log_date, status, deficit
              FROM daily_logs
              WHERE plan_id = $1 AND log_date BETWEEN $2 AND $3
              ORDER BY log_date ASC
            `,
            [planId, range.start, range.end]
          )
        : Promise.resolve({ rows: [] });
    const timeZone = normalizeUserTimeZone(auth.user.time_zone);
    const { todayDate, weekStartDate } = getTimeContext(timeZone);
    const fullStatusMapPromise = getStatusMapByPlan(planId, shiftDateKey(todayDate, -365), todayDate);
    const [monthLogs, fullStatusMap] = await Promise.all([monthLogsPromise, fullStatusMapPromise]);

    const statusByDate = {};
    const deficitByDate = {};
    for (const row of monthLogs.rows) {
      const dateKey = toDateKey(row.log_date);
      statusByDate[dateKey] = row.status;
      deficitByDate[dateKey] = Number(row.deficit ?? 0);
    }
    const days = [];
    for (let i = range.startDay; i <= range.endDay; i += 1) {
      const date = `${year.toString().padStart(4, "0")}-${month
        .toString()
        .padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
      days.push({
        date,
        status: statusByDate[date] ?? "gray",
        deficit: deficitByDate[date] ?? 0
      });
    }

    return ok({
      days,
      current_streak: computeCurrentStreak(fullStatusMap, todayDate),
      week_success_rate: computeWeekSuccessRate(fullStatusMap, weekStartDate, todayDate)
    });
  } catch (error) {
    return serverError(error.message);
  }
}
