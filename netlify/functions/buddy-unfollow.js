import { requireAuth } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
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

    const removed = await query(
      `
        DELETE FROM buddy_follows bf
        USING users u
        WHERE bf.follower_user_id = $1
          AND bf.buddy_user_id = u.id
          AND u.account_id = $2
        RETURNING bf.id
      `,
      [auth.user.user_id, accountId]
    );
    if (removed.rows.length === 0) {
      return badRequest("未找到该搭子关系");
    }
    return ok({ removed: true });
  } catch (error) {
    return serverError(error.message);
  }
}

