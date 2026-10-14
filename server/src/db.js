import pg from "pg";
import { config } from "./config.js";

const { Pool, types } = pg;

// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Dates,
// which would otherwise shift a day depending on the server's timezone.
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => console.error("[db] idle client error:", err.message));

export const query = (text, params) => pool.query(text, params);

// Runs fn(client) inside a transaction. Rolls back on any thrown error.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
