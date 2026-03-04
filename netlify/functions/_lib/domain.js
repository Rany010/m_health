import { query } from "./db.js";

export async function getActivePlanByUser(userId) {
  const { rows } = await query(
    `
      SELECT *
      FROM plans
      WHERE user_id = $1 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getPlanByIdAndUser(planId, userId) {
  const { rows } = await query(
    `
      SELECT *
      FROM plans
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `,
    [planId, userId]
  );
  return rows[0] ?? null;
}

export async function getLatestWeight(planId, fallbackWeight) {
  const { rows } = await query(
    `
      SELECT weight
      FROM weight_logs
      WHERE plan_id = $1
      ORDER BY log_date DESC, record_time DESC, id DESC
      LIMIT 1
    `,
    [planId]
  );
  if (rows.length === 0) {
    return Number(fallbackWeight);
  }
  return Number(rows[0].weight);
}
