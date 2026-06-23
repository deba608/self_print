import type { Job, JobFile, PricingConfig, PrinterOption, SseClient } from './types';

// Check if Supabase is configured
const isSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export const sseClients = new Set<SseClient>();

// In-memory pricing cache. Pricing rarely changes; cleared on updatePricing.
let pricingCache: PricingConfig | null = null;

// Lazy load SQLite only when needed (not on Vercel/Supabase)
let dbModule: any = null;
let dbInstance: any = null;

async function getDbModule() {
  if (!dbModule) {
    dbModule = await import('better-sqlite3');
  }
  return dbModule.default;
}

async function getDbInstance() {
  if (!dbInstance) {
    const { DB_PATH, DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, DEFAULT_AGENT_TOKEN } = await import('./config');
    const { hashSecret } = await import('./security');
    const fs = await import('node:fs');
    const path = await import('node:path');
    
    const Database = await getDbModule();
    
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    
    await initSchema(dbInstance);
    await seedDefaults(dbInstance, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, DEFAULT_AGENT_TOKEN, hashSecret);
  }
  return dbInstance;
}

// Forces SQLite schema creation + default seeding. No-op in Supabase mode
// (Supabase schema and seed data are managed in the dashboard / migrations).
export async function ensureDatabase(): Promise<void> {
  if (isSupabase) return;
  await getDbInstance();
}

async function initSchema(database: any) {
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

  await ensureJobColumns(database);
  await ensurePricingColumns(database);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_position)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_approved ON jobs(status, needs_conversion, updated_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_print_events_job_id ON print_events(job_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_agent_printers_seen ON agent_printers(seen_at)`);
}

async function ensureJobColumns(database: any) {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  const additions = [
    ['layout', "TEXT NOT NULL DEFAULT 'portrait'"],
    ['pages_per_sheet', 'INTEGER NOT NULL DEFAULT 1'],
    ['margins', "TEXT NOT NULL DEFAULT 'default'"],
    ['scale', "TEXT NOT NULL DEFAULT 'default'"],
    ['queue_position', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

async function ensurePricingColumns(database: any) {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(pricing_config)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  );
  const additions = [
    ['expiry_minutes', 'INTEGER NOT NULL DEFAULT 1440'],
    ['a3_multiplier', 'REAL NOT NULL DEFAULT 2.5'],
    ['a5_multiplier', 'REAL NOT NULL DEFAULT 0.7'],
    ['a6_multiplier', 'REAL NOT NULL DEFAULT 0.5'],
    ['b5_multiplier', 'REAL NOT NULL DEFAULT 0.9']
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE pricing_config ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

async function seedDefaults(database: any, username: string, password: string, agentToken: string, hashSecret: (s: string) => string) {
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
  `).run(username, hashSecret(password), now);

  database.prepare(`
    INSERT OR IGNORE INTO agent_tokens (id, name, token_hash, created_at)
    VALUES ('default-agent', 'Shop PC Agent', ?, ?)
  `).run(hashSecret(agentToken), now);
}

// Helper to convert SQLite row to Job type
function mapJob(row: Record<string, unknown>): Job {
  const createdAt = String(row.created_at);
  const expiryMinutes = 1440;
  const expiresAt = new Date(new Date(createdAt).getTime() + expiryMinutes * 60000).toISOString();
  return {
    id: String(row.id),
    token: String(row.token),
    status: row.status as Job['status'],
    printType: row.print_type as Job['printType'],
    copies: Number(row.copies),
    pageRange: row.page_range ? String(row.page_range) : null,
    paperSize: row.paper_size as Job['paperSize'],
    layout: (row.layout ?? 'portrait') as Job['layout'],
    pagesPerSheet: Number(row.pages_per_sheet ?? 1),
    margins: (row.margins ?? 'default') as Job['margins'],
    scale: (row.scale ?? 'default') as Job['scale'],
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

// Helper to convert SQLite row to JobFile type
export function mapJobFile(row: Record<string, unknown>): JobFile {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    fileKind: row.file_kind as JobFile['fileKind'],
    storagePath: String(row.storage_path),
    createdAt: String(row.created_at)
  };
}

// ============================================================================
// SMART ROUTER: Automatically chooses SQLite or Supabase based on environment
// ============================================================================

export async function getJobs(): Promise<Job[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobs();
  }
  const sqlite = await getDbInstance();
  const rows = sqlite.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(mapJob);
}

// Paginated jobs. Avoids loading the entire table into memory.
export async function getJobsPage(limit: number, cursor?: string | null): Promise<{ jobs: Job[]; total: number }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobsPage(limit, cursor);
  }
  const sqlite = await getDbInstance();
  const total = (sqlite.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c;

  let stmt;
  let rows;
  if (cursor) {
    stmt = sqlite.prepare(`
      SELECT jobs.*, 
        job_files.id AS f_id, job_files.original_name AS f_original_name,
        job_files.stored_name AS f_stored_name, job_files.mime_type AS f_mime_type,
        job_files.size_bytes AS f_size_bytes, job_files.file_kind AS f_file_kind,
        job_files.storage_path AS f_storage_path, job_files.created_at AS f_created_at
      FROM jobs 
      LEFT JOIN job_files ON jobs.id = job_files.job_id 
      WHERE jobs.created_at < ? 
      ORDER BY jobs.created_at DESC LIMIT ?
    `);
    rows = stmt.all(cursor, limit) as any[];
  } else {
    stmt = sqlite.prepare(`
      SELECT jobs.*, 
        job_files.id AS f_id, job_files.original_name AS f_original_name,
        job_files.stored_name AS f_stored_name, job_files.mime_type AS f_mime_type,
        job_files.size_bytes AS f_size_bytes, job_files.file_kind AS f_file_kind,
        job_files.storage_path AS f_storage_path, job_files.created_at AS f_created_at
      FROM jobs 
      LEFT JOIN job_files ON jobs.id = job_files.job_id 
      ORDER BY jobs.created_at DESC LIMIT ?
    `);
    rows = stmt.all(limit) as any[];
  }

  const jobs = rows.map(row => {
    const job = mapJob(row);
    if (row.f_id) {
      job.file = {
        id: String(row.f_id),
        jobId: job.id,
        originalName: String(row.f_original_name),
        storedName: String(row.f_stored_name),
        mimeType: String(row.f_mime_type),
        sizeBytes: Number(row.f_size_bytes),
        fileKind: row.f_file_kind as any,
        storagePath: String(row.f_storage_path),
        createdAt: String(row.f_created_at)
      };
    }
    return job;
  });

  return { jobs, total };
}

// Batch-fetch files for many jobs in one query (replaces per-job N+1 lookups).
export async function getJobFilesForJobs(jobIds: string[]): Promise<Record<string, JobFile>> {
  if (jobIds.length === 0) return {};
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobFilesForJobs(jobIds);
  }
  const sqlite = await getDbInstance();
  const placeholders = jobIds.map(() => '?').join(',');
  const rows = sqlite
    .prepare(`SELECT * FROM job_files WHERE job_id IN (${placeholders})`)
    .all(...jobIds) as Record<string, unknown>[];
  const map: Record<string, JobFile> = {};
  for (const row of rows) map[String(row.job_id)] = mapJobFile(row);
  return map;
}

export async function getJobById(id: string): Promise<Job> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobById(id);
  }
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Job not found');
  return mapJob(row);
}

export async function getJobByToken(token: string): Promise<Job> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobByToken(token);
  }
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM jobs WHERE token = ?').get(token) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Job not found');
  return mapJob(row);
}

export async function getNextApprovedJob(): Promise<Job | null> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getNextApprovedJob();
  }
  const sqlite = await getDbInstance();
  const row = sqlite.prepare(`
    SELECT * FROM jobs
    WHERE status = 'approved' AND needs_conversion = 0
    ORDER BY updated_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export async function getJobFile(jobId: string): Promise<JobFile> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobFile(jobId);
  }
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM job_files WHERE job_id = ?').get(jobId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Job file not found');
  return mapJobFile(row);
}

export async function getJobFileById(fileId: string): Promise<JobFile> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobFileById(fileId);
  }
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM job_files WHERE id = ?').get(fileId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Job file not found');
  return mapJobFile(row);
}

export async function getJobEvents(jobId: string) {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobEvents(jobId);
  }
  const sqlite = await getDbInstance();
  return sqlite.prepare(`
    SELECT id, event_type, message, created_at
    FROM print_events
    WHERE job_id = ?
    ORDER BY created_at ASC
  `).all(jobId);
}

export async function createJob(jobData: any, fileData: any): Promise<{ jobId: string; fileId: string }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.createJob(jobData, fileData);
  }
  
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const normalizedJobData = {
    token: jobData.token,
    printType: jobData.printType ?? jobData.print_type,
    copies: jobData.copies,
    pageRange: jobData.pageRange ?? jobData.page_range,
    paperSize: jobData.paperSize ?? jobData.paper_size,
    layout: jobData.layout,
    pagesPerSheet: jobData.pagesPerSheet ?? jobData.pages_per_sheet,
    margins: jobData.margins,
    scale: jobData.scale,
    pageCount: jobData.pageCount ?? jobData.page_count,
    pricePaise: jobData.pricePaise ?? jobData.price_paise,
    needsConversion: jobData.needsConversion ?? jobData.needs_conversion,
    queuePosition: jobData.queuePosition ?? jobData.queue_position
  };
  const normalizedFileData = {
    originalName: fileData.originalName ?? fileData.original_name,
    storedName: fileData.storedName ?? fileData.stored_name,
    mimeType: fileData.mimeType ?? fileData.mime_type,
    sizeBytes: fileData.sizeBytes ?? fileData.size_bytes,
    fileKind: fileData.fileKind ?? fileData.file_kind,
    storagePath: fileData.storagePath ?? fileData.storage_path
  };
  
  sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO jobs (id, token, status, print_type, copies, page_range, paper_size, layout, pages_per_sheet, margins, scale, page_count, price_paise, needs_conversion, queue_position, created_at, updated_at)
      VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, normalizedJobData.token, normalizedJobData.printType, normalizedJobData.copies, normalizedJobData.pageRange, normalizedJobData.paperSize, normalizedJobData.layout, normalizedJobData.pagesPerSheet, normalizedJobData.margins, normalizedJobData.scale, normalizedJobData.pageCount, normalizedJobData.pricePaise, normalizedJobData.needsConversion, normalizedJobData.queuePosition, now, now);
    
    sqlite.prepare(`
      INSERT INTO job_files (id, job_id, original_name, stored_name, mime_type, size_bytes, file_kind, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fileId, jobId, normalizedFileData.originalName, normalizedFileData.storedName, normalizedFileData.mimeType, normalizedFileData.sizeBytes, normalizedFileData.fileKind, normalizedFileData.storagePath, now);
    
    sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'created', ?, ?)")
      .run(crypto.randomUUID(), jobId, normalizedFileData.fileKind === 'document' ? 'Document upload needs conversion before printing.' : 'Customer submitted job.', now);
  })();
  
  return { jobId, fileId };
}

export async function updateJobStatus(id: string, status: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateJobStatus(id, status);
  }
  
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE jobs
    SET status = ?, updated_at = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
        printed_at = CASE WHEN ? = 'printed' THEN ? ELSE printed_at END
    WHERE id = ?
  `).run(status, now, status, now, status, now, id);
  
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, status, `Admin set status to ${status}.`, now);
}

export async function updateJobSettings(id: string, settings: {
  printType: string;
  copies: number;
  pageRange: string | null;
  paperSize: string;
  layout: string;
  pagesPerSheet: number;
  margins: string;
  scale: string;
  pricePaise: number;
  updatedAt: string;
}): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateJobSettings(id, settings);
  }
  
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  sqlite.prepare(`
    UPDATE jobs
    SET print_type = ?, copies = ?, page_range = ?, paper_size = ?, layout = ?,
        pages_per_sheet = ?, margins = ?, scale = ?, price_paise = ?, updated_at = ?
    WHERE id = ?
  `).run(
    settings.printType, settings.copies, settings.pageRange, settings.paperSize, settings.layout,
    settings.pagesPerSheet, settings.margins, settings.scale, settings.pricePaise, settings.updatedAt, id
  );
  
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'settings', ?, ?)")
    .run(crypto.randomUUID(), id, 'Admin updated print settings.', settings.updatedAt);
}

export async function getPricing(): Promise<PricingConfig> {
  if (pricingCache) return pricingCache;

  if (isSupabase) {
    const mod = await import('./db-supabase');
    pricingCache = await mod.getPricing();
    return pricingCache;
  }

  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM pricing_config WHERE id = 1').get() as Record<string, number> | undefined;
  if (!row) throw new Error('Pricing config not found. Run "npm run db:seed".');
  pricingCache = {
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
  return pricingCache;
}

export async function updatePricing(pricing: PricingConfig): Promise<void> {
  pricingCache = null; // invalidate cache

  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updatePricing(pricing);
  }

  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE pricing_config SET
      bw_per_page_paise = ?, color_per_page_paise = ?, photo_print_paise = ?,
      copy_multiplier = ?, a3_multiplier = ?, a4_multiplier = ?, a5_multiplier = ?,
      a6_multiplier = ?, b5_multiplier = ?, legal_multiplier = ?, photo_multiplier = ?,
      expiry_minutes = ?, updated_at = ?
    WHERE id = 1
  `).run(
    pricing.bwPerPagePaise, pricing.colorPerPagePaise, pricing.photoPrintPaise,
    pricing.copyMultiplier, pricing.a3Multiplier, pricing.a4Multiplier, pricing.a5Multiplier,
    pricing.a6Multiplier, pricing.b5Multiplier, pricing.legalMultiplier, pricing.photoMultiplier,
    pricing.expiryMinutes, now
  );
}

export async function getAgentConfig() {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentConfig();
  }
  
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT printer_name, config_version FROM agent_config WHERE id = 1')
    .get() as { printer_name: string; config_version: number } | undefined;
  if (!row) return { printerName: 'Microsoft Print to PDF', configVersion: 0 };
  return { printerName: row.printer_name, configVersion: row.config_version };
}

export async function updateAgentConfig(printerName: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateAgentConfig(printerName);
  }
  
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE agent_config SET printer_name = ?, config_version = config_version + 1, updated_at = ? WHERE id = 1
  `).run(printerName, now);
}

export async function replaceAgentPrinters(printers: Array<Omit<PrinterOption, 'seenAt'>>): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.replaceAgentPrinters(printers);
  }
  
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM agent_printers').run();
    const insert = sqlite.prepare(`
      INSERT INTO agent_printers (name, driver_name, port_name, is_default, seen_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const printer of printers) {
      insert.run(printer.name, printer.driverName, printer.portName, printer.isDefault ? 1 : 0, now);
    }
  })();
}

export async function getAgentPrinters(): Promise<PrinterOption[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentPrinters();
  }
  
  const sqlite = await getDbInstance();
  const rows = sqlite.prepare(`
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

export async function getAdminUser(username: string) {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAdminUser(username);
  }
  
  const sqlite = await getDbInstance();
  return sqlite.prepare('SELECT username, password_hash FROM admin_users WHERE username = ?').get(username);
}

export async function getAgentToken(rawToken: string) {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentToken(rawToken);
  }
  
  const sqlite = await getDbInstance();
  const { verifySecret } = await import('./security');
  const rows = sqlite.prepare('SELECT token_hash FROM agent_tokens').all() as Array<{ token_hash: string }>;
  return rows.find((row) => verifySecret(rawToken, row.token_hash)) || null;
}

export async function nextQueuePosition(): Promise<number> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.nextQueuePosition();
  }
  
  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT COALESCE(MAX(queue_position), 0) + 1 as pos FROM jobs').get() as { pos: number };
  return row.pos;
}

export async function getJobSummary() {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobSummary();
  }
  
  const sqlite = await getDbInstance();
  const jobs = sqlite.prepare('SELECT price_paise, status FROM jobs').all() as Array<{ price_paise: number; status: string }>;
  const totalPaise = jobs.reduce((sum, j) => sum + j.price_paise, 0);
  const activeJobs = jobs.filter(j => !['printed', 'cancelled', 'failed'].includes(j.status)).length;
  return { jobs: activeJobs, totalPaise };
}

export async function deleteJob(id: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.deleteJob(id);
  }
  
  const sqlite = await getDbInstance();
  sqlite.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

export async function bulkDeleteJobs(ids: string[]): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.bulkDeleteJobs(ids);
  }
  
  const sqlite = await getDbInstance();
  sqlite.prepare(`DELETE FROM jobs WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

// Deletes finished jobs (printed/cancelled/failed) and expired unpaid jobs.
// Returns storage paths of removed files so the caller can purge them from disk/storage.
export async function cleanupOldJobs(): Promise<{ deleted: number; storagePaths: string[] }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.cleanupOldJobs();
  }

  const sqlite = await getDbInstance();
  const pricing = await getPricing();
  const cutoff = new Date(Date.now() - pricing.expiryMinutes * 60000).toISOString();

  const targets = sqlite.prepare(`
    SELECT id FROM jobs
    WHERE status IN ('printed', 'cancelled', 'failed')
       OR (status = 'pending_payment' AND created_at < ?)
  `).all(cutoff) as Array<{ id: string }>;
  const ids = targets.map((t) => t.id);
  if (ids.length === 0) return { deleted: 0, storagePaths: [] };

  const placeholders = ids.map(() => '?').join(',');
  const files = sqlite
    .prepare(`SELECT storage_path FROM job_files WHERE job_id IN (${placeholders})`)
    .all(...ids) as Array<{ storage_path: string }>;
  const storagePaths = files.map((f) => f.storage_path);

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    sqlite.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...ids);
  }

  return { deleted: ids.length, storagePaths };
}

export async function filterActiveStoragePaths(paths: string[]): Promise<Set<string>> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.filterActiveStoragePaths(paths);
  }
  if (paths.length === 0) return new Set();
  const sqlite = await getDbInstance();
  const active = new Set<string>();
  
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = sqlite.prepare(`SELECT storage_path FROM job_files WHERE storage_path IN (${placeholders})`);
    const rows = stmt.all(...chunk) as { storage_path: string }[];
    for (const row of rows) active.add(row.storage_path);
  }
  return active;
}

export async function queueReprint(id: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.queueReprint(id);
  }
  
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare("UPDATE jobs SET status = 'approved', updated_at = ? WHERE id = ?").run(now, id);
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'reprint', 'Admin queued reprint.', ?)")
    .run(crypto.randomUUID(), id, now);
}

// Jobs whose uploaded file still needs DOC/DOCX -> PDF conversion.
export async function getJobsNeedingConversion(): Promise<Job[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobsNeedingConversion();
  }
  const sqlite = await getDbInstance();
  const rows = sqlite
    .prepare("SELECT * FROM jobs WHERE needs_conversion = 1 ORDER BY created_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map(mapJob);
}

// Replaces a job's file with the converted PDF and clears the conversion flag.
export async function markJobConverted(
  jobId: string,
  fileId: string,
  file: { storedName: string; storagePath: string; sizeBytes: number; pageCount: number; pricePaise: number }
): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.markJobConverted(jobId, fileId, file);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE job_files
      SET stored_name = ?, storage_path = ?, size_bytes = ?, mime_type = 'application/pdf', file_kind = 'pdf'
      WHERE id = ?
    `).run(file.storedName, file.storagePath, file.sizeBytes, fileId);

    sqlite.prepare(`
      UPDATE jobs SET needs_conversion = 0, page_count = ?, price_paise = ?, updated_at = ? WHERE id = ?
    `).run(file.pageCount, file.pricePaise, now, jobId);

    sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'converted', 'Document converted to PDF.', ?)")
      .run(crypto.randomUUID(), jobId, now);
  })();
}

export async function updateJobStatusByAgent(id: string, status: string, message?: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateJobStatusByAgent(id, status, message);
  }
  
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE jobs
    SET status = ?, updated_at = ?, printed_at = CASE WHEN ? = 'printed' THEN ? ELSE printed_at END
    WHERE id = ? AND status IN ('approved', 'printing')
  `).run(status, now, status, now, id);
  
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, status, message ?? '', now);
}
