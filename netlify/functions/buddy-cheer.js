import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { getTodayDateKeyByTimeZone } from "./_lib/date.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, ok, serverError } from "./_lib/response.js";
import { normalizeAccountId } from "./_lib/security.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;
    const body = parseJsonBody(event);
    if (!body) return badRequest("请求体不是合法 JSON");

    const accountId = normalizeAccountId(body.account_id);
    if (!/^\d{6}$/.test(accountId)) {
      return badRequest("账号必须是6位数字");
    }

    const relation = await query(
      `
        SELECT u.id, u.account_id
        FROM buddy_follows bf
        INNER JOIN users u ON u.id = bf.buddy_user_id
        WHERE bf.follower_user_id = $1
          AND u.account_id = $2
        LIMIT 1
      `,
      [auth.user.user_id, accountId]
    );
    if (relation.rows.length === 0) {
      return badRequest("你尚未关注该账号");
    }

    const buddyUser = relation.rows[0];
    const cheerDate = getTodayDateKeyByTimeZone(auth.user.time_zone || "Asia/Shanghai");

    await Promise.all([
      query(
        `
          INSERT INTO buddy_cheers (sender_user_id, receiver_user_id, cheer_date, created_at, updated_at, read_at)
          VALUES ($1, $2, $3, NOW(), NOW(), NULL)
          ON CONFLICT (sender_user_id, receiver_user_id, cheer_date)
          DO UPDATE SET
            read_at = NULL,
            created_at = NOW(),
            updated_at = NOW()
        `,
        [auth.user.user_id, Number(buddyUser.id), cheerDate]
      ),
      query(
        `
          INSERT INTO audit_logs (account_id, event_type, metadata)
          VALUES ($1, 'buddy_cheer', $2::jsonb)
        `,
        [String(auth.user.account_id), JSON.stringify({ buddy_account_id: accountId, cheer_date: cheerDate })]
      )
    ]);

    return ok({ message: "已送出加油", cheer_date: cheerDate });
  } catch (error) {
    return serverError(error.message);
  }
}
