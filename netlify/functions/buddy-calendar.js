import { requireAuth } from "./_lib/auth.js";
import { getActivePlanByUser } from "./_lib/domain.js";
import {
  buildBuddyMetricItem,
  getFollowedBuddyUsers,
  getStatusByDate,
  getStatusMapByPlan,
  getTimeContext,
  normalizeUserTimeZone
} from "./_lib/buddy.js";
import { parseDateKeyUtc, shiftDateKey, toDateKey, validateDateKey } from "./_lib/date.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

function monthRange(year, month, planStartDate, todayDate) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const today = parseDateKeyUtc(todayDate);
  const cappedLast = today && last.getTime() > today.getTime() ? today : last;
  const planStart = parseDateKeyUtc(planStartDate);
  const start = planStart && planStart.getTime() > first.getTime() ? planStart : first;
  if (!cappedLast || start.getTime() > cappedLast.getTime()) {
    return { start: "", end: "", startDay: 0, endDay: -1, totalDays: 0 };
  }
  return {
    start: toDateKey(start),
    end: toDateKey(cappedLast),
    startDay: start.getUTCDate(),
    endDay: cappedLast.getUTCDate(),
    totalDays: cappedLast.getUTCDate() - start.getUTCDate() + 1
  };
}

function buddySort(a, b) {
  if (b.common_streak !== a.common_streak) return b.common_streak - a.common_streak;
  if (b.week_success_rate !== a.week_success_rate) return b.week_success_rate - a.week_success_rate;
  if ((b.recent_interaction_date || "") !== (a.recent_interaction_date || "")) {
    return String(b.recent_interaction_date || "").localeCompare(String(a.recent_interaction_date || ""));
  }
  return String(a.account_id).localeCompare(String(b.account_id));
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const timeZone = normalizeUserTimeZone(auth.user.time_zone);
    const { todayDate, weekStartDate } = getTimeContext(timeZone);
    const selectedDate = String(event.queryStringParameters?.selected_date ?? todayDate);
    if (!validateDateKey(selectedDate)) {
      return badRequest("selected_date 格式无效");
    }

    const viewerPlan = await getActivePlanByUser(auth.user.user_id);
    if (!viewerPlan) {
      return ok({
        time_zone: timeZone,
        days: [],
        selected_date: {
          date: selectedDate,
          self_status: "gray",
          buddies: []
        }
      });
    }

    const year = Number(event.queryStringParameters?.year ?? selectedDate.slice(0, 4));
    const month = Number(event.queryStringParameters?.month ?? selectedDate.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return badRequest("year/month 参数无效");
    }

    const range = monthRange(year, month, toDateKey(viewerPlan.start_date), todayDate);
    const lookbackStart = shiftDateKey(todayDate, -365);
    const selfStatusMap = await getStatusMapByPlan(viewerPlan.id, lookbackStart, todayDate);
    const followedUsers = await getFollowedBuddyUsers(auth.user.user_id);

    const buddyItems = [];
    const buddyStatusMapByAccount = new Map();
    for (const buddy of followedUsers) {
      const metric = await buildBuddyMetricItem({
        viewerPlanId: viewerPlan.id,
        buddyUserId: Number(buddy.buddy_user_id),
        buddyAccountId: String(buddy.account_id),
        buddyNickname: String(buddy.nickname ?? ""),
        followedAt: buddy.followed_at,
        timeZone,
        selfStatusMap,
        todayDate,
        weekStartDate
      });
      buddyItems.push(metric);
      if (metric.has_active_plan) {
        const buddyPlan = await getActivePlanByUser(Number(buddy.buddy_user_id));
        if (buddyPlan) {
          const statusMap = await getStatusMapByPlan(
            buddyPlan.id,
            range.totalDays > 0 ? range.start : selectedDate,
            range.totalDays > 0 ? range.end : selectedDate
          );
          buddyStatusMapByAccount.set(metric.account_id, statusMap);
        }
      }
    }
    buddyItems.sort(buddySort);

    const days = [];
    for (let day = range.startDay; day <= range.endDay; day += 1) {
      const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const ranked = [];
      for (const buddy of buddyItems.slice(0, 5)) {
        const statusMap = buddyStatusMapByAccount.get(buddy.account_id);
        const status = statusMap ? getStatusByDate(statusMap, dateKey) : "gray";
        ranked.push({ ...buddy, status });
      }
      ranked.sort(buddySort);
      const visible = ranked.slice(0, 3).map((item) => ({
        account_id: item.account_id,
        nickname: item.nickname,
        status: item.status
      }));
      days.push({
        date: dateKey,
        dots: visible,
        more_count: Math.max(0, ranked.length - visible.length)
      });
    }

    const selectedBuddies = buddyItems.map((buddy) => {
      const statusMap = buddyStatusMapByAccount.get(buddy.account_id);
      return {
        account_id: buddy.account_id,
        nickname: buddy.nickname,
        status: statusMap ? getStatusByDate(statusMap, selectedDate) : "gray"
      };
    });

    return ok({
      time_zone: timeZone,
      days,
      selected_date: {
        date: selectedDate,
        self_status: getStatusByDate(selfStatusMap, selectedDate),
        buddies: selectedBuddies
      }
    });
  } catch (error) {
    return serverError(error.message);
  }
}

