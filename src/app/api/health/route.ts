import { db } from '@/lib/db';
import { ok, serverError } from '@/lib/http';

export async function GET() {
  try {
    const sql = db();
    await sql`select 1 as ok`;

    return ok({
      service: 'bluerock-ims',
      status: 'online',
      databaseConfigured: true,
      databaseConnected: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}
