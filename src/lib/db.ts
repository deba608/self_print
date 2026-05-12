import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, DEFAULT_AGENT_TOKEN } from "./config";
import { hashSecret } from "./security";
import type { Job, JobFile, PricingConfig } from "./types";

let db: Database.Database | null = null;

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
      page_count INTEGER NOT NULL,
      price_paise INTEGER NOT NULL,
      needs_conversion INTEGER NOT NULL DEFAULT 0,
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
      updated_at TEXT NOT NULL
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
}

function seedDefaults(database: Database.Database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO pricing_config (
      id, bw_per_page_paise, color_per_page_paise, photo_print_paise, copy_multiplier,
      a4_multiplier, legal_multiplier, photo_multiplier, updated_at
    ) VALUES (1, 200, 1000, 3000, 1, 1, 1.25, 1, ?)
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
    a4Multiplier: row.a4_multiplier,
    legalMultiplier: row.legal_multiplier,
    photoMultiplier: row.photo_multiplier
  };
}

export function mapJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    token: String(row.token),
    status: row.status as Job["status"],
    printType: row.print_type as Job["printType"],
    copies: Number(row.copies),
    pageRange: row.page_range ? String(row.page_range) : null,
    paperSize: row.paper_size as Job["paperSize"],
    pageCount: Number(row.page_count),
    pricePaise: Number(row.price_paise),
    needsConversion: Number(row.needs_conversion) as 0 | 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    printedAt: row.printed_at ? String(row.printed_at) : null
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
