import { query } from "./db.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 30;

function windowStart(now = Date.now()) {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
}

export async function consumeRateLimit(scopeKey) {
  const now = new Date();
  const winStart = windowStart(now.getTime());

  const { rows } = await query(
    `
      INSERT INTO rate_limit_counters (scope_key, window_start, hit_count, updated_at)
      VALUES ($1, $2, 1, NOW())
      ON CONFLICT (scope_key)
      DO UPDATE SET
        hit_count = CASE
          WHEN rate_limit_counters.window_start = EXCLUDED.window_start
          THEN rate_limit_counters.hit_count + 1
          ELSE 1
        END,
        window_start = EXCLUDED.window_start,
        updated_at = NOW()
      RETURNING hit_count, window_start
    `,
    [scopeKey, winStart.toISOString()]
  );
  const hitCount = Number(rows[0]?.hit_count ?? 0);
  const limited = hitCount > MAX_HITS;
  const retryAt = new Date(new Date(rows[0].window_start).getTime() + WINDOW_MS);
  return {
    limited,
    hit_count: hitCount,
    retry_after_seconds: Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))
  };
}
