import { revokeSession } from "./_lib/auth.js";
import { ok } from "./_lib/response.js";

function getAuthToken(event) {
  const authHeader = event.headers?.authorization ?? "";
  const [prefix, token] = authHeader.split(" ");
  if (prefix !== "Bearer") {
    return "";
  }
  return token || "";
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return ok({ success: true });
  }

  const token = getAuthToken(event);
  if (token) {
    await revokeSession(token);
  }
  return ok({ success: true });
}
