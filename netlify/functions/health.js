import { ok, serverError } from "./_lib/response.js";
import { ensureSchemaReady } from "./_lib/db.js";

export async function handler() {
  try {
    await ensureSchemaReady();
    return ok({
      status: "ok",
      service: "mhealth-api"
    });
  } catch (error) {
    return serverError(error.message);
  }
}
