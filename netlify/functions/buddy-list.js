import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getActivePlanByUser, getLatestWeight } from "./_lib/domain.js";
import {
  buildBuddyMetricItem,
  getFollowedBuddyUsers,
  getStatusMapByPlan,
  getTimeContext,
  normalizeUserTimeZone
} from "./_lib/buddy.js";
import { estimateFinishDate } from "./_lib/forecast.js";
import { shiftDateKey } from "./_lib/date.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

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
    const [viewerPlan, followedUsers] = await Promise.all([
      getActivePlanByUser(auth.user.user_id),
      getFollowedBuddyUsers(auth.user.user_id)
    ]);
    if (!viewerPlan) {
      return ok({
        time_zone: timeZone,
        today_date: todayDate,
        buddies: followedUsers.map((item) => ({
          account_id: item.account_id,
          nickname: item.nickname ?? "",
          followed_at: item.followed_at,
          status_today: "gray",
          current_streak: 0,
          week_success_rate: 0,
          common_streak: 0,
          recent_interaction_date: "",
          estimated_finish_date: "",
          has_active_plan: false,
          reminder_today_unlogged: false
        }))
      });
    }

    const selfStatusMap = await getStatusMapByPlan(
      viewerPlan.id,
      shiftDateKey(todayDate, -365),
      todayDate
    );

    const buddyItems = [];
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

      let estimatedFinishDate = "";
      if (metric.has_active_plan) {
        const buddyPlan = await getActivePlanByUser(Number(buddy.buddy_user_id));
        if (buddyPlan) {
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
              const estimate = estimateFinishDate({
                latestWeight: Number(latestWeight),
                targetWeight: Number(buddyPlan.target_weight),
                averageDeficit: avg
              });
              estimatedFinishDate = estimate.estimated_date;
            }
          }
        }
      }

      buddyItems.push({
        ...metric,
        estimated_finish_date: estimatedFinishDate,
        reminder_today_unlogged: metric.status_today === "gray"
      });
    }

    buddyItems.sort(buddySort);

    return ok({
      time_zone: timeZone,
      today_date: todayDate,
      week_start_date: weekStartDate,
      buddies: buddyItems
    });
  } catch (error) {
    return serverError(error.message);
  }
}
