import { requireAuth } from "./_lib/auth.js";
import { markBuddyCheersRead } from "./_lib/cheer.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, ok, serverError } from "./_lib/response.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return badRequest("不支持的请求方法");
  }
  try {
    const auth = await requireAuth(event);
    if (auth.error) return auth.error;

    const body = parseJsonBody(event) ?? {};
    const inbox = await markBuddyCheersRead(auth.user.user_id, body.ids ?? []);
    return ok({ buddy_cheers: inbox });
  } catch (error) {
    return serverError(error.message);
  }
}
