import { createSession, verifyPassword } from "./_lib/auth.js";
import { query } from "./_lib/db.js";
import { parseJsonBody } from "./_lib/request.js";
import {
  badRequest,
  ok,
  serverError,
  tooManyRequests,
  unauthorized
} from "./_lib/response.js";
import {
  canAttemptLogin,
  computeLockUntilDate,
  getClientIp,
  normalizeAccountId,
  shouldLockAccount
} from "./_lib/security.js";
import { consumeRateLimit } from "./_lib/rate-limit.js";

function commonAuthError() {
  return unauthorized("账号或密码错误");
}

async function recordAuthLog(accountId, eventType, ip, metadata = {}) {
  await query(
    `
      INSERT INTO audit_logs (account_id, event_type, ip_address, metadata)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [accountId, eventType, ip, JSON.stringify(metadata)]
  );
}

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
    if (!/^\d{6}$/.test(accountId) || password.length < 8) {
      return commonAuthError();
    }

    const ipRate = await consumeRateLimit(`login-ip:${ip}`);
    const accountRate = await consumeRateLimit(`login-account:${accountId}`);
    if (ipRate.limited || accountRate.limited) {
      return tooManyRequests("请求过于频繁，请稍后再试");
    }

    const lockResult = await query(
      `
        SELECT failed_count, locked_until
        FROM auth_locks
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );
    const lockRow = lockResult.rows[0];
    if (lockRow && !canAttemptLogin(lockRow)) {
      await recordAuthLog(accountId, "auth_login_blocked_locked", ip);
      return tooManyRequests("账号已临时锁定，请稍后再试");
    }

    const userResult = await query(
      `
        SELECT id, account_id, password_hash, nickname
        FROM users
        WHERE account_id = $1
        LIMIT 1
      `,
      [accountId]
    );
    if (userResult.rows.length === 0) {
      await recordAuthLog(accountId, "auth_login_failed", ip, { reason: "invalid" });
      return commonAuthError();
    }

    const user = userResult.rows[0];
    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      const newFailed = Number(lockRow?.failed_count ?? 0) + 1;
      const shouldLock = shouldLockAccount(newFailed);
      await query(
        `
          INSERT INTO auth_locks (account_id, failed_count, locked_until, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (account_id)
          DO UPDATE SET
            failed_count = $2,
            locked_until = $3,
            updated_at = NOW()
        `,
        [accountId, newFailed, shouldLock ? computeLockUntilDate().toISOString() : null]
      );
      await recordAuthLog(accountId, "auth_login_failed", ip, {
        reason: "invalid",
        failed_count: newFailed,
        locked: shouldLock
      });
      return commonAuthError();
    }

    await query(
      `
        INSERT INTO auth_locks (account_id, failed_count, locked_until, updated_at)
        VALUES ($1, 0, NULL, NOW())
        ON CONFLICT (account_id)
        DO UPDATE SET
          failed_count = 0,
          locked_until = NULL,
          updated_at = NOW()
      `,
      [accountId]
    );

    const session = await createSession(user.id);
    await recordAuthLog(accountId, "auth_login_success", ip);
    return ok({
      token: session.token,
      expires_at: session.expires_at,
      account_id: user.account_id,
      nickname: user.nickname
    });
  } catch (error) {
    return serverError(error.message);
  }
}
