import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getActivePlanByUser, getLatestWeight } from "./_lib/domain.js";
import { estimateFinishDate, filterWeightOutliers } from "./_lib/forecast.js";
import { EXERCISE_PRESETS, FOOD_PRESETS } from "./_lib/presets.js";
import {
  computeCurrentStreak,
  computeWeekSuccessRate,
  getStatusMapByPlan,
  getTimeContext,
  normalizeUserTimeZone
} from "./_lib/buddy.js";
import { shiftDateKey } from "./_lib/date.js";
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

function utcDateFromKey(dateKey) {
  if (!validateDate(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map((item) => Number(item));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function monthRange(year, month, planStartDate, todayDate) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const fallbackNow = new Date();
  const todayUtc =
    utcDateFromKey(todayDate) ??
    new Date(
      Date.UTC(
        fallbackNow.getUTCFullYear(),
        fallbackNow.getUTCMonth(),
        fallbackNow.getUTCDate()
      )
    );
  const cappedLast = last.getTime() > todayUtc.getTime() ? todayUtc : last;
  const planStartUtc = utcDateFromKey(planStartDate);
  const start = planStartUtc && planStartUtc.getTime() > first.getTime() ? planStartUtc : first;
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

function parseIncludePresets(rawValue) {
  return String(rawValue ?? "").toLowerCase() === "1" || String(rawValue ?? "").toLowerCase() === "true";
}

async function buildPlanSummary(plan) {
  const [latestWeight, stats] = await Promise.all([
    getLatestWeight(plan.id, plan.start_weight),
    query(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'green')::int AS green_days,
          COUNT(*)::int AS total_logged_days
        FROM daily_logs
        WHERE plan_id = $1
      `,
      [plan.id]
    )
  ]);
  const rows = stats.rows;
  return {
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
  };
}

async function buildCalendar(plan, selectedDate, timeZone) {
  const { todayDate, weekStartDate } = getTimeContext(timeZone);
  const year = Number(selectedDate.slice(0, 4));
  const month = Number(selectedDate.slice(5, 7));
  const range = monthRange(year, month, toDateKey(plan.start_date), todayDate);

  const monthLogsPromise =
    range.totalDays > 0
      ? query(
          `
            SELECT log_date, status, deficit
            FROM daily_logs
            WHERE plan_id = $1 AND log_date BETWEEN $2 AND $3
            ORDER BY log_date ASC
          `,
          [plan.id, range.start, range.end]
        )
      : Promise.resolve({ rows: [] });
  const fullStatusMapPromise = getStatusMapByPlan(plan.id, shiftDateKey(todayDate, -365), todayDate);
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
    const date = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${i
      .toString()
      .padStart(2, "0")}`;
    days.push({
      date,
      status: statusByDate[date] ?? "gray",
      deficit: deficitByDate[date] ?? 0
    });
  }

  return {
    days,
    current_streak: computeCurrentStreak(fullStatusMap, todayDate),
    week_success_rate: computeWeekSuccessRate(fullStatusMap, weekStartDate, todayDate)
  };
}

async function buildForecast(plan) {
  const deficitsRes = await query(
    `
      SELECT deficit
      FROM daily_logs
      WHERE plan_id = $1
      ORDER BY log_date DESC
      LIMIT 14
    `,
    [plan.id]
  );
  if (deficitsRes.rows.length < 2) {
    return {
      paused: true,
      reason: "记录不足，无法预测"
    };
  }

  const averageDeficit =
    deficitsRes.rows.reduce((sum, row) => sum + Number(row.deficit), 0) / deficitsRes.rows.length;
  if (averageDeficit <= 0) {
    return {
      paused: true,
      reason: "当前平均缺口<=0，按当前执行无法达标",
      average_deficit: Math.round(averageDeficit)
    };
  }

  const weightRes = await query(
    `
      SELECT weight, log_date, record_time
      FROM weight_logs
      WHERE plan_id = $1
      ORDER BY log_date DESC, record_time DESC, id DESC
      LIMIT 30
    `,
    [plan.id]
  );
  const filteredWeights = filterWeightOutliers(weightRes.rows);
  const latestWeight =
    filteredWeights.length > 0
      ? Number(filteredWeights[0].weight)
      : await getLatestWeight(plan.id, plan.start_weight);
  const estimate = estimateFinishDate({
    latestWeight,
    targetWeight: Number(plan.target_weight),
    averageDeficit
  });

  return {
    paused: false,
    latest_weight: latestWeight,
    average_deficit: Math.round(averageDeficit),
    estimated_finish_date: estimate.estimated_date,
    remain_days: estimate.remain_days
  };
}

async function buildDailyLog(plan, selectedDate) {
  const weightResult = await query(
    `
      SELECT weight
      FROM weight_logs
      WHERE plan_id = $1 AND log_date = $2
      ORDER BY record_time DESC, id DESC
      LIMIT 1
    `,
    [plan.id, selectedDate]
  );

  let weight = null;
  let weightSource = "none";
  if (weightResult.rows.length > 0) {
    weight = Number(weightResult.rows[0].weight);
    weightSource = "recorded";
  } else {
    const inheritedWeightRes = await query(
      `
        SELECT weight
        FROM weight_logs
        WHERE plan_id = $1 AND log_date < $2
        ORDER BY log_date DESC, record_time DESC, id DESC
        LIMIT 1
      `,
      [plan.id, selectedDate]
    );
    if (inheritedWeightRes.rows.length > 0) {
      weight = Number(inheritedWeightRes.rows[0].weight);
      weightSource = "inherited";
    } else {
      weight = Number(plan.start_weight);
      weightSource = "plan_start";
    }
  }

  const dailyLogRes = await query(
    `
      SELECT *
      FROM daily_logs
      WHERE plan_id = $1 AND log_date = $2
      LIMIT 1
    `,
    [plan.id, selectedDate]
  );
  if (dailyLogRes.rows.length === 0) {
    return {
      daily_log: null,
      foods: [],
      exercises: [],
      weight,
      weight_source: weightSource
    };
  }

  const dailyLog = dailyLogRes.rows[0];
  const [foods, exercises] = await Promise.all([
    query(
      `
        SELECT id, meal_type, food_name, portion, weight_g, kcal
        FROM food_items
        WHERE daily_log_id = $1
        ORDER BY id ASC
      `,
      [dailyLog.id]
    ),
    query(
      `
        SELECT id, exercise_type, duration_min, kcal
        FROM exercise_items
        WHERE daily_log_id = $1
      `,
      [dailyLog.id]
    )
  ]);

  return {
    daily_log: dailyLog,
    foods: foods.rows,
    exercises: exercises.rows,
    weight,
    weight_source: weightSource
  };
}

async function buildTrend(plan, endDate) {
  let startDate = toDateKey(plan.start_date);
  const firstDataDateRes = await query(
    `
      SELECT MIN(log_date)::date AS first_data_date
      FROM (
        SELECT log_date FROM daily_logs WHERE plan_id = $1
        UNION ALL
        SELECT log_date FROM weight_logs WHERE plan_id = $1
      ) t
    `,
    [plan.id]
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
    [plan.id, startDate, endDate]
  );

  return {
    days: rows.map((row) => ({
      date: toDateKey(row.log_date),
      weight: row.weight === null || row.weight === undefined ? null : Number(row.weight),
      intake_kcal: Number(row.intake_kcal ?? 0),
      exercise_kcal: Number(row.exercise_kcal ?? 0),
      deficit: Number(row.deficit ?? 0)
    }))
  };
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const timeZone = normalizeUserTimeZone(auth.user.time_zone);
    const { todayDate } = getTimeContext(timeZone);
    const selectedDateInput = String(event.queryStringParameters?.selected_date ?? todayDate);
    const endDateInput = String(event.queryStringParameters?.end_date ?? todayDate);
    const includePresets = parseIncludePresets(event.queryStringParameters?.include_presets);

    if (!validateDate(selectedDateInput)) {
      return badRequest("selected_date 格式无效");
    }
    if (!validateDate(endDateInput)) {
      return badRequest("end_date 格式无效");
    }

    const payload = {
      profile: {
        user_id: auth.user.user_id,
        account_id: auth.user.account_id,
        nickname: auth.user.nickname,
        time_zone: timeZone
      },
      presets: includePresets
        ? {
            foods: FOOD_PRESETS,
            exercises: EXERCISE_PRESETS
          }
        : null,
      plan: null,
      calendar: null,
      forecast: null,
      dailyLog: null,
      trend: { days: [] }
    };

    const plan = await getActivePlanByUser(auth.user.user_id);
    if (!plan) {
      return ok(payload);
    }

    const [planSummary, calendar, forecast, dailyLog, trend] = await Promise.all([
      buildPlanSummary(plan),
      buildCalendar(plan, selectedDateInput, timeZone),
      buildForecast(plan),
      buildDailyLog(plan, selectedDateInput),
      buildTrend(plan, endDateInput)
    ]);

    return ok({
      ...payload,
      plan: planSummary,
      calendar,
      forecast,
      dailyLog,
      trend
    });
  } catch (error) {
    return serverError(error.message);
  }
}
