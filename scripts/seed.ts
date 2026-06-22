import { ensureDatabase } from "../src/lib/db";

ensureDatabase()
  .then(() => {
    console.log("Database initialized and seeded.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
