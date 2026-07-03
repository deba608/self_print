import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import type { Job, JobFile, PricingConfig, PrinterOption, SseClient } from './types';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export const sseClients = new Set<SseClient>();

// Helper to convert Supabase row to Job type
function mapJob(row: any, expiryMinutes: number = 1440): Job {
  const createdAt = String(row.created_at);
  const expiresAt = new Date(new Date(createdAt).getTime() + expiryMinutes * 60000).toISOString();
  
  return {
    id: String(row.id),
    token: String(row.token),
    status: row.status,
    printType: row.print_type,
    copies: Number(row.copies),
    pageRange: row.page_range ? String(row.page_range) : null,
    paperSize: row.paper_size,
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
    printedAt: row.printed_at ? String(row.printed_at) : null,
    expiresAt
  };
}

// Helper to convert Supabase row to JobFile type
function mapJobFile(row: any): JobFile {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    fileKind: row.file_kind,
    storagePath: String(row.storage_path),
    createdAt: String(row.created_at)
  };
}

export async function getDb() {
  // Return a mock object that matches the SQLite interface
  return {
    prepare: (sql: string) => ({
      get: async (...args: any[]) => {
        // This is a simplified version - full implementation would parse SQL
        throw new Error('Use Supabase-specific methods instead');
      },
      run: async (...args: any[]) => {
        throw new Error('Use Supabase-specific methods instead');
      },
      all: async (...args: any[]) => {
        throw new Error('Use Supabase-specific methods instead');
      }
    }),
    exec: async (sql: string) => {
      throw new Error('Use Supabase-specific methods instead');
    },
    transaction: (fn: Function) => {
      return async () => {
        await fn();
      };
    },
    pragma: (query: string) => {
      return null;
    }
  };
}

// Supabase-specific methods
export async function getJobs() {
  const [{ data, error }, pricing] = await Promise.all([
    supabase.from('jobs').select('*').order('created_at', { ascending: false }),
    getPricing()
  ]);
  if (error) throw error;
  return (data || []).map(row => mapJob(row, pricing.expiryMinutes));
}

export async function getJobsPage(limit: number, cursor?: string | null): Promise<{ jobs: Job[]; total: number }> {
  let query = supabase
    .from('jobs')
    .select('*, job_files(*)', { count: 'estimated' })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const pricing = await getPricing();
  const jobs = (data || []).map(row => {
    const job = mapJob(row, pricing.expiryMinutes);
    if (row.job_files && Array.isArray(row.job_files) && row.job_files.length > 0) {
      job.file = mapJobFile(row.job_files[0]);
    }
    return job;
  });

  return { jobs, total: count ?? 0 };
}

export async function getJobFilesForJobs(jobIds: string[]): Promise<Record<string, JobFile>> {
  if (jobIds.length === 0) return {};
  const { data, error } = await supabase
    .from('job_files')
    .select('*')
    .in('job_id', jobIds);

  if (error) throw error;
  const map: Record<string, JobFile> = {};
  for (const row of data || []) map[String(row.job_id)] = mapJobFile(row);
  return map;
}

export async function getJobById(id: string) {
  const [{ data, error }, pricing] = await Promise.all([
    supabase.from('jobs').select('*').eq('id', id).single(),
    getPricing()
  ]);
  if (error) throw error;
  return mapJob(data, pricing.expiryMinutes);
}

export async function getJobByToken(token: string) {
  const [{ data, error }, pricing] = await Promise.all([
    supabase.from('jobs').select('*').eq('token', token).single(),
    getPricing()
  ]);
  if (error) throw error;
  return mapJob(data, pricing.expiryMinutes);
}

export async function getNextApprovedJob() {
  const [{ data, error }, pricing] = await Promise.all([
    supabase.from('jobs').select('*').eq('status', 'approved').eq('needs_conversion', 0)
      .order('updated_at', { ascending: true }).limit(1).single(),
    getPricing()
  ]);
  if (error && (error as any).code !== 'PGRST116') throw error; // PGRST116 = not found
  return data ? mapJob(data, pricing.expiryMinutes) : null;
}

export async function getJobFile(jobId: string) {
  const { data, error } = await supabase
    .from('job_files')
    .select('*')
    .eq('job_id', jobId)
    .single();
  
  if (error) throw error;
  return mapJobFile(data);
}

export async function getJobFileById(fileId: string) {
  const { data, error } = await supabase
    .from('job_files')
    .select('*')
    .eq('id', fileId)
    .single();
  
  if (error) throw error;
  return mapJobFile(data);
}

export async function getJobEvents(jobId: string) {
  const { data, error } = await supabase
    .from('print_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  
  if (error) throw error;
  return data || [];
}

export async function createJob(jobData: any, fileData: any) {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const normalizedJobData = {
    token: jobData.token,
    status: jobData.status ?? 'pending_payment',
    print_type: jobData.print_type ?? jobData.printType,
    copies: jobData.copies,
    page_range: jobData.page_range ?? jobData.pageRange,
    paper_size: jobData.paper_size ?? jobData.paperSize,
    layout: jobData.layout,
    pages_per_sheet: jobData.pages_per_sheet ?? jobData.pagesPerSheet,
    margins: jobData.margins,
    scale: jobData.scale,
    duplex: jobData.duplex ?? 'simplex',
    page_count: jobData.page_count ?? jobData.pageCount,
    price_paise: jobData.price_paise ?? jobData.pricePaise,
    needs_conversion: jobData.needs_conversion ?? jobData.needsConversion,
    queue_position: jobData.queue_position ?? jobData.queuePosition
  };
  const normalizedFileData = {
    original_name: fileData.original_name ?? fileData.originalName,
    stored_name: fileData.stored_name ?? fileData.storedName,
    mime_type: fileData.mime_type ?? fileData.mimeType,
    size_bytes: fileData.size_bytes ?? fileData.sizeBytes,
    file_kind: fileData.file_kind ?? fileData.fileKind,
    storage_path: fileData.storage_path ?? fileData.storagePath
  };
  
  // Insert job
  const { error: jobError } = await supabase
    .from('jobs')
    .insert([{
      id: jobId,
      ...normalizedJobData,
      created_at: now,
      updated_at: now
    }]);
  
  if (jobError) throw jobError;
  
  // Insert job file
  const { error: fileError } = await supabase
    .from('job_files')
    .insert([{
      id: fileId,
      job_id: jobId,
      ...normalizedFileData,
      created_at: now
    }]);
  
  if (fileError) throw fileError;
  
  // Insert print event
  await supabase
    .from('print_events')
    .insert([{
      id: crypto.randomUUID(),
      job_id: jobId,
      event_type: 'created',
      message: normalizedFileData.file_kind === 'document' 
        ? 'Document upload needs conversion before printing.'
        : 'Customer submitted job.',
      created_at: now
    }]);
  
  return { jobId, fileId };
}

export async function updateJobStatus(id: string, status: string) {
  const now = new Date().toISOString();
  const updates: any = { status, updated_at: now };
  
  if (status === 'paid') updates.paid_at = now;
  if (status === 'printed') updates.printed_at = now;
  
  const { error } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', id);
  
  if (error) throw error;
  
  // Insert print event
  await supabase
    .from('print_events')
    .insert([{
      id: crypto.randomUUID(),
      job_id: id,
      event_type: status,
      message: `Admin set status to ${status}.`,
      created_at: now
    }]);
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
}) {
  const { error } = await supabase
    .from('jobs')
    .update({
      print_type: settings.printType,
      copies: settings.copies,
      page_range: settings.pageRange,
      paper_size: settings.paperSize,
      layout: settings.layout,
      pages_per_sheet: settings.pagesPerSheet,
      margins: settings.margins,
      scale: settings.scale,
      duplex: settings.duplex,
      price_paise: settings.pricePaise,
      updated_at: settings.updatedAt
    })
    .eq('id', id);
  
  if (error) throw error;
  
  // Insert print event
  await supabase
    .from('print_events')
    .insert([{
      id: crypto.randomUUID(),
      job_id: id,
      event_type: 'settings',
      message: `Admin updated print settings.`,
      created_at: settings.updatedAt
    }]);
}

const PRICING_DEFAULTS: PricingConfig = {
  bwPerPagePaise: 200,
  colorPerPagePaise: 800,
  photoPrintPaise: 1500,
  copyMultiplier: 1.0,
  a3Multiplier: 2.5,
  a4Multiplier: 1.0,
  a5Multiplier: 0.7,
  a6Multiplier: 0.5,
  b5Multiplier: 0.9,
  legalMultiplier: 1.25,
  photoMultiplier: 1.0,
  duplexMultiplier: 0.9,
  expiryMinutes: 1440,
};

export async function getPricing(): Promise<PricingConfig> {
  const { data, error } = await supabase
    .from('pricing_config')
    .select('*')
    .eq('id', 1)
    .single();

  // PGRST116 = no rows — return defaults so the app works even if not seeded
  if (error) {
    if ((error as any).code === 'PGRST116') return PRICING_DEFAULTS;
    throw error;
  }

  return {
    bwPerPagePaise: data.bw_per_page_paise ?? PRICING_DEFAULTS.bwPerPagePaise,
    colorPerPagePaise: data.color_per_page_paise ?? PRICING_DEFAULTS.colorPerPagePaise,
    photoPrintPaise: data.photo_print_paise ?? PRICING_DEFAULTS.photoPrintPaise,
    copyMultiplier: data.copy_multiplier ?? PRICING_DEFAULTS.copyMultiplier,
    a3Multiplier: data.a3_multiplier ?? PRICING_DEFAULTS.a3Multiplier,
    a4Multiplier: data.a4_multiplier ?? PRICING_DEFAULTS.a4Multiplier,
    a5Multiplier: data.a5_multiplier ?? PRICING_DEFAULTS.a5Multiplier,
    a6Multiplier: data.a6_multiplier ?? PRICING_DEFAULTS.a6Multiplier,
    b5Multiplier: data.b5_multiplier ?? PRICING_DEFAULTS.b5Multiplier,
    legalMultiplier: data.legal_multiplier ?? PRICING_DEFAULTS.legalMultiplier,
    photoMultiplier: data.photo_multiplier ?? PRICING_DEFAULTS.photoMultiplier,
    duplexMultiplier: data.duplex_multiplier ?? PRICING_DEFAULTS.duplexMultiplier,
    expiryMinutes: data.expiry_minutes ?? PRICING_DEFAULTS.expiryMinutes,
  };
}

export async function updatePricing(pricing: PricingConfig) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('pricing_config')
    .update({
      bw_per_page_paise: pricing.bwPerPagePaise,
      color_per_page_paise: pricing.colorPerPagePaise,
      photo_print_paise: pricing.photoPrintPaise,
      copy_multiplier: pricing.copyMultiplier,
      a3_multiplier: pricing.a3Multiplier,
      a4_multiplier: pricing.a4Multiplier,
      a5_multiplier: pricing.a5Multiplier,
      a6_multiplier: pricing.a6Multiplier,
      b5_multiplier: pricing.b5Multiplier,
      legal_multiplier: pricing.legalMultiplier,
      photo_multiplier: pricing.photoMultiplier,
      duplex_multiplier: pricing.duplexMultiplier,
      expiry_minutes: pricing.expiryMinutes,
      updated_at: now
    })
    .eq('id', 1);
  
  if (error) throw error;
}

export async function getAgentConfig() {
  const { data, error } = await supabase
    .from('agent_config')
    .select('printer_name, config_version')
    .eq('id', 1)
    .single();
  
  if (error) return { printerName: 'Microsoft Print to PDF', configVersion: 0 };
  return { printerName: data.printer_name, configVersion: data.config_version };
}

export async function updateAgentConfig(printerName: string) {
  const now = new Date().toISOString();
  const current = await getAgentConfig();
  const { error } = await supabase
    .from('agent_config')
    .update({
      printer_name: printerName,
      config_version: Number(current.configVersion ?? 0) + 1,
      updated_at: now
    })
    .eq('id', 1);
  
  if (error) throw error;
}

export async function replaceAgentPrinters(printers: Array<Omit<PrinterOption, 'seenAt'>>) {
  const now = new Date().toISOString();

  // Upsert (not delete-all) so multiple agents sharing this DB don't wipe each
  // other's printers — the admin sees the union of all live machines.
  if (printers.length > 0) {
    const { error } = await supabase
      .from('agent_printers')
      .upsert(
        printers.map(p => ({
          name: p.name,
          driver_name: p.driverName,
          port_name: p.portName,
          is_default: p.isDefault ? 1 : 0,
          seen_at: now
        })),
        { onConflict: 'name' }
      );

    if (error) throw error;
  }

  // Drop printers no agent has reported for 5 min (machine offline / removed).
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase.from('agent_printers').delete().lt('seen_at', cutoff);
}

export async function getAgentPrinters(): Promise<PrinterOption[]> {
  // Hide printers no agent has reported recently (stale machine).
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('agent_printers')
    .select('*')
    .gte('seen_at', cutoff)
    .order('is_default', { ascending: false })
    .order('name');

  if (error) throw error;
  
  return (data || []).map(row => ({
    name: String(row.name),
    driverName: String(row.driver_name),
    portName: String(row.port_name),
    isDefault: Boolean(row.is_default),
    seenAt: String(row.seen_at)
  }));
}

export async function getAdminUser(username: string) {
  const { data, error } = await supabase
    .from('admin_users')
    .select('*')
    .eq('username', username)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function getAgentToken(rawToken: string) {
  const { data, error } = await supabase
    .from('agent_tokens')
    .select('token_hash');

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const { verifySecret } = await import('./security');
  for (const row of data) {
    if (verifySecret(rawToken, row.token_hash)) return row;
  }
  return null;
}

export async function nextQueuePosition(): Promise<number> {
  const { data, error } = await supabase
    .from('jobs')
    .select('queue_position')
    .order('queue_position', { ascending: false })
    .limit(1)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data ? Number(data.queue_position) + 1 : 1;
}

export async function getJobSummary() {
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('price_paise, status');
  
  if (jobsError) throw jobsError;
  
  const totalPaise = jobs?.reduce((sum, j) => sum + Number(j.price_paise), 0) || 0;
  const activeJobs = jobs?.filter(j => !['printed', 'cancelled', 'failed'].includes(j.status)).length || 0;
  
  return { jobs: activeJobs, totalPaise };
}

export async function deleteJob(id: string) {
  const { error } = await supabase
    .from('jobs')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

export async function bulkDeleteJobs(ids: string[]) {
  const { error } = await supabase
    .from('jobs')
    .delete()
    .in('id', ids);
  
  if (error) throw error;
}

const PRINTING_LEASE_MINUTES = 10;

export async function cleanupOldJobs(): Promise<{ deleted: number; storagePaths: string[] }> {
  const pricing = await getPricing();
  const cutoff = new Date(Date.now() - pricing.expiryMinutes * 60000).toISOString();
  const leaseCutoff = new Date(Date.now() - PRINTING_LEASE_MINUTES * 60000).toISOString();

  // Reset stale "printing" leases — agent crashed before completing.
  await supabase
    .from('jobs')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('status', 'printing')
    .lt('updated_at', leaseCutoff);

  // Find jobs to remove: finished, or unpaid past expiry.
  const { data: finished, error: finErr } = await supabase
    .from('jobs')
    .select('id')
    .in('status', ['printed', 'cancelled', 'failed']);
  if (finErr) throw finErr;

  const { data: expired, error: expErr } = await supabase
    .from('jobs')
    .select('id')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff);
  if (expErr) throw expErr;

  const ids = Array.from(new Set([...(finished || []), ...(expired || [])].map((r) => String(r.id))));
  if (ids.length === 0) return { deleted: 0, storagePaths: [] };

  const { data: files, error: fileErr } = await supabase
    .from('job_files')
    .select('storage_path')
    .in('job_id', ids);
  if (fileErr) throw fileErr;
  const storagePaths = (files || []).map((f) => String(f.storage_path));

  const { error: delErr } = await supabase.from('jobs').delete().in('id', ids);
  if (delErr) throw delErr;

  return { deleted: ids.length, storagePaths };
}

export async function filterActiveStoragePaths(paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const active = new Set<string>();
  
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data, error } = await supabase
      .from('job_files')
      .select('storage_path')
      .in('storage_path', chunk);
    if (error) throw error;
    for (const row of data || []) {
      active.add(row.storage_path);
    }
  }
  return active;
}

export async function queueReprint(id: string) {
  const now = new Date().toISOString();
  
  const { error: jobError } = await supabase
    .from('jobs')
    .update({ status: 'approved', updated_at: now })
    .eq('id', id);
  
  if (jobError) throw jobError;
  
  const { error: eventError } = await supabase
    .from('print_events')
    .insert([{
      id: crypto.randomUUID(),
      job_id: id,
      event_type: 'reprint',
      message: 'Admin queued reprint.',
      created_at: now
    }]);
  
  if (eventError) throw eventError;
}

export async function getJobsNeedingConversion(): Promise<Job[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('needs_conversion', 1)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(mapJob);
}

export async function markJobConverted(
  jobId: string,
  fileId: string,
  file: { storedName: string; storagePath: string; sizeBytes: number; pageCount: number; pricePaise: number }
): Promise<void> {
  const now = new Date().toISOString();

  const { error: fileErr } = await supabase
    .from('job_files')
    .update({
      stored_name: file.storedName,
      storage_path: file.storagePath,
      size_bytes: file.sizeBytes,
      mime_type: 'application/pdf',
      file_kind: 'pdf'
    })
    .eq('id', fileId);
  if (fileErr) throw fileErr;

  const { error: jobErr } = await supabase
    .from('jobs')
    .update({ needs_conversion: 0, page_count: file.pageCount, price_paise: file.pricePaise, updated_at: now })
    .eq('id', jobId);
  if (jobErr) throw jobErr;

  await supabase.from('print_events').insert([{
    id: crypto.randomUUID(),
    job_id: jobId,
    event_type: 'converted',
    message: 'Document converted to PDF.',
    created_at: now
  }]);
}

export async function updateJobStatusByAgent(id: string, status: string, message?: string) {
  const now = new Date().toISOString();
  const updates: any = { status, updated_at: now };
  
  if (status === 'printed') updates.printed_at = now;
  
  const { error: jobError } = await supabase
    .from('jobs')
    .update(updates)
    .eq('id', id)
    .in('status', ['approved', 'printing']);
  
  if (jobError) throw jobError;
  
  const { error: eventError } = await supabase
    .from('print_events')
    .insert([{
      id: crypto.randomUUID(),
      job_id: id,
      event_type: status,
      message: message ?? '',
      created_at: now
    }]);
  
  if (eventError) throw eventError;
}
