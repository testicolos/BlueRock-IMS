import postgres from 'postgres';

let client: ReturnType<typeof postgres> | undefined;
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  if (!client) {
    const local = ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
    client = postgres(url, {
      // Only loopback development/test databases may run without TLS.
      ssl: local ? false : 'require', max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10,
    });
  }
  return client;
}
