import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  if (!client) {
    const local = ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
    const configuredMax = Number(process.env.DB_POOL_MAX || '4');
    const max = Number.isFinite(configuredMax) ? Math.min(8, Math.max(1, Math.trunc(configuredMax))) : 4;
    client = postgres(url, {
      // Only loopback development/test databases may run without TLS.
      // Fluid/serverless instances can handle concurrent requests; a single
      // connection made unrelated reads queue behind one slow request.
      ssl: local ? false : 'require', max, prepare: false, idle_timeout: 15, connect_timeout: 5,
    });
  }
  return client;
}
