import { requireAuth } from "./_lib/auth.js";
import { EXERCISE_PRESETS, FOOD_PRESETS } from "./_lib/presets.js";
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
      foods: FOOD_PRESETS,
      exercises: EXERCISE_PRESETS
    });
  } catch (error) {
    return serverError(error.message);
  }
}
