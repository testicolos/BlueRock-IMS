import { ok } from '@/lib/http';

export async function GET() {
  return ok({
    service: 'bluerock-ims',
    status: 'online',
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    timestamp: new Date().toISOString(),
  });
}
