import path from "node:path";
import { getJobsNeedingConversion, getJobFile, getPricing, markJobConverted } from "../src/lib/db";
import { readFileBytes, saveBuffer, deleteFile } from "../src/lib/storage";
import { convertDocToPdf, isLibreOfficeAvailable } from "../src/lib/convert";
import { estimatePageCount } from "../src/lib/files";
import { calculatePrice } from "../src/lib/pricing";

async function main() {
  if (!(await isLibreOfficeAvailable())) {
    console.error("LibreOffice not found. Install it or set LIBREOFFICE_PATH to soffice(.exe).");
    process.exit(1);
  }

  const jobs = await getJobsNeedingConversion();
  if (jobs.length === 0) {
    console.log("No documents pending conversion.");
    return;
  }

  const pricing = await getPricing();
  let converted = 0;

  for (const job of jobs) {
    try {
      const file = await getJobFile(job.id);
      const ext = path.extname(file.originalName).toLowerCase() || ".docx";
      const oldPath = file.storagePath;

      const inputBytes = await readFileBytes(oldPath);
      const pdf = await convertDocToPdf(inputBytes, ext);
      const saved = await saveBuffer(pdf, ".pdf", "document", "application/pdf");
      const pageCount = estimatePageCount("pdf", pdf);
      const pricePaise = calculatePrice({
        printType: job.printType,
        copies: job.copies,
        pageRange: job.pageRange,
        paperSize: job.paperSize,
        pageCount,
        pricing
      });

      await markJobConverted(job.id, file.id, {
        storedName: saved.storedName,
        storagePath: saved.storagePath,
        sizeBytes: saved.sizeBytes,
        pageCount,
        pricePaise
      });
      await deleteFile(oldPath); // remove the original DOC/DOCX

      converted += 1;
      console.log(`Converted ${file.originalName} (token ${job.token}) -> ${pageCount} page(s).`);
    } catch (error) {
      console.error(`Failed job ${job.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`Done. Converted ${converted}/${jobs.length}.`);
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
