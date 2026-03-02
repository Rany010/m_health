import { requireAuth } from "./_lib/auth.js";
import { ok, serverError } from "./_lib/response.js";

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return ok({});
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) {
      return auth.error;
    }
    return ok({
      user_id: auth.user.user_id,
      account_id: auth.user.account_id,
      nickname: auth.user.nickname
    });
  } catch (error) {
    return serverError(error.message);
  }
}
