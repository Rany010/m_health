import crypto from "node:crypto";

const LOCK_THRESHOLD = 5;
const LOCK_MINUTES = 15;
const SESSION_DAYS = 7;

export function getClientIp(event) {
  const forwardedFor = event.headers?.["x-forwarded-for"] ?? "";
  const first = forwardedFor.split(",")[0]?.trim();
  if (first) {
    return first;
  }
  return event.headers?.["client-ip"] ?? "unknown";
}

export function normalizeAccountId(input) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/\D/g, "").slice(0, 6);
}

export function hashToken(rawToken, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(rawToken)
    .digest("hex");
}

export function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function getSessionExpiryDate() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export function computeLockUntilDate(baseDate = new Date()) {
  return new Date(baseDate.getTime() + LOCK_MINUTES * 60 * 1000);
}

export function isWeakAccountId(accountId) {
  if (!/^\d{6}$/.test(accountId)) {
    return true;
  }
  if (/^(\d)\1{5}$/.test(accountId)) {
    return true;
  }
  const weakSet = new Set(["000000", "123456", "654321", "111111", "999999"]);
  return weakSet.has(accountId);
}

export function canAttemptLogin(lockRow) {
  if (!lockRow?.locked_until) {
    return true;
  }
  return new Date(lockRow.locked_until).getTime() <= Date.now();
}

export function shouldLockAccount(failedCount) {
  return failedCount >= LOCK_THRESHOLD;
}
