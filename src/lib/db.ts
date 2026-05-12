import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, DEFAULT_AGENT_TOKEN } from "./config";
import { hashSecret } from "./security";
import type { Job, JobFile, PricingConfig, PrinterOption, SseClient } from "./types";

let db: Database.Database | null = null;

export const sseClients = new Set<SseClient>();

export function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    seedDefaults(db);
  }
  return db;
}

function initSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      print_type TEXT NOT NULL,
      copies INTEGER NOT NULL,
      page_range TEXT,
      paper_size TEXT NOT NULL,
      layout TEXT NOT NULL DEFAULT 'portrait',
      pages_per_sheet INTEGER NOT NULL DEFAULT 1,
      margins TEXT NOT NULL DEFAULT 'default',
      scale TEXT NOT NULL DEFAULT 'default',
      page_count INTEGER NOT NULL,
      price_paise INTEGER NOT NULL,
      needs_conversion INTEGER NOT NULL DEFAULT 0,
      queue_position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      printed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      file_kind TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bw_per_page_paise INTEGER NOT NULL,
      color_per_page_paise INTEGER NOT NULL,
      photo_print_paise INTEGER NOT NULL,
      copy_multiplier REAL NOT NULL,
      a4_multiplier REAL NOT NULL,
      legal_multiplier REAL NOT NULL,
      photo_multiplier REAL NOT NULL,
      expiry_minutes INTEGER NOT NULL DEFAULT 1440,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      printer_name TEXT NOT NULL,
      config_version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_printers (
      name TEXT PRIMARY KEY,
      driver_name TEXT NOT NULL,
      port_name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS print_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL
    );
  `);

  ensureJobColumns(database);
  ensurePricingColumns(database);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_position)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_agent_printers_seen ON agent_printers(seen_at)`);
}

function ensureJobColumns(database: Database.Database) {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((column) => column.name)
  );
  const additions = [
    ["layout", "TEXT NOT NULL DEFAULT 'portrait'"],
    ["pages_per_sheet", "INTEGER NOT NULL DEFAULT 1"],
    ["margins", "TEXT NOT NULL DEFAULT 'default'"],
    ["scale", "TEXT NOT NULL DEFAULT 'default'"],
    ["queue_position", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

function ensurePricingColumns(database: Database.Database) {
  const columns = new Set(
    (database.prepare("PRAGMA table_info(pricing_config)").all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  const additions = [
    ["expiry_minutes", "INTEGER NOT NULL DEFAULT 1440"],
    ["a3_multiplier", "REAL NOT NULL DEFAULT 2.5"],
    ["a5_multiplier", "REAL NOT NULL DEFAULT 0.7"],
    ["a6_multiplier", "REAL NOT NULL DEFAULT 0.5"],
    ["b5_multiplier", "REAL NOT NULL DEFAULT 0.9"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE pricing_config ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

function seedDefaults(database: Database.Database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO pricing_config (
      id, bw_per_page_paise, color_per_page_paise, photo_print_paise, copy_multiplier,
      a3_multiplier, a4_multiplier, a5_multiplier, a6_multiplier, b5_multiplier,
      legal_multiplier, photo_multiplier, expiry_minutes, updated_at
    ) VALUES (1, 200, 1000, 3000, 1, 2.5, 1, 0.7, 0.5, 0.9, 1.25, 1, 1440, ?)
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO agent_config (id, printer_name, config_version, updated_at)
    VALUES (1, 'Microsoft Print to PDF', 0, ?)
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO admin_users (id, username, password_hash, created_at)
    VALUES ('default-admin', ?, ?, ?)
  `).run(DEFAULT_ADMIN_USERNAME, hashSecret(DEFAULT_ADMIN_PASSWORD), now);

  database.prepare(`
    INSERT OR IGNORE INTO agent_tokens (id, name, token_hash, created_at)
    VALUES ('default-agent', 'Shop PC Agent', ?, ?)
  `).run(hashSecret(DEFAULT_AGENT_TOKEN), now);
}

export function getPricing(): PricingConfig {
  const row = getDb().prepare("SELECT * FROM pricing_config WHERE id = 1").get() as Record<string, number>;
  return {
    bwPerPagePaise: row.bw_per_page_paise,
    colorPerPagePaise: row.color_per_page_paise,
    photoPrintPaise: row.photo_print_paise,
    copyMultiplier: row.copy_multiplier,
    a3Multiplier: row.a3_multiplier ?? 2.5,
    a4Multiplier: row.a4_multiplier ?? 1,
    a5Multiplier: row.a5_multiplier ?? 0.7,
    a6Multiplier: row.a6_multiplier ?? 0.5,
    b5Multiplier: row.b5_multiplier ?? 0.9,
    legalMultiplier: row.legal_multiplier ?? 1.25,
    photoMultiplier: row.photo_multiplier ?? 1,
    expiryMinutes: row.expiry_minutes ?? 1440
  };
}

export function getAgentConfig() {
  const row = getDb().prepare("SELECT printer_name, config_version FROM agent_config WHERE id = 1")
    .get() as { printer_name: string; config_version: number } | undefined;
  if (!row) return { printerName: "Microsoft Print to PDF", configVersion: 0 };
  return { printerName: row.printer_name, configVersion: row.config_version };
}

export function updateAgentConfig(printerName: string) {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE agent_config SET printer_name = ?, config_version = config_version + 1, updated_at = ? WHERE id = 1
  `).run(printerName, now);
}

export function replaceAgentPrinters(printers: Array<Omit<PrinterOption, "seenAt">>) {
  const now = new Date().toISOString();
  getDb().transaction(() => {
    getDb().prepare("DELETE FROM agent_printers").run();
    const insert = getDb().prepare(`
      INSERT INTO agent_printers (name, driver_name, port_name, is_default, seen_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const printer of printers) {
      insert.run(printer.name, printer.driverName, printer.portName, printer.isDefault ? 1 : 0, now);
    }
  })();
}

export function getAgentPrinters(): PrinterOption[] {
  const rows = getDb().prepare(`
    SELECT name, driver_name, port_name, is_default, seen_at
    FROM agent_printers
    ORDER BY is_default DESC, name COLLATE NOCASE ASC
  `).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name),
    driverName: String(row.driver_name),
    portName: String(row.port_name),
    isDefault: Boolean(row.is_default),
    seenAt: String(row.seen_at)
  }));
}

export function mapJob(row: Record<string, unknown>): Job {
  const createdAt = String(row.created_at);
  const expiryMinutes = getPricing().expiryMinutes ?? 1440;
  const expiresAt = new Date(new Date(createdAt).getTime() + expiryMinutes * 60000).toISOString();
  return {
    id: String(row.id),
    token: String(row.token),
    status: row.status as Job["status"],
    printType: row.print_type as Job["printType"],
    copies: Number(row.copies),
    pageRange: row.page_range ? String(row.page_range) : null,
    paperSize: row.paper_size as Job["paperSize"],
    layout: (row.layout ?? "portrait") as Job["layout"],
    pagesPerSheet: Number(row.pages_per_sheet ?? 1),
    margins: (row.margins ?? "default") as Job["margins"],
    scale: (row.scale ?? "default") as Job["scale"],
    pageCount: Number(row.page_count),
    pricePaise: Number(row.price_paise),
    needsConversion: Number(row.needs_conversion) as 0 | 1,
    queuePosition: Number(row.queue_position),
    createdAt,
    updatedAt: String(row.updated_at),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    printedAt: row.printed_at ? String(row.printed_at) : null,
    expiresAt
  };
}

export function mapJobFile(row: Record<string, unknown>): JobFile {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    fileKind: row.file_kind as JobFile["fileKind"],
    storagePath: String(row.storage_path),
    createdAt: String(row.created_at)
  };
}

export function nextQueuePosition(): number {
  const row = getDb().prepare("SELECT COALESCE(MAX(queue_position), 0) + 1 as pos FROM jobs").get() as { pos: number };
  return row.pos;
}
