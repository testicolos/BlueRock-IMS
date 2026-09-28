import { createHash, timingSafeEqual } from "node:crypto";
import postgres from "postgres";

async function query(text: string, params: unknown[] = []) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured");
  const client = postgres(url, { max: 1, prepare: false });
  try { return await client.unsafe(text, params); } finally { await client.end({ timeout: 1 }); }
}
export const dynamic = "force-dynamic";
const EXPECTED_HASH = "3e8eaf98bcde0052636a2b4203da70e46f8e30037a000186d1e2068e63690e8d";

function authorized(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const actual = Buffer.from(createHash("sha256").update(key).digest("hex"));
  const expected = Buffer.from(EXPECTED_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function safeTable(value: string) {
  return /^[a-z_][a-z0-9_]*$/i.test(value) ? value : null;
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || !authorized(request)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "tables";
  if (mode === "tables") {
    const tables = await query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
    return Response.json({ tables }, { headers: { "Cache-Control": "no-store" } });
  }
  const table = safeTable(url.searchParams.get("table") ?? "");
  if (!table) return Response.json({ error: "Invalid table" }, { status: 400 });
  const exists = await query("select exists(select 1 from information_schema.tables where table_schema='public' and table_name=$1) as ok", [table]);
  if (!exists?.[0]?.ok) return Response.json({ error: "Unknown table" }, { status: 404 });
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const total = await query(`select count(*)::int as count from public."${table}"`);
  const rows = await query(`select * from public."${table}" order by ctid offset $1 limit $2`, [offset, limit]);
  return Response.json({ table, total: total?.[0]?.count ?? 0, offset, limit, rows }, { headers: { "Cache-Control": "no-store" } });
}
