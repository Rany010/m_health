import { requireAuth } from "./_lib/auth.js";
import { query, transaction } from "./_lib/db.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, created, serverError } from "./_lib/response.js";
import { normalizeAccountId } from "./_lib/security.js";
import { MAX_BUDDIES } from "./_lib/buddy.js";

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

    if (accountId === String(auth.user.account_id)) {
      return badRequest("不能关注自己");
    }

    const buddyResult = await query(
      `
        SELECT id, account_id, nickname
        FROM users
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );
    if (buddyResult.rows.length === 0) {
      return badRequest("账号不存在");
    }
    const buddyUser = buddyResult.rows[0];

    await transaction(async (client) => {
      const countRes = await client.query(
        `
          SELECT COUNT(*)::int AS total
          FROM buddy_follows
          WHERE follower_user_id = $1
        `,
        [auth.user.user_id]
      );
      const total = Number(countRes.rows[0]?.total ?? 0);
      if (total >= MAX_BUDDIES) {
        throw new Error(`最多只能关注 ${MAX_BUDDIES} 个搭子`);
      }

      const inserted = await client.query(
        `
          INSERT INTO buddy_follows (follower_user_id, buddy_user_id)
          VALUES ($1, $2)
          ON CONFLICT (follower_user_id, buddy_user_id) DO NOTHING
          RETURNING id
        `,
        [auth.user.user_id, buddyUser.id]
      );
      if (inserted.rows.length === 0) {
        throw new Error("你已关注该账号，无需重复添加");
      }
    });

    return created({
      buddy: {
        account_id: buddyUser.account_id,
        nickname: buddyUser.nickname ?? ""
      }
    });
  } catch (error) {
    if (
      String(error?.message ?? "").includes("最多只能关注") ||
      String(error?.message ?? "").includes("已关注")
    ) {
      return badRequest(error.message);
    }
    return serverError(error.message);
  }
}

