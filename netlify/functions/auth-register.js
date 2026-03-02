import { createSession, hashPassword } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { parseJsonBody } from "./_lib/request.js";
import {
  badRequest,
  created,
  serverError,
  tooManyRequests
} from "./_lib/response.js";
import {
  getClientIp,
  isWeakAccountId,
  normalizeAccountId
} from "./_lib/security.js";
import { consumeRateLimit } from "./_lib/rate-limit.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return badRequest("不支持的请求方法");
  }

  try {
    const ip = getClientIp(event);
    const parsed = parseJsonBody(event);
    if (!parsed) {
      return badRequest("请求体不是合法 JSON");
    }

    const accountId = normalizeAccountId(parsed.account_id);
    const password = String(parsed.password ?? "");
    const nickname = String(parsed.nickname ?? "").trim().slice(0, 24);

    if (!/^\d{6}$/.test(accountId)) {
      return badRequest("账号必须是6位数字");
    }
    if (isWeakAccountId(accountId)) {
      return badRequest("该账号不可用，请更换其他6位数字");
    }
    if (password.length < 8) {
      return badRequest("密码至少8位");
    }

    const rate = await consumeRateLimit(`register:${ip}`);
    if (rate.limited) {
      return tooManyRequests("请求过于频繁，请稍后再试");
    }

    const existing = await query(
      `SELECT id FROM users WHERE account_id = $1 LIMIT 1`,
      [accountId]
    );
    if (existing.rows.length > 0) {
      return badRequest("该账号已被占用");
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
      `
        INSERT INTO users (account_id, password_hash, nickname)
        VALUES ($1, $2, $3)
        RETURNING id, account_id, nickname
      `,
      [accountId, passwordHash, nickname || null]
    );
    const user = result.rows[0];
    const session = await createSession(user.id);
    await query(
      `
        INSERT INTO audit_logs (account_id, event_type, ip_address, metadata)
        VALUES ($1, 'auth_register', $2, $3::jsonb)
      `,
      [accountId, ip, JSON.stringify({ nickname: user.nickname ?? null })]
    );

    return created({
      token: session.token,
      expires_at: session.expires_at,
      account_id: user.account_id,
      nickname: user.nickname
    });
  } catch (error) {
    return serverError(error.message);
  }
}
