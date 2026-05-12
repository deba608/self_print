import fs from "node:fs";
import { getDb } from "../src/lib/db";

const expiryDays = Number(process.env.CLEANUP_EXPIRY_DAYS ?? 7);
const cutoff = new Date(Date.now() - expiryDays * 24 * 60 * 60 * 1000).toISOString();
const rows = getDb().prepare(`
  SELECT jf.storage_path
  FROM job_files jf
  JOIN jobs j ON j.id = jf.job_id
  WHERE j.status IN ('printed', 'cancelled') OR j.created_at < ?
`).all(cutoff) as Array<{ storage_path: string }>;

for (const row of rows) {
  fs.rmSync(row.storage_path, { force: true });
}

getDb().prepare(`
  DELETE FROM jobs
  WHERE status IN ('printed', 'cancelled') OR created_at < ?
`).run(cutoff);

console.log(`Cleaned ${rows.length} stored upload file(s).`);
