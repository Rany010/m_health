import { query } from "./db.js";

function toDateKey(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const matched = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : "";
}

export async function listBuddyCheers(receiverUserId, { limit = 5 } = {}) {
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 5));
  const [itemsRes, unreadRes] = await Promise.all([
    query(
      `
        SELECT
          bc.id,
          bc.cheer_date,
          bc.created_at,
          bc.read_at,
          sender.account_id AS sender_account_id,
          sender.nickname AS sender_nickname
        FROM buddy_cheers bc
        INNER JOIN users sender ON sender.id = bc.sender_user_id
        WHERE bc.receiver_user_id = $1
        ORDER BY bc.created_at DESC
        LIMIT $2
      `,
      [receiverUserId, safeLimit]
    ),
    query(
      `
        SELECT COUNT(*)::int AS unread_count
        FROM buddy_cheers
        WHERE receiver_user_id = $1
          AND read_at IS NULL
      `,
      [receiverUserId]
    )
  ]);

  return {
    unread_count: Number(unreadRes.rows[0]?.unread_count ?? 0),
    items: itemsRes.rows.map((row) => ({
      id: Number(row.id),
      cheer_date: toDateKey(row.cheer_date),
      created_at: row.created_at,
      read_at: row.read_at,
      sender_account_id: String(row.sender_account_id ?? ""),
      sender_nickname: String(row.sender_nickname ?? "")
    }))
  };
}

export async function markBuddyCheersRead(receiverUserId, ids = []) {
  const cleanIds = Array.isArray(ids)
    ? ids
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    : [];

  if (cleanIds.length > 0) {
    await query(
      `
        UPDATE buddy_cheers
        SET read_at = NOW(), updated_at = NOW()
        WHERE receiver_user_id = $1
          AND id = ANY($2::bigint[])
          AND read_at IS NULL
      `,
      [receiverUserId, cleanIds]
    );
  } else {
    await query(
      `
        UPDATE buddy_cheers
        SET read_at = NOW(), updated_at = NOW()
        WHERE receiver_user_id = $1
          AND read_at IS NULL
      `,
      [receiverUserId]
    );
  }

  return listBuddyCheers(receiverUserId);
}
