import { Pool } from "pg";

let pool = null;

function createPoolFromEnv() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 10_000,
    ssl:
      databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false }
  });
}

function getPool() {
  if (!pool) {
    pool = createPoolFromEnv();
  }
  return pool;
}

let schemaReadyPromise = null;

async function runSchemaMigrations() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        account_id CHAR(6) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nickname VARCHAR(24),
        sex VARCHAR(10),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_locks (
        account_id CHAR(6) PRIMARY KEY,
        failed_count INT NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        id BIGSERIAL PRIMARY KEY,
        scope_key VARCHAR(160) UNIQUE NOT NULL,
        window_start TIMESTAMPTZ NOT NULL,
        hit_count INT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        account_id CHAR(6),
        event_type VARCHAR(64) NOT NULL,
        ip_address VARCHAR(64),
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_weight NUMERIC(6,2) NOT NULL,
        target_weight NUMERIC(6,2) NOT NULL,
        daily_kcal_target INT NOT NULL,
        daily_deficit_target INT NOT NULL,
        tdee INT NOT NULL,
        activity_factor NUMERIC(4,2) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        id BIGSERIAL PRIMARY KEY,
        plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        log_date DATE NOT NULL,
        intake_kcal INT NOT NULL DEFAULT 0,
        exercise_kcal INT NOT NULL DEFAULT 0,
        deficit INT NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(plan_id, log_date)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id BIGSERIAL PRIMARY KEY,
        plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        log_date DATE NOT NULL,
        weight NUMERIC(6,2) NOT NULL,
        record_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS food_items (
        id BIGSERIAL PRIMARY KEY,
        daily_log_id BIGINT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
        meal_type VARCHAR(20) NOT NULL DEFAULT 'breakfast',
        food_name VARCHAR(80) NOT NULL,
        portion VARCHAR(20) NOT NULL,
        weight_g INT,
        kcal INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE food_items
      ADD COLUMN IF NOT EXISTS meal_type VARCHAR(20) NOT NULL DEFAULT 'breakfast';
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS exercise_items (
        id BIGSERIAL PRIMARY KEY,
        daily_log_id BIGINT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
        exercise_type VARCHAR(80) NOT NULL,
        duration_min INT NOT NULL,
        kcal INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_plans_user_status ON plans (user_id, status);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_plan_date ON daily_logs (plan_id, log_date);
      CREATE INDEX IF NOT EXISTS idx_weight_logs_plan_date ON weight_logs (plan_id, log_date);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_expire ON sessions (user_id, expires_at);
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchemaReady() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = runSchemaMigrations();
  }
  return schemaReadyPromise;
}

export async function query(text, values = []) {
  await ensureSchemaReady();
  return getPool().query(text, values);
}

export async function transaction(callback) {
  await ensureSchemaReady();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
