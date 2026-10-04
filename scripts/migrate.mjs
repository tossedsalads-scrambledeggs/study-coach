// Apply db/schema.sql to the Neon database in DATABASE_URL. Safe to re-run.
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  console.log("tables:", rows.map((r) => r.table_name).join(", "));
} finally {
  await client.end();
}
