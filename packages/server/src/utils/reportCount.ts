import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

/** How many reports wait for a decision. Apart from reports.ts, which the socket layer cannot import. */
export function openReportCount(): number {
  return getDb().select({ n: sql<number>`count(*)` }).from(schema.contentReports)
    .where(eq(schema.contentReports.status, 'open')).get()?.n ?? 0;
}
