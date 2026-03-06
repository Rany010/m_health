import { query } from "./db.js";
import { getActivePlanByUser } from "./domain.js";
import {
  enumerateDateKeys,
  getTodayDateKeyByTimeZone,
  getWeekStartDateKey,
  shiftDateKey,
  toDateKey,
  validateDateKey
} from "./date.js";

export const MAX_BUDDIES = 5;

export function normalizeUserTimeZone(rawValue) {
  const tz = String(rawValue ?? "").trim();
  if (!tz) return "Asia/Shanghai";
  return tz;
}

export function getTimeContext(timeZone) {
  const todayDate = getTodayDateKeyByTimeZone(normalizeUserTimeZone(timeZone));
  return {
    todayDate,
    weekStartDate: getWeekStartDateKey(todayDate)
  };
}

export async function getStatusMapByPlan(planId, startDate, endDate) {
  if (!Number.isInteger(Number(planId))) {
    return new Map();
  }
  if (!validateDateKey(startDate) || !validateDateKey(endDate) || startDate > endDate) {
    return new Map();
  }
  const { rows } = await query(
    `
      SELECT log_date, status
      FROM daily_logs
      WHERE plan_id = $1
        AND log_date BETWEEN $2 AND $3
      ORDER BY log_date ASC
    `,
    [planId, startDate, endDate]
  );
  const map = new Map();
  for (const row of rows) {
    map.set(toDateKey(row.log_date), String(row.status ?? "gray"));
  }
  return map;
}

export function getStatusByDate(statusMap, dateKey) {
  if (!(statusMap instanceof Map)) return "gray";
  return statusMap.get(dateKey) ?? "gray";
}

export function computeCurrentStreak(statusMap, todayDate) {
  if (!(statusMap instanceof Map) || !validateDateKey(todayDate)) return 0;
  let streak = 0;
  let cursor = todayDate;
  for (let i = 0; i < 366; i += 1) {
    if (getStatusByDate(statusMap, cursor) !== "green") {
      break;
    }
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export function computeWeekSuccessRate(statusMap, weekStartDate, todayDate) {
  if (!validateDateKey(weekStartDate) || !validateDateKey(todayDate) || weekStartDate > todayDate) {
    return 0;
  }
  const dates = enumerateDateKeys(weekStartDate, todayDate);
  if (dates.length === 0) return 0;
  let greenDays = 0;
  for (const dateKey of dates) {
    if (getStatusByDate(statusMap, dateKey) === "green") {
      greenDays += 1;
    }
  }
  return Math.round((greenDays / dates.length) * 100);
}

export function computeCommonStreak(selfStatusMap, buddyStatusMap, todayDate) {
  if (!validateDateKey(todayDate)) return 0;
  let streak = 0;
  let cursor = todayDate;
  for (let i = 0; i < 366; i += 1) {
    const selfStatus = getStatusByDate(selfStatusMap, cursor);
    const buddyStatus = getStatusByDate(buddyStatusMap, cursor);
    if (selfStatus !== "green" || buddyStatus !== "green") {
      break;
    }
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export async function getRecentInteractionDate(viewerPlanId, buddyPlanId) {
  if (!Number.isInteger(Number(viewerPlanId)) || !Number.isInteger(Number(buddyPlanId))) {
    return "";
  }
  const { rows } = await query(
    `
      SELECT MAX(v.log_date)::date AS recent_date
      FROM daily_logs v
      INNER JOIN daily_logs b ON b.log_date = v.log_date
      WHERE v.plan_id = $1
        AND b.plan_id = $2
    `,
    [viewerPlanId, buddyPlanId]
  );
  return String(rows[0]?.recent_date ?? "").slice(0, 10);
}

export async function getFollowedBuddyUsers(userId) {
  const { rows } = await query(
    `
      SELECT
        bf.buddy_user_id,
        bf.created_at AS followed_at,
        u.account_id,
        u.nickname
      FROM buddy_follows bf
      INNER JOIN users u ON u.id = bf.buddy_user_id
      WHERE bf.follower_user_id = $1
      ORDER BY bf.created_at ASC
    `,
    [userId]
  );
  return rows;
}

export async function buildBuddyMetricItem({
  viewerPlanId,
  buddyUserId,
  buddyAccountId,
  buddyNickname,
  followedAt,
  timeZone,
  selfStatusMap,
  todayDate,
  weekStartDate
}) {
  const buddyPlan = await getActivePlanByUser(buddyUserId);
  const lookbackStart = shiftDateKey(todayDate, -365);
  const fallback = {
    account_id: buddyAccountId,
    nickname: buddyNickname,
    followed_at: followedAt,
    status_today: "gray",
    current_streak: 0,
    week_success_rate: 0,
    common_streak: 0,
    recent_interaction_date: "",
    estimated_finish_date: "",
    has_active_plan: false,
    time_zone: normalizeUserTimeZone(timeZone)
  };
  if (!buddyPlan) {
    return fallback;
  }

  const buddyStatusMap = await getStatusMapByPlan(buddyPlan.id, lookbackStart, todayDate);
  const [recentInteractionDate] = await Promise.all([
    getRecentInteractionDate(viewerPlanId, buddyPlan.id)
  ]);

  return {
    ...fallback,
    status_today: getStatusByDate(buddyStatusMap, todayDate),
    current_streak: computeCurrentStreak(buddyStatusMap, todayDate),
    week_success_rate: computeWeekSuccessRate(buddyStatusMap, weekStartDate, todayDate),
    common_streak: computeCommonStreak(selfStatusMap, buddyStatusMap, todayDate),
    recent_interaction_date: recentInteractionDate,
    has_active_plan: true
  };
}

