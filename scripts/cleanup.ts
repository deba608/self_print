import { cleanupOldJobs } from "../src/lib/db";
import { deleteFile } from "../src/lib/storage";

cleanupOldJobs()
  .then(async ({ deleted, storagePaths }) => {
    await Promise.all(storagePaths.map((p) => deleteFile(p)));
    console.log(`Cleanup done. Removed ${deleted} job(s) and ${storagePaths.length} file(s).`);
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  });
