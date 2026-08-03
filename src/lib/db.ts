import type { CustomerManagementRow, Job, JobFile, PricingConfig, PrinterOption, RetentionConfig, SseClient } from './types';
import { FILE_RETENTION_DAYS, CART_ABANDON_MINUTES, STRAY_FILE_RETENTION_HOURS, LOGIN_EVENT_RETENTION_DAYS } from './config';
import { chunk } from './util';
import { parseServiceAreaConfig, serializeServiceAreaConfig } from './service-area';

// Check if Supabase is configured
const isSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export const sseClients = new Set<SseClient>();

/** Pushes a Server-Sent Event to every connected admin dashboard client. */
export function broadcastSse(data: object): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}

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
    const { DB_PATH, DEFAULT_AGENT_TOKEN } = await import('./config');
    const { hashToken } = await import('./token-hash');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const Database = await getDbModule();

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    await initSchema(dbInstance);
    await seedDefaults(dbInstance, DEFAULT_AGENT_TOKEN, hashToken);
  }
  return dbInstance;
}

// Forces SQLite schema creation + default seeding. No-op in Supabase mode
// (Supabase schema and seed data are managed in the dashboard / migrations).
export async function ensureDatabase(): Promise<void> {
  if (isSupabase) return;
  await getDbInstance();
}

function addJobToCustomerSummary(
  summary: CustomerManagementRow,
  job: {
    status: string;
    pricePaise: number;
    paidAt: string | null;
    createdAt: string;
    deliveryMethod: string;
    deliveryStatus: string | null;
    deliveryAddress: string | null;
  }
) {
  summary.totalOrders += 1;
  if (!["printed", "cancelled", "failed"].includes(job.status)) summary.activeOrders += 1;
  if (job.deliveryMethod === "delivery") summary.deliveryOrders += 1;
  if (job.deliveryStatus === "delivered") summary.deliveredOrders += 1;
  if (job.paidAt) summary.totalSpentPaise += job.pricePaise;
  if (!summary.lastOrderAt || job.createdAt > summary.lastOrderAt) {
    summary.lastOrderAt = job.createdAt;
    if (job.deliveryAddress) summary.latestAddress = job.deliveryAddress;
  }
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
      duplex TEXT NOT NULL DEFAULT 'simplex',
      page_count INTEGER NOT NULL,
      price_paise INTEGER NOT NULL,
      needs_conversion INTEGER NOT NULL DEFAULT 0,
      queue_position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      paid_via TEXT,
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
      created_at TEXT NOT NULL,
      purged_at TEXT
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
      bw_printer_name TEXT,
      color_printer_name TEXT,
      config_version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_printers (
      name TEXT PRIMARY KEY,
      driver_name TEXT NOT NULL,
      port_name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      can_duplex INTEGER NOT NULL DEFAULT 0,
      seen_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS retention_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cart_abandon_minutes INTEGER NOT NULL DEFAULT 1440,
      file_retention_days INTEGER NOT NULL DEFAULT 3,
      stray_file_retention_hours INTEGER NOT NULL DEFAULT 2,
      login_event_retention_days INTEGER NOT NULL DEFAULT 365,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cleanup_events (
      id TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL,
      deleted_jobs INTEGER NOT NULL DEFAULT 0,
      job_files_removed INTEGER NOT NULL DEFAULT 0,
      stray_files_removed INTEGER NOT NULL DEFAULT 0
    );
  `);

  await ensureJobColumns(database);
  await ensurePricingColumns(database);
  await ensureJobFileColumns(database);
  await ensureAgentConfigColumns(database);
  await ensureAgentPrinterColumns(database);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(queue_position)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_approved ON jobs(status, needs_conversion, updated_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_delivery_dispatch ON jobs(delivery_method, delivery_status, created_at)`);
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
    ['duplex', "TEXT NOT NULL DEFAULT 'simplex'"],
    ['queue_position', 'INTEGER NOT NULL DEFAULT 0'],
    ['paid_via', 'TEXT'],
    ['issue_reported_at', 'TEXT'],
    ['issue_note', 'TEXT'],
    ['issue_resolved_at', 'TEXT'],
    ['delivery_method', "TEXT NOT NULL DEFAULT 'pickup'"],
    ['customer_name', 'TEXT'],
    ['customer_phone', 'TEXT'],
    ['delivery_address', 'TEXT'],
    ['delivery_fee_paise', 'INTEGER NOT NULL DEFAULT 0'],
    ['delivery_status', 'TEXT'],
    ['delivery_latitude', 'REAL'],
    ['delivery_longitude', 'REAL'],
    ['delivery_accuracy_meters', 'REAL'],
    ['delivery_location_captured_at', 'TEXT'],
    ['customer_user_id', 'TEXT'],
    ['delivery_person_id', 'TEXT'],
    ['delivery_pincode', 'TEXT'],
    ['delivery_area', 'TEXT']
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

async function ensureJobFileColumns(database: any) {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(job_files)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has('purged_at')) {
    database.prepare(`ALTER TABLE job_files ADD COLUMN purged_at TEXT`).run();
  }
}

async function ensureAgentConfigColumns(database: any) {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(agent_config)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  for (const name of ['bw_printer_name', 'color_printer_name']) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE agent_config ADD COLUMN ${name} TEXT`).run();
    }
  }
}

async function ensureAgentPrinterColumns(database: any) {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(agent_printers)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!columns.has('can_duplex')) {
    database.prepare(`ALTER TABLE agent_printers ADD COLUMN can_duplex INTEGER NOT NULL DEFAULT 0`).run();
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
    ['b5_multiplier', 'REAL NOT NULL DEFAULT 0.9'],
    ['duplex_bw_per_page_paise', 'INTEGER NOT NULL DEFAULT 100'],
    ['delivery_fee_paise', 'INTEGER NOT NULL DEFAULT 0'],
    ['service_area_config', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) {
      database.prepare(`ALTER TABLE pricing_config ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

async function seedDefaults(database: any, agentToken: string, hashToken: (s: string) => string) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO pricing_config (
      id, bw_per_page_paise, color_per_page_paise, photo_print_paise, copy_multiplier,
      a3_multiplier, a4_multiplier, a5_multiplier, a6_multiplier, b5_multiplier,
      legal_multiplier, photo_multiplier, duplex_bw_per_page_paise, expiry_minutes, delivery_fee_paise, updated_at
    ) VALUES (1, 100, 1000, 3000, 1, 2.5, 1, 0.7, 0.5, 0.9, 1.25, 1, 100, 1440, 0, ?)
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO agent_config (id, printer_name, config_version, updated_at)
    VALUES (1, 'Microsoft Print to PDF', 0, ?)
  `).run(now);

  database.prepare(`
    INSERT OR IGNORE INTO agent_tokens (id, name, token_hash, created_at)
    VALUES ('default-agent', 'Shop PC Agent', ?, ?)
  `).run(hashToken(agentToken), now);
}

// Helper to convert SQLite row to Job type
function mapJob(row: Record<string, unknown>, expiryMinutes: number = 1440): Job {
  const createdAt = String(row.created_at);
  const expiresAt = new Date(new Date(createdAt).getTime() + expiryMinutes * 60000).toISOString();
  return {
    id: String(row.id),
    token: String(row.token),
    customerUserId: row.customer_user_id ? String(row.customer_user_id) : null,
    status: row.status as Job['status'],
    printType: row.print_type as Job['printType'],
    copies: Number(row.copies),
    pageRange: row.page_range ? String(row.page_range) : null,
    paperSize: row.paper_size as Job['paperSize'],
    layout: (row.layout ?? 'portrait') as Job['layout'],
    pagesPerSheet: Number(row.pages_per_sheet ?? 1),
    margins: (row.margins ?? 'default') as Job['margins'],
    scale: (row.scale ?? 'default') as Job['scale'],
    duplex: (row.duplex ?? 'simplex') as Job['duplex'],
    pageCount: Number(row.page_count),
    pricePaise: Number(row.price_paise),
    needsConversion: Number(row.needs_conversion) as 0 | 1,
    queuePosition: Number(row.queue_position),
    createdAt,
    updatedAt: String(row.updated_at),
    paidAt: row.paid_at ? String(row.paid_at) : null,
    paidVia: row.paid_via ? (row.paid_via as Job['paidVia']) : null,
    printedAt: row.printed_at ? String(row.printed_at) : null,
    expiresAt,
    issueReportedAt: row.issue_reported_at ? String(row.issue_reported_at) : null,
    issueNote: row.issue_note ? String(row.issue_note) : null,
    issueResolvedAt: row.issue_resolved_at ? String(row.issue_resolved_at) : null,
    deliveryMethod: (row.delivery_method ?? 'pickup') as Job['deliveryMethod'],
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    deliveryAddress: row.delivery_address ? String(row.delivery_address) : null,
    deliveryPincode: row.delivery_pincode ? String(row.delivery_pincode) : null,
    deliveryArea: row.delivery_area ? String(row.delivery_area) : null,
    deliveryFeePaise: Number(row.delivery_fee_paise ?? 0),
    deliveryStatus: row.delivery_status ? (row.delivery_status as Job['deliveryStatus']) : null,
    deliveryLatitude: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
    deliveryLongitude: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    deliveryAccuracyMeters: row.delivery_accuracy_meters == null ? null : Number(row.delivery_accuracy_meters),
    deliveryLocationCapturedAt: row.delivery_location_captured_at ? String(row.delivery_location_captured_at) : null,
    // SQLite has no staff_profiles table (staff login requires Supabase), so
    // a self-assigned id here can never be resolved to a name.
    deliveryPersonId: row.delivery_person_id ? String(row.delivery_person_id) : null,
    deliveryPersonName: null
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
    createdAt: String(row.created_at),
    purgedAt: row.purged_at ? String(row.purged_at) : null
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
  const pricing = await getPricing();
  const rows = sqlite.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(row => mapJob(row, pricing.expiryMinutes));
}

export async function getCustomerManagementRows(): Promise<CustomerManagementRow[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getCustomerManagementRows();
  }

  const sqlite = await getDbInstance();
  const rows = sqlite.prepare(`
    SELECT customer_user_id, customer_name, customer_phone, delivery_address,
      delivery_method, delivery_status, status, price_paise, paid_at, created_at
    FROM jobs
    WHERE customer_user_id IS NOT NULL OR customer_phone IS NOT NULL
    ORDER BY created_at DESC
  `).all() as Record<string, unknown>[];

  const customers = new Map<string, CustomerManagementRow>();
  for (const row of rows) {
    const userId = row.customer_user_id ? String(row.customer_user_id) : null;
    const phone = row.customer_phone ? String(row.customer_phone) : null;
    const id = userId ?? `guest:${phone}`;
    if (!customers.has(id)) {
      customers.set(id, {
        id,
        displayName: row.customer_name ? String(row.customer_name) : "Guest customer",
        email: null,
        phone,
        registeredAt: null,
        totalOrders: 0,
        activeOrders: 0,
        deliveryOrders: 0,
        deliveredOrders: 0,
        totalSpentPaise: 0,
        lastOrderAt: null,
        latestAddress: row.delivery_address ? String(row.delivery_address) : null,
      });
    }
    addJobToCustomerSummary(customers.get(id)!, {
      status: String(row.status),
      pricePaise: Number(row.price_paise),
      paidAt: row.paid_at ? String(row.paid_at) : null,
      createdAt: String(row.created_at),
      deliveryMethod: String(row.delivery_method ?? "pickup"),
      deliveryStatus: row.delivery_status ? String(row.delivery_status) : null,
      deliveryAddress: row.delivery_address ? String(row.delivery_address) : null,
    });
  }

  return [...customers.values()].sort((a, b) => (b.lastOrderAt ?? "").localeCompare(a.lastOrderAt ?? ""));
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
        job_files.storage_path AS f_storage_path, job_files.created_at AS f_created_at,
        job_files.purged_at AS f_purged_at,
        (SELECT COUNT(*) FROM job_files jf WHERE jf.job_id = jobs.id) AS f_count
      FROM jobs
      LEFT JOIN job_files ON jobs.id = job_files.job_id
      WHERE jobs.created_at < ?
      GROUP BY jobs.id
      ORDER BY jobs.created_at DESC LIMIT ?
    `);
    rows = stmt.all(cursor, limit) as any[];
  } else {
    stmt = sqlite.prepare(`
      SELECT jobs.*,
        job_files.id AS f_id, job_files.original_name AS f_original_name,
        job_files.stored_name AS f_stored_name, job_files.mime_type AS f_mime_type,
        job_files.size_bytes AS f_size_bytes, job_files.file_kind AS f_file_kind,
        job_files.storage_path AS f_storage_path, job_files.created_at AS f_created_at,
        job_files.purged_at AS f_purged_at,
        (SELECT COUNT(*) FROM job_files jf WHERE jf.job_id = jobs.id) AS f_count
      FROM jobs
      LEFT JOIN job_files ON jobs.id = job_files.job_id
      GROUP BY jobs.id
      ORDER BY jobs.created_at DESC LIMIT ?
    `);
    rows = stmt.all(limit) as any[];
  }

  const expiry = (await getPricing()).expiryMinutes;
  const jobs = rows.map(row => {
    const job = mapJob(row, expiry);
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
        createdAt: String(row.f_created_at),
        purgedAt: row.f_purged_at ? String(row.f_purged_at) : null
      };
    }
    job.fileCount = Number(row.f_count ?? (row.f_id ? 1 : 0));
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
  const [row, pricing] = await Promise.all([
    sqlite.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined,
    getPricing()
  ]);
  if (!row) throw new Error('Job not found');
  return mapJob(row, pricing.expiryMinutes);
}

export async function getJobByToken(token: string): Promise<Job> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobByToken(token);
  }
  const sqlite = await getDbInstance();
  const pricing = await getPricing();
  const row = sqlite.prepare('SELECT * FROM jobs WHERE token = ?').get(token) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Job not found');
  return mapJob(row, pricing.expiryMinutes);
}

// Live count of active (not yet printed/cancelled/failed) jobs queued ahead
// of this one. queue_position itself is a fixed ticket number assigned once
// at creation (MAX+1) and never changes — it does NOT shrink as earlier jobs
// finish, so it's wrong to use directly for a "how many ahead of you" ETA.
export async function getJobsAhead(job: Job): Promise<number> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobsAhead(job);
  }
  const sqlite = await getDbInstance();
  // queue_position resets daily (see nextQueuePosition), so "ahead" only
  // makes sense compared against jobs from the same calendar day.
  const dayStart = new Date(job.createdAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const row = sqlite.prepare(`
    SELECT COUNT(*) as n FROM jobs
    WHERE queue_position < ? AND status NOT IN ('printed', 'cancelled', 'failed')
      AND created_at >= ? AND created_at < ?
  `).get(job.queuePosition, dayStart.toISOString(), dayEnd.toISOString()) as { n: number };
  return row.n;
}

export async function getNextApprovedJob(): Promise<Job | null> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getNextApprovedJob();
  }
  const sqlite = await getDbInstance();
  const pricing = await getPricing();
  const row = sqlite.prepare(`
    SELECT * FROM jobs
    WHERE status = 'approved' AND needs_conversion = 0
    ORDER BY updated_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  return row ? mapJob(row, pricing.expiryMinutes) : null;
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

export async function createJobWithFiles(
  jobData: any,
  filesData: any[]
): Promise<{ jobId: string; fileIds: string[] }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.createJobWithFiles(jobData, filesData);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileIds = filesData.map(() => crypto.randomUUID());

  const j = {
    token: jobData.token,
    customerUserId: jobData.customer_user_id ?? jobData.customerUserId ?? null,
    printType: jobData.printType ?? jobData.print_type,
    copies: jobData.copies,
    pageRange: jobData.pageRange ?? jobData.page_range ?? null,
    paperSize: jobData.paperSize ?? jobData.paper_size,
    layout: jobData.layout,
    pagesPerSheet: jobData.pagesPerSheet ?? jobData.pages_per_sheet,
    margins: jobData.margins,
    scale: jobData.scale,
    duplex: jobData.duplex ?? 'simplex',
    pageCount: jobData.pageCount ?? jobData.page_count,
    pricePaise: jobData.pricePaise ?? jobData.price_paise,
    needsConversion: jobData.needsConversion ?? jobData.needs_conversion,
    queuePosition: jobData.queuePosition ?? jobData.queue_position,
    deliveryMethod: jobData.deliveryMethod ?? jobData.delivery_method ?? 'pickup',
    customerName: jobData.customerName ?? jobData.customer_name ?? null,
    customerPhone: jobData.customerPhone ?? jobData.customer_phone ?? null,
    deliveryAddress: jobData.deliveryAddress ?? jobData.delivery_address ?? null,
    deliveryPincode: jobData.deliveryPincode ?? jobData.delivery_pincode ?? null,
    deliveryArea: jobData.deliveryArea ?? jobData.delivery_area ?? null,
    deliveryFeePaise: jobData.deliveryFeePaise ?? jobData.delivery_fee_paise ?? 0,
    deliveryLatitude: jobData.deliveryLatitude ?? jobData.delivery_latitude ?? null,
    deliveryLongitude: jobData.deliveryLongitude ?? jobData.delivery_longitude ?? null,
    deliveryAccuracyMeters: jobData.deliveryAccuracyMeters ?? jobData.delivery_accuracy_meters ?? null,
    deliveryLocationCapturedAt: jobData.deliveryLocationCapturedAt ?? jobData.delivery_location_captured_at ?? null,
  };

  const firstKind = filesData[0]?.fileKind ?? filesData[0]?.file_kind;

  sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO jobs (
        id, token, status, customer_user_id, print_type, copies, page_range, paper_size,
        layout, pages_per_sheet, margins, scale, duplex, page_count, price_paise,
        needs_conversion, queue_position, delivery_method, customer_name, customer_phone,
        delivery_address, delivery_pincode, delivery_area, delivery_fee_paise, delivery_latitude, delivery_longitude,
        delivery_accuracy_meters, delivery_location_captured_at, created_at, updated_at
      )
      VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId, j.token, j.customerUserId, j.printType, j.copies, j.pageRange, j.paperSize,
      j.layout, j.pagesPerSheet, j.margins, j.scale, j.duplex, j.pageCount, j.pricePaise,
      j.needsConversion, j.queuePosition, j.deliveryMethod, j.customerName, j.customerPhone,
      j.deliveryAddress, j.deliveryPincode, j.deliveryArea, j.deliveryFeePaise, j.deliveryLatitude, j.deliveryLongitude,
      j.deliveryAccuracyMeters, j.deliveryLocationCapturedAt, now, now
    );

    const insertFile = sqlite.prepare(`
      INSERT INTO job_files (id, job_id, original_name, stored_name, mime_type, size_bytes, file_kind, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    filesData.forEach((fd, i) => {
      // Offset each file's created_at by i ms so multi-file batches (which all
      // share the same wall-clock "now") still sort by insertion order via
      // `ORDER BY created_at ASC, id ASC` — file ids are random UUIDs, so id
      // alone can't be relied on as a tiebreaker across a shared timestamp.
      const fileCreatedAt = new Date(Date.parse(now) + i).toISOString();
      insertFile.run(
        fileIds[i], jobId,
        fd.originalName ?? fd.original_name,
        fd.storedName ?? fd.stored_name,
        fd.mimeType ?? fd.mime_type,
        fd.sizeBytes ?? fd.size_bytes,
        fd.fileKind ?? fd.file_kind,
        fd.storagePath ?? fd.storage_path,
        fileCreatedAt
      );
    });

    sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'created', ?, ?)")
      .run(crypto.randomUUID(), jobId, firstKind === 'document' ? 'Document upload needs conversion before printing.' : 'Customer submitted job.', now);
  })();

  return { jobId, fileIds };
}

export async function getJobFilesByJob(jobId: string): Promise<JobFile[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobFilesByJob(jobId);
  }
  const sqlite = await getDbInstance();
  const rows = sqlite
    .prepare('SELECT * FROM job_files WHERE job_id = ? ORDER BY created_at ASC, id ASC')
    .all(jobId) as Record<string, unknown>[];
  return rows.map(mapJobFile);
}

export async function createJob(jobData: any, fileData: any): Promise<{ jobId: string; fileId: string }> {
  const { jobId, fileIds } = await createJobWithFiles(jobData, [fileData]);
  return { jobId, fileId: fileIds[0] };
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

// Delivery hand-off status, tracked independently of the print-progress
// `status` column — mirrors how `paidAt` is decoupled from `status`. Only
// ever set on delivery-method jobs; the API route enforces that.
export async function updateDeliveryStatus(
  id: string,
  deliveryStatus: "packed" | "picked_up" | "out_for_delivery" | "delivered",
  deliveryPersonId?: string
): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateDeliveryStatus(id, deliveryStatus, deliveryPersonId);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  if (deliveryPersonId) {
    sqlite.prepare(`UPDATE jobs SET delivery_status = ?, delivery_person_id = ?, updated_at = ? WHERE id = ?`)
      .run(deliveryStatus, deliveryPersonId, now, id);
  } else {
    sqlite.prepare(`UPDATE jobs SET delivery_status = ?, updated_at = ? WHERE id = ?`).run(deliveryStatus, now, id);
  }
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, deliveryStatus, `Delivery status set to ${deliveryStatus}.`, now);
}

// Customer-facing: flags a job for staff attention from the public /track
// page (failed/cancelled state only — enforced by the API route, not here).
// Idempotent — a second report just refreshes the note rather than stacking.
export async function reportJobIssue(token: string, note: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.reportJobIssue(token, note);
  }
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const job = sqlite.prepare('SELECT id FROM jobs WHERE token = ?').get(token) as { id: string } | undefined;
  if (!job) throw new Error('Job not found');
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE jobs SET issue_reported_at = ?, issue_note = ?, issue_resolved_at = NULL, updated_at = ? WHERE id = ?`)
    .run(now, note, now, job.id);
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'customer_report', ?, ?)")
    .run(crypto.randomUUID(), job.id, note, now);
}

// Admin: clears the flag once staff has dealt with it.
export async function resolveJobIssue(id: string): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.resolveJobIssue(id);
  }
  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE jobs SET issue_resolved_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'issue_resolved', 'Staff resolved the reported issue.', ?)")
    .run(crypto.randomUUID(), id, now);
}

// Payment is tracked independently of print-progress status — a job can be
// released/printed before it's paid (pay-at-counter-after-print flow), so
// marking paid only ever touches paid_at, never the status column.
export async function markJobPaid(id: string, via: "online" | "counter" = "counter"): Promise<{ paidAt: string }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.markJobPaid(id, via);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE jobs SET paid_at = COALESCE(paid_at, ?), paid_via = COALESCE(paid_via, ?), updated_at = ? WHERE id = ?`).run(now, via, now, id);
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, 'paid', `Marked as paid (${via}).`, now);
  const row = sqlite.prepare(`SELECT paid_at FROM jobs WHERE id = ?`).get(id) as { paid_at: string };
  return { paidAt: row.paid_at };
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
  duplex: string;
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
        pages_per_sheet = ?, margins = ?, scale = ?, duplex = ?, price_paise = ?, updated_at = ?
    WHERE id = ?
  `).run(
    settings.printType, settings.copies, settings.pageRange, settings.paperSize, settings.layout,
    settings.pagesPerSheet, settings.margins, settings.scale, settings.duplex, settings.pricePaise, settings.updatedAt, id
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
  const row = sqlite.prepare('SELECT * FROM pricing_config WHERE id = 1').get() as Record<string, number | string> | undefined;
  if (!row) throw new Error('Pricing config not found. Run "npm run db:seed".');
  pricingCache = {
    bwPerPagePaise: row.bw_per_page_paise as number,
    colorPerPagePaise: row.color_per_page_paise as number,
    photoPrintPaise: row.photo_print_paise as number,
    copyMultiplier: row.copy_multiplier as number,
    a3Multiplier: (row.a3_multiplier as number) ?? 2.5,
    a4Multiplier: (row.a4_multiplier as number) ?? 1,
    a5Multiplier: (row.a5_multiplier as number) ?? 0.7,
    a6Multiplier: (row.a6_multiplier as number) ?? 0.5,
    b5Multiplier: (row.b5_multiplier as number) ?? 0.9,
    legalMultiplier: (row.legal_multiplier as number) ?? 1.25,
    photoMultiplier: (row.photo_multiplier as number) ?? 1,
    duplexBwPerPagePaise: (row.duplex_bw_per_page_paise as number) ?? 100,
    expiryMinutes: (row.expiry_minutes as number) ?? 1440,
    deliveryFeePaise: (row.delivery_fee_paise as number) ?? 0,
    serviceArea: parseServiceAreaConfig(row.service_area_config as string)
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
      duplex_bw_per_page_paise = ?, expiry_minutes = ?, delivery_fee_paise = ?, service_area_config = ?, updated_at = ?
    WHERE id = 1
  `).run(
    pricing.bwPerPagePaise, pricing.colorPerPagePaise, pricing.photoPrintPaise,
    pricing.copyMultiplier, pricing.a3Multiplier, pricing.a4Multiplier, pricing.a5Multiplier,
    pricing.a6Multiplier, pricing.b5Multiplier, pricing.legalMultiplier, pricing.photoMultiplier,
    pricing.duplexBwPerPagePaise, pricing.expiryMinutes, pricing.deliveryFeePaise,
    serializeServiceAreaConfig(pricing.serviceArea), now
  );
}

const RETENTION_DEFAULTS: RetentionConfig = {
  cartAbandonMinutes: CART_ABANDON_MINUTES,
  fileRetentionDays: FILE_RETENTION_DAYS,
  strayFileRetentionHours: STRAY_FILE_RETENTION_HOURS,
  loginEventRetentionDays: LOGIN_EVENT_RETENTION_DAYS,
};

export async function getRetentionConfig(): Promise<RetentionConfig> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getRetentionConfig();
  }

  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT * FROM retention_config WHERE id = 1').get() as Record<string, number> | undefined;
  if (!row) return RETENTION_DEFAULTS;

  return {
    cartAbandonMinutes: row.cart_abandon_minutes ?? RETENTION_DEFAULTS.cartAbandonMinutes,
    fileRetentionDays: row.file_retention_days ?? RETENTION_DEFAULTS.fileRetentionDays,
    strayFileRetentionHours: row.stray_file_retention_hours ?? RETENTION_DEFAULTS.strayFileRetentionHours,
    loginEventRetentionDays: row.login_event_retention_days ?? RETENTION_DEFAULTS.loginEventRetentionDays,
  };
}

export async function updateRetentionConfig(config: RetentionConfig): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateRetentionConfig(config);
  }

  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retention_config (id, cart_abandon_minutes, file_retention_days, stray_file_retention_hours, login_event_retention_days, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      cart_abandon_minutes = excluded.cart_abandon_minutes,
      file_retention_days = excluded.file_retention_days,
      stray_file_retention_hours = excluded.stray_file_retention_hours,
      login_event_retention_days = excluded.login_event_retention_days,
      updated_at = excluded.updated_at
  `).run(
    config.cartAbandonMinutes, config.fileRetentionDays, config.strayFileRetentionHours,
    config.loginEventRetentionDays, now
  );
}

export async function getAgentConfig() {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentConfig();
  }

  const sqlite = await getDbInstance();
  const row = sqlite.prepare('SELECT printer_name, bw_printer_name, color_printer_name, config_version FROM agent_config WHERE id = 1')
    .get() as { printer_name: string; bw_printer_name: string | null; color_printer_name: string | null; config_version: number } | undefined;
  if (!row) return { printerName: 'Microsoft Print to PDF', bwPrinterName: '', colorPrinterName: '', configVersion: 0 };
  return {
    printerName: row.printer_name,
    bwPrinterName: row.bw_printer_name || row.printer_name,
    colorPrinterName: row.color_printer_name || row.printer_name,
    configVersion: row.config_version
  };
}

export async function updateAgentConfig(printers: { bwPrinterName?: string; colorPrinterName?: string }): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateAgentConfig(printers);
  }

  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  const current = sqlite.prepare('SELECT bw_printer_name, color_printer_name FROM agent_config WHERE id = 1')
    .get() as { bw_printer_name: string | null; color_printer_name: string | null } | undefined;
  const bwPrinterName = printers.bwPrinterName ?? current?.bw_printer_name ?? '';
  const colorPrinterName = printers.colorPrinterName ?? current?.color_printer_name ?? '';
  sqlite.prepare(`
    UPDATE agent_config
    SET bw_printer_name = ?, color_printer_name = ?, printer_name = ?, config_version = config_version + 1, updated_at = ?
    WHERE id = 1
  `).run(bwPrinterName, colorPrinterName, bwPrinterName || colorPrinterName, now);
}

export async function replaceAgentPrinters(printers: Array<Omit<PrinterOption, 'seenAt'>>): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.replaceAgentPrinters(printers);
  }
  
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  sqlite.transaction(() => {
    // Upsert (not delete-all) so multiple agents sharing this DB don't wipe each
    // other's printers — the admin sees the union of all live machines.
    const upsert = sqlite.prepare(`
      INSERT INTO agent_printers (name, driver_name, port_name, is_default, can_duplex, seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        driver_name = excluded.driver_name,
        port_name = excluded.port_name,
        is_default = excluded.is_default,
        can_duplex = excluded.can_duplex,
        seen_at = excluded.seen_at
    `);
    for (const printer of printers) {
      upsert.run(printer.name, printer.driverName, printer.portName, printer.isDefault ? 1 : 0, printer.canDuplex ? 1 : 0, now);
    }
    // Drop printers no agent has reported for 5 min (machine offline / removed).
    sqlite.prepare('DELETE FROM agent_printers WHERE seen_at < ?').run(cutoff);
  })();
}

export async function getAgentPrinters(): Promise<PrinterOption[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentPrinters();
  }
  
  const sqlite = await getDbInstance();
  // Hide printers no agent has reported recently (stale machine).
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const rows = sqlite.prepare(`
    SELECT name, driver_name, port_name, is_default, can_duplex, seen_at
    FROM agent_printers
    WHERE seen_at >= ?
    ORDER BY is_default DESC, name COLLATE NOCASE ASC
  `).all(cutoff) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name),
    driverName: String(row.driver_name),
    portName: String(row.port_name),
    isDefault: Boolean(row.is_default),
    canDuplex: Boolean(row.can_duplex),
    seenAt: String(row.seen_at)
  }));
}

export async function getAgentToken(rawToken: string) {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAgentToken(rawToken);
  }

  const sqlite = await getDbInstance();
  const { verifyToken } = await import('./token-hash');
  const rows = sqlite.prepare('SELECT token_hash FROM agent_tokens').all() as Array<{ token_hash: string }>;
  return rows.find((row) => verifyToken(rawToken, row.token_hash)) || null;
}

// Daily-reset serial: #1 is the first job created after UTC midnight, not a
// global ever-climbing ticket number. Matches the familiar shop-counter feel
// and keeps the number small/meaningful for staff and customers.
export async function nextQueuePosition(): Promise<number> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.nextQueuePosition();
  }

  const sqlite = await getDbInstance();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = sqlite.prepare('SELECT COALESCE(MAX(queue_position), 0) + 1 as pos FROM jobs WHERE created_at >= ?')
    .get(todayStart.toISOString()) as { pos: number };
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

// Deletes abandoned unpaid carts (never became a real order) and purges the
// uploaded file bytes — but NOT the job row — of finished orders once they're
// past FILE_RETENTION_DAYS old. The job row and job_files metadata row (name,
// size, page count) are kept forever so order history and receipts still work
// after the file is gone; only storage bytes are deleted for privacy.
// Also resets jobs stuck in "printing" for > PRINTING_LEASE_MINUTES back to "approved"
// so they can be retried automatically after an agent crash.
const PRINTING_LEASE_MINUTES = 10;

export async function cleanupOldJobs(): Promise<{ deleted: number; storagePaths: string[] }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.cleanupOldJobs();
  }

  const sqlite = await getDbInstance();
  const retention = await getRetentionConfig();
  const abandonedCutoff = new Date(Date.now() - retention.cartAbandonMinutes * 60000).toISOString();
  const leaseCutoff = new Date(Date.now() - PRINTING_LEASE_MINUTES * 60000).toISOString();
  const fileRetentionCutoff = new Date(Date.now() - retention.fileRetentionDays * 24 * 60 * 60000).toISOString();
  const now = new Date().toISOString();

  // Reset stale "printing" leases — agent crashed before completing.
  sqlite.prepare(`
    UPDATE jobs SET status = 'approved', updated_at = ?
    WHERE status = 'printing' AND updated_at < ?
  `).run(now, leaseCutoff);

  const storagePaths: string[] = [];

  // 1) Abandoned unpaid carts: no order was ever placed, so the whole row goes.
  const abandoned = sqlite.prepare(`
    SELECT id FROM jobs WHERE status = 'pending_payment' AND created_at < ? AND paid_at IS NULL
  `).all(abandonedCutoff) as Array<{ id: string }>;
  const abandonedIds = abandoned.map((r) => r.id);
  for (const idBatch of chunk(abandonedIds, 200)) {
    const placeholders = idBatch.map(() => '?').join(',');
    const files = sqlite
      .prepare(`SELECT storage_path FROM job_files WHERE job_id IN (${placeholders})`)
      .all(...idBatch) as Array<{ storage_path: string }>;
    storagePaths.push(...files.map((f) => f.storage_path));
    sqlite.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...idBatch);
  }

  // 2) Privacy purge: finished orders (printed/cancelled/failed, and delivery
  // orders only once actually delivered) older than FILE_RETENTION_DAYS lose
  // their file bytes. Row + job_files metadata stay for history/receipts.
  const purgeTargets = sqlite.prepare(`
    SELECT jf.id AS file_id, jf.storage_path FROM job_files jf
    JOIN jobs j ON j.id = jf.job_id
    WHERE jf.purged_at IS NULL AND jf.storage_path <> '' AND j.created_at < ?
      AND j.status IN ('printed', 'cancelled', 'failed')
      AND NOT (
        j.delivery_method = 'delivery' AND j.status = 'printed'
        AND (j.delivery_status IS NULL OR j.delivery_status <> 'delivered')
      )
  `).all(fileRetentionCutoff) as Array<{ file_id: string; storage_path: string }>;

  if (purgeTargets.length > 0) {
    storagePaths.push(...purgeTargets.map((f) => f.storage_path));
    const purgeStmt = sqlite.prepare(`UPDATE job_files SET storage_path = '', purged_at = ? WHERE id = ?`);
    sqlite.transaction((rows: typeof purgeTargets) => {
      for (const r of rows) purgeStmt.run(now, r.file_id);
    })(purgeTargets);
  }

  return { deleted: abandonedIds.length, storagePaths };
}

export async function logCleanupRun(counts: {
  deletedJobs: number;
  jobFilesRemoved: number;
  strayFilesRemoved: number;
}): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.logCleanupRun(counts);
  }
  const sqlite = await getDbInstance();
  sqlite.prepare(`
    INSERT INTO cleanup_events (id, ran_at, deleted_jobs, job_files_removed, stray_files_removed)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), new Date().toISOString(), counts.deletedJobs, counts.jobFilesRemoved, counts.strayFilesRemoved);
}

export async function filterActiveStoragePaths(paths: string[]): Promise<Set<string>> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.filterActiveStoragePaths(paths);
  }
  if (paths.length === 0) return new Set();
  const sqlite = await getDbInstance();
  const active = new Set<string>();
  
  for (const pathBatch of chunk(paths, 100)) {
    const placeholders = pathBatch.map(() => '?').join(',');
    const stmt = sqlite.prepare(`SELECT storage_path FROM job_files WHERE storage_path IN (${placeholders})`);
    const rows = stmt.all(...pathBatch) as { storage_path: string }[];
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
  const pricing = await getPricing();
  const rows = sqlite
    .prepare("SELECT * FROM jobs WHERE needs_conversion = 1 ORDER BY created_at ASC")
    .all() as Record<string, unknown>[];
  // NOT rows.map(mapJob) — map would pass the array index as expiryMinutes.
  return rows.map(row => mapJob(row, pricing.expiryMinutes));
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

// ─── Analytics / Accounts ────────────────────────────────────────────────────

import type { DailyJobSummary, AccountsSummary } from './types';

export async function getDailyAnalytics(from: string, to: string): Promise<DailyJobSummary[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getDailyAnalytics(from, to);
  }

  // SQLite fallback
  const sqlite = await getDbInstance();
  const fromTs = `${from}T00:00:00.000Z`;
  const toTs   = `${to}T23:59:59.999Z`;
  const rows = sqlite.prepare(
    `SELECT created_at, status, print_type, paper_size, page_count, price_paise, paid_at
     FROM jobs
     WHERE created_at >= ? AND created_at <= ?
     ORDER BY created_at ASC`
  ).all(fromTs, toTs) as any[];

  const byDate: Record<string, DailyJobSummary> = {};
  for (const row of rows) {
    const date = String(row.created_at).slice(0, 10);
    if (!byDate[date]) {
      byDate[date] = { date, totalJobs: 0, totalRevenuePaise: 0, confirmedRevenuePaise: 0,
        bwJobs: 0, colorJobs: 0, photoJobs: 0, pagesTotal: 0, printedJobs: 0, cancelledJobs: 0, pendingJobs: 0 };
    }
    const d = byDate[date];
    const pricePaise = Number(row.price_paise) || 0;
    const pages      = Number(row.page_count)  || 0;
    const status     = String(row.status);
    const printType  = String(row.print_type);

    d.totalJobs++;
    d.totalRevenuePaise += pricePaise;
    d.pagesTotal += pages;
    if (row.paid_at) d.confirmedRevenuePaise += pricePaise;
    if (status === 'printed')          d.printedJobs++;
    if (status === 'cancelled')        d.cancelledJobs++;
    if (status === 'pending_payment')  d.pendingJobs++;
    // Photo is a paper size, not a print type — classify it first so photo
    // jobs aren't miscounted as bw/color.
    if (String(row.paper_size) === 'Photo') d.photoJobs++;
    else if (printType === 'color')         d.colorJobs++;
    else                                    d.bwJobs++;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAccountsSummary(date?: string): Promise<AccountsSummary> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getAccountsSummary(date);
  }

  const day = date ?? new Date().toISOString().slice(0, 10);
  const rows = await getDailyAnalytics(day, day);
  const d = rows[0];
  if (!d) {
    return { totalRevenuePaise: 0, confirmedRevenuePaise: 0, pendingRevenuePaise: 0,
      totalJobs: 0, printedJobs: 0, totalPages: 0, bwJobs: 0, colorJobs: 0, photoJobs: 0 };
  }
  return {
    totalRevenuePaise: d.totalRevenuePaise,
    confirmedRevenuePaise: d.confirmedRevenuePaise,
    pendingRevenuePaise: d.totalRevenuePaise - d.confirmedRevenuePaise,
    totalJobs: d.totalJobs,
    printedJobs: d.printedJobs,
    totalPages: d.pagesTotal,
    bwJobs: d.bwJobs,
    colorJobs: d.colorJobs,
    photoJobs: d.photoJobs,
  };
}
