import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

// Force SQLite backend + isolated DB file BEFORE importing db.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.DATABASE_PATH = "./data-test-schema-parity.sqlite";

try { rmSync("./data-test-schema-parity.sqlite", { force: true }); } catch {}

// SQLite self-migrates at boot (ensureJobColumns / ensurePricingColumns in
// db.ts); Postgres only ever has what supabase/migrations/*.sql declares. That
// asymmetry lets a column be added for local dev and silently never reach
// production — which is how `has_bond_paper` shipped missing and turned every
// upload into a bare "Upload failed" (PGRST204: column not found).
//
// A SQLite column is considered present on Postgres if it is either part of the
// pre-migrations baseline schema below, or named in some migration file.
// Anything else fails here instead of in production.
const GUARDED_TABLES = ["jobs", "pricing_config"] as const;

// Snapshot of the tables as they were created before this migrations directory
// existed, so the check doesn't flag columns that have simply always been
// there. Only ever shrink this list — new columns belong in a migration.
const BASELINE: Record<string, string[]> = {
  jobs: [
    "id", "token", "status", "print_type", "copies", "page_range", "paper_size",
    "layout", "pages_per_sheet", "margins", "scale", "duplex", "page_count",
    "price_paise", "needs_conversion", "queue_position", "created_at",
    "updated_at", "paid_at", "paid_via", "printed_at", "issue_reported_at",
    "issue_note", "issue_resolved_at", "delivery_method", "customer_name",
    "customer_phone", "delivery_address", "delivery_fee_paise",
    "delivery_status", "delivery_latitude", "delivery_longitude",
    "delivery_accuracy_meters", "delivery_location_captured_at",
    "customer_user_id", "delivery_person_id", "delivery_pincode", "delivery_area",
  ],
  pricing_config: [
    "id", "bw_per_page_paise", "color_per_page_paise", "photo_print_paise",
    "copy_multiplier", "a3_multiplier", "a4_multiplier", "a5_multiplier",
    "a6_multiplier", "b5_multiplier", "legal_multiplier", "photo_multiplier",
    "duplex_bw_per_page_paise", "expiry_minutes", "delivery_fee_paise",
    "service_area_config", "updated_at",
  ],
};

function migrationsSql(): string {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .toLowerCase();
}

describe("SQLite <-> Postgres schema parity", () => {
  let sql: string;

  beforeAll(async () => {
    const db = await import("./db");
    await db.ensureDatabase();
    sql = migrationsSql();
  });

  for (const table of GUARDED_TABLES) {
    it(`every SQLite column on "${table}" reaches Postgres`, () => {
      const raw = new Database("./data-test-schema-parity.sqlite", { readonly: true });
      const columns = (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((c) => c.name.toLowerCase());
      raw.close();

      expect(columns.length).toBeGreaterThan(0);

      const baseline = new Set(BASELINE[table] ?? []);
      const missing = columns.filter(
        (name) => !baseline.has(name) && !new RegExp(`\\b${name}\\b`).test(sql)
      );

      expect(
        missing,
        `Columns on "${table}" exist in SQLite but are neither in the baseline ` +
          `Postgres schema nor named in any supabase/migrations/*.sql file. ` +
          `Add a migration for: ${missing.join(", ")}`
      ).toEqual([]);
    });
  }
});
