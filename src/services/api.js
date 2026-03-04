import { recordApiMetric } from "./perf";

const API_BASE = "/api";
const TOKEN_KEY = "mhealth_token";

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const method = String(options.method ?? "GET").toUpperCase();
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {})
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response = null;
  let payload = null;
  let requestError = null;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });

    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      const message = payload?.error ?? "请求失败";
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    requestError = error;
    throw error;
  } finally {
    const endedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    recordApiMetric({
      method,
      path,
      duration_ms: endedAt - startedAt,
      status: response?.status ?? 0,
      ok: Boolean(response?.ok) && !requestError,
      error: requestError?.message ?? "",
      at: new Date().toISOString()
    });
  }
}
