import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getActivePlanByUser, getLatestWeight } from "./_lib/domain.js";
import {
  computeCommonStreak,
  computeCurrentStreak,
  computeWeekSuccessRate,
  getStatusByDate,
  getStatusMapByPlan,
  getTimeContext,
  normalizeUserTimeZone
} from "./_lib/buddy.js";
import { shiftDateKey, toDateKey, validateDateKey } from "./_lib/date.js";
import { estimateFinishDate } from "./_lib/forecast.js";
import { badRequest, ok, serverError } from "./_lib/response.js";
import { normalizeAccountId } from "./_lib/security.js";

function clampDateKey(dateKey, minDate, maxDate) {
  if (!validateDateKey(dateKey)) return maxDate;
  if (validateDateKey(minDate) && dateKey < minDate) return minDate;
  if (validateDateKey(maxDate) && dateKey > maxDate) return maxDate;
  return dateKey;
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const buddyAccountId = normalizeAccountId(event.queryStringParameters?.account_id);
    if (!/^\d{6}$/.test(buddyAccountId)) {
      return badRequest("account_id 参数无效");
    }
    const selectedDate = String(event.queryStringParameters?.selected_date ?? "");
    if (selectedDate && !validateDateKey(selectedDate)) {
      return badRequest("selected_date 格式无效");
    }

    const relationRes = await query(
      `
        SELECT u.id, u.account_id, u.nickname
        FROM buddy_follows bf
        INNER JOIN users u ON u.id = bf.buddy_user_id
        WHERE bf.follower_user_id = $1
          AND u.account_id = $2
        LIMIT 1
      `,
      [auth.user.user_id, buddyAccountId]
    );
    if (relationRes.rows.length === 0) {
      return badRequest("你尚未关注该账号");
    }
    const buddyUser = relationRes.rows[0];

    const timeZone = normalizeUserTimeZone(auth.user.time_zone);
    const { todayDate, weekStartDate } = getTimeContext(timeZone);

    const [viewerPlan, buddyPlan] = await Promise.all([
      getActivePlanByUser(auth.user.user_id),
      getActivePlanByUser(Number(buddyUser.id))
    ]);
    if (!viewerPlan || !buddyPlan) {
      return ok({
        buddy: {
          account_id: buddyUser.account_id,
          nickname: buddyUser.nickname ?? ""
        },
        metrics: {
          current_streak: 0,
          week_success_rate: 0,
          common_streak: 0,
          estimated_finish_date: ""
        },
        calendar: {
          start_date: "",
          end_date: "",
          days: []
        },
        selected_date: {
          date: todayDate,
          self_status: "gray",
          buddy_status: "gray"
        }
      });
    }

    const buddyPlanStartDate = toDateKey(buddyPlan.start_date);
    const viewerPlanStartDate = toDateKey(viewerPlan.start_date);
    const dateForView = clampDateKey(selectedDate || todayDate, buddyPlanStartDate, todayDate);
    const lookbackStart = shiftDateKey(todayDate, -365);
    const [selfStatusMap, buddyStatusMap] = await Promise.all([
      getStatusMapByPlan(viewerPlan.id, viewerPlanStartDate || lookbackStart, todayDate),
      getStatusMapByPlan(buddyPlan.id, buddyPlanStartDate || lookbackStart, todayDate)
    ]);

    const calendarDays = [];
    if (validateDateKey(buddyPlanStartDate) && buddyPlanStartDate <= todayDate) {
      for (let cursor = buddyPlanStartDate; cursor <= todayDate; cursor = shiftDateKey(cursor, 1)) {
        calendarDays.push({
          date: cursor,
          status: getStatusByDate(buddyStatusMap, cursor)
        });
      }
    }

    let estimatedFinishDate = "";
    const deficitsRes = await query(
      `
        SELECT deficit
        FROM daily_logs
        WHERE plan_id = $1
        ORDER BY log_date DESC
        LIMIT 14
      `,
      [buddyPlan.id]
    );
    if (deficitsRes.rows.length >= 2) {
      const avg =
        deficitsRes.rows.reduce((sum, row) => sum + Number(row.deficit ?? 0), 0) /
        deficitsRes.rows.length;
      if (avg > 0) {
        const latestWeight = await getLatestWeight(buddyPlan.id, buddyPlan.start_weight);
        estimatedFinishDate = estimateFinishDate({
          latestWeight: Number(latestWeight),
          targetWeight: Number(buddyPlan.target_weight),
          averageDeficit: avg
        }).estimated_date;
      }
    }

    return ok({
      buddy: {
        account_id: buddyUser.account_id,
        nickname: buddyUser.nickname ?? ""
      },
      metrics: {
        current_streak: computeCurrentStreak(buddyStatusMap, todayDate),
        week_success_rate: computeWeekSuccessRate(buddyStatusMap, weekStartDate, todayDate),
        common_streak: computeCommonStreak(selfStatusMap, buddyStatusMap, todayDate),
        estimated_finish_date: estimatedFinishDate
      },
      calendar: {
        start_date: buddyPlanStartDate,
        end_date: todayDate,
        days: calendarDays
      },
      selected_date: {
        date: dateForView,
        self_status: getStatusByDate(selfStatusMap, dateForView),
        buddy_status: getStatusByDate(buddyStatusMap, dateForView)
      }
    });
  } catch (error) {
    return serverError(error.message);
  }
}

