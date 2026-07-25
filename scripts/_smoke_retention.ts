process.env.DATABASE_PATH = "C:/Users/Dev/AppData/Local/Temp/claude/C--Users-Dev-Desktop-Selfprint/1e3773d1-aed4-4040-8478-9cdd0f988816/scratchpad/smoke.sqlite";
process.env.UPLOAD_DIR = "C:/Users/Dev/AppData/Local/Temp/claude/C--Users-Dev-Desktop-Selfprint/1e3773d1-aed4-4040-8478-9cdd0f988816/scratchpad/uploads";

import { createJobWithFiles, cleanupOldJobs, getJobById, getJobFilesByJob, ensureDatabase, updateJobStatus } from "../src/lib/db";

async function main() {
  await ensureDatabase();

  const { jobId: jobA } = await createJobWithFiles(
    { token: "111111", printType: "bw", copies: 1, paperSize: "A4", layout: "portrait", pagesPerSheet: 1, margins: "default", scale: "default", duplex: "simplex", pageCount: 1, pricePaise: 100, needsConversion: 0, queuePosition: 1 },
    [{ originalName: "a.pdf", storedName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, fileKind: "pdf", storagePath: "/tmp/a.pdf" }]
  );
  await updateJobStatus(jobA, "printed");

  const { jobId: jobB } = await createJobWithFiles(
    { token: "222222", printType: "bw", copies: 1, paperSize: "A4", layout: "portrait", pagesPerSheet: 1, margins: "default", scale: "default", duplex: "simplex", pageCount: 1, pricePaise: 100, needsConversion: 0, queuePosition: 2 },
    [{ originalName: "b.pdf", storedName: "b.pdf", mimeType: "application/pdf", sizeBytes: 10, fileKind: "pdf", storagePath: "/tmp/b.pdf" }]
  );
  await updateJobStatus(jobB, "printed");

  const { jobId: jobC } = await createJobWithFiles(
    { token: "333333", printType: "bw", copies: 1, paperSize: "A4", layout: "portrait", pagesPerSheet: 1, margins: "default", scale: "default", duplex: "simplex", pageCount: 1, pricePaise: 100, needsConversion: 0, queuePosition: 3 },
    [{ originalName: "c.pdf", storedName: "c.pdf", mimeType: "application/pdf", sizeBytes: 10, fileKind: "pdf", storagePath: "/tmp/c.pdf" }]
  );

  const Database = (await import("better-sqlite3")).default;
  const db = new Database(process.env.DATABASE_PATH!);
  const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE jobs SET created_at = ? WHERE id IN (?, ?)").run(fourDaysAgo, jobA, jobC);
  db.close();

  const result = await cleanupOldJobs();
  console.log("cleanup result:", result);

  const jobAAfter = await getJobById(jobA);
  const filesAAfter = await getJobFilesByJob(jobA);
  console.log("Job A (old, printed) status:", jobAAfter.status, "file storagePath:", JSON.stringify(filesAAfter[0].storagePath), "purgedAt:", filesAAfter[0].purgedAt);

  const jobBAfter = await getJobById(jobB);
  const filesBAfter = await getJobFilesByJob(jobB);
  console.log("Job B (fresh, printed) file storagePath:", JSON.stringify(filesBAfter[0].storagePath), "purgedAt:", filesBAfter[0].purgedAt);

  try {
    await getJobById(jobC);
    console.log("Job C (old, abandoned) still exists -- BUG, should have been deleted");
  } catch {
    console.log("Job C (old, abandoned) correctly deleted");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
