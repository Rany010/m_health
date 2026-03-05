import bcrypt from "bcryptjs";
import { query } from "./db.js";
import { unauthorized } from "./response.js";
import {
  generateSessionToken,
  getSessionExpiryDate,
  hashToken
} from "./security.js";

function getAuthToken(event) {
  const authHeader = event.headers?.authorization ?? "";
  const [prefix, token] = authHeader.split(" ");
  if (prefix !== "Bearer" || !token) {
    return "";
  }
  return token;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken, secret);
  const expiresAt = getSessionExpiryDate();
  await query(
    `
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [userId, tokenHash, expiresAt]
  );
  return {
    token: rawToken,
    expires_at: expiresAt.toISOString()
  };
}

export async function revokeSession(rawToken) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !rawToken) {
    return;
  }
  const tokenHash = hashToken(rawToken, secret);
  await query(
    `
      UPDATE sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
    `,
    [tokenHash]
  );
}

export async function requireAuth(event) {
  const rawToken = getAuthToken(event);
  if (!rawToken) {
    return { error: unauthorized("登录状态失效，请重新登录") };
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }
  const tokenHash = hashToken(rawToken, secret);
  const { rows } = await query(
    `
      SELECT s.user_id, u.account_id, u.nickname, u.time_zone
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );
  if (rows.length === 0) {
    return { error: unauthorized("登录状态失效，请重新登录") };
  }
  return { user: rows[0], rawToken };
}
