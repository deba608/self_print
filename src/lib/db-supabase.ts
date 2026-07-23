import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import type { CustomerManagementRow, Job, JobFile, PricingConfig, PrinterOption, SseClient } from './types';

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
    customerUserId: row.customer_user_id ? String(row.customer_user_id) : null,
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
    deliveryFeePaise: Number(row.delivery_fee_paise ?? 0),
    deliveryStatus: row.delivery_status ? (row.delivery_status as Job['deliveryStatus']) : null,
    deliveryLatitude: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
    deliveryLongitude: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    deliveryAccuracyMeters: row.delivery_accuracy_meters == null ? null : Number(row.delivery_accuracy_meters),
    deliveryLocationCapturedAt: row.delivery_location_captured_at ? String(row.delivery_location_captured_at) : null
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

export async function getCustomerManagementRows(): Promise<CustomerManagementRow[]> {
  const [{ data: profiles, error: profileError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase
      .from('customer_profiles')
      .select('id, email, display_name, phone, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('jobs')
      .select('customer_user_id, customer_name, customer_phone, delivery_address, delivery_method, delivery_status, status, price_paise, paid_at, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);
  if (profileError) throw profileError;
  if (jobsError) throw jobsError;

  const customers = new Map<string, CustomerManagementRow>();
  for (const profile of profiles ?? []) {
    customers.set(String(profile.id), {
      id: String(profile.id),
      displayName: profile.display_name ? String(profile.display_name) : String(profile.email),
      email: String(profile.email),
      phone: profile.phone ? String(profile.phone) : null,
      registeredAt: String(profile.created_at),
      totalOrders: 0,
      activeOrders: 0,
      deliveryOrders: 0,
      deliveredOrders: 0,
      totalSpentPaise: 0,
      lastOrderAt: null,
      latestAddress: null,
    });
  }

  for (const row of jobs ?? []) {
    const userId = row.customer_user_id ? String(row.customer_user_id) : null;
    const phone = row.customer_phone ? String(row.customer_phone) : null;
    if (!userId && !phone) continue;
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
    const customer = customers.get(id)!;
    customer.totalOrders += 1;
    if (!["printed", "cancelled", "failed"].includes(String(row.status))) customer.activeOrders += 1;
    if (row.delivery_method === "delivery") customer.deliveryOrders += 1;
    if (row.delivery_status === "delivered") customer.deliveredOrders += 1;
    if (row.paid_at) customer.totalSpentPaise += Number(row.price_paise);
    const createdAt = String(row.created_at);
    if (!customer.lastOrderAt || createdAt > customer.lastOrderAt) {
      customer.lastOrderAt = createdAt;
      if (row.delivery_address) customer.latestAddress = String(row.delivery_address);
    }
  }

  return [...customers.values()].sort((a, b) => (b.lastOrderAt ?? b.registeredAt ?? "").localeCompare(a.lastOrderAt ?? a.registeredAt ?? ""));
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
    job.fileCount = Array.isArray(row.job_files) ? row.job_files.length : (job.file ? 1 : 0);
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

// Live count of active (not yet printed/cancelled/failed) jobs queued ahead
// of this one. queue_position itself is a fixed ticket number assigned once
// at creation (MAX+1) and never changes — it does NOT shrink as earlier jobs
// finish, so it's wrong to use directly for a "how many ahead of you" ETA.
export async function getJobsAhead(job: Job): Promise<number> {
  // queue_position resets daily (see nextQueuePosition), so "ahead" only
  // makes sense compared against jobs from the same calendar day.
  const dayStart = new Date(job.createdAt);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .lt('queue_position', job.queuePosition)
    .not('status', 'in', '("printed","cancelled","failed")')
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString());
  if (error) throw error;
  return count ?? 0;
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

export async function createJobWithFiles(jobData: any, filesData: any[]) {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileIds = filesData.map(() => crypto.randomUUID());

  const normalizedJobData = {
    token: jobData.token,
    status: jobData.status ?? 'pending_payment',
    customer_user_id: jobData.customer_user_id ?? jobData.customerUserId ?? null,
    print_type: jobData.print_type ?? jobData.printType,
    copies: jobData.copies,
    page_range: jobData.page_range ?? jobData.pageRange ?? null,
    paper_size: jobData.paper_size ?? jobData.paperSize,
    layout: jobData.layout,
    pages_per_sheet: jobData.pages_per_sheet ?? jobData.pagesPerSheet,
    margins: jobData.margins,
    scale: jobData.scale,
    duplex: jobData.duplex ?? 'simplex',
    page_count: jobData.page_count ?? jobData.pageCount,
    price_paise: jobData.price_paise ?? jobData.pricePaise,
    needs_conversion: jobData.needs_conversion ?? jobData.needsConversion,
    queue_position: jobData.queue_position ?? jobData.queuePosition,
    delivery_method: jobData.delivery_method ?? jobData.deliveryMethod ?? 'pickup',
    customer_name: jobData.customer_name ?? jobData.customerName ?? null,
    customer_phone: jobData.customer_phone ?? jobData.customerPhone ?? null,
    delivery_address: jobData.delivery_address ?? jobData.deliveryAddress ?? null,
    delivery_fee_paise: jobData.delivery_fee_paise ?? jobData.deliveryFeePaise ?? 0,
    delivery_latitude: jobData.delivery_latitude ?? jobData.deliveryLatitude ?? null,
    delivery_longitude: jobData.delivery_longitude ?? jobData.deliveryLongitude ?? null,
    delivery_accuracy_meters: jobData.delivery_accuracy_meters ?? jobData.deliveryAccuracyMeters ?? null,
    delivery_location_captured_at: jobData.delivery_location_captured_at ?? jobData.deliveryLocationCapturedAt ?? null,
  };

  const { error: jobError } = await supabase
    .from('jobs')
    .insert([{ id: jobId, ...normalizedJobData, created_at: now, updated_at: now }]);
  if (jobError) throw jobError;

  const fileRows = filesData.map((fd, i) => ({
    id: fileIds[i],
    job_id: jobId,
    original_name: fd.original_name ?? fd.originalName,
    stored_name: fd.stored_name ?? fd.storedName,
    mime_type: fd.mime_type ?? fd.mimeType,
    size_bytes: fd.size_bytes ?? fd.sizeBytes,
    file_kind: fd.file_kind ?? fd.fileKind,
    storage_path: fd.storage_path ?? fd.storagePath,
    // Offset each file's created_at by i ms so multi-file batches (which all
    // share the same wall-clock "now") still sort by insertion order via
    // `ORDER BY created_at ASC, id ASC` — file ids are random UUIDs, so id
    // alone can't be relied on as a tiebreaker across a shared timestamp.
    created_at: new Date(Date.parse(now) + i).toISOString(),
  }));
  const { error: fileError } = await supabase.from('job_files').insert(fileRows);
  if (fileError) throw fileError;

  const firstKind = fileRows[0]?.file_kind;
  await supabase.from('print_events').insert([{
    id: crypto.randomUUID(),
    job_id: jobId,
    event_type: 'created',
    message: firstKind === 'document'
      ? 'Document upload needs conversion before printing.'
      : 'Customer submitted job.',
    created_at: now,
  }]);

  return { jobId, fileIds };
}

export async function getJobFilesByJob(jobId: string): Promise<JobFile[]> {
  const { data, error } = await supabase
    .from('job_files')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapJobFile);
}

export async function createJob(jobData: any, fileData: any) {
  const { jobId, fileIds } = await createJobWithFiles(jobData, [fileData]);
  return { jobId, fileId: fileIds[0] };
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

export async function updateDeliveryStatus(id: string, deliveryStatus: 'out_for_delivery' | 'delivered'): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('jobs')
    .update({ delivery_status: deliveryStatus, updated_at: now })
    .eq('id', id);
  if (error) throw error;

  await supabase
    .from('print_events')
    .insert([{ id: crypto.randomUUID(), job_id: id, event_type: deliveryStatus, message: `Delivery status set to ${deliveryStatus}.`, created_at: now }]);
}

export async function reportJobIssue(token: string, note: string): Promise<void> {
  const { data: job, error: selError } = await supabase
    .from('jobs')
    .select('id')
    .eq('token', token)
    .single();
  if (selError || !job) throw new Error('Job not found');

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('jobs')
    .update({ issue_reported_at: now, issue_note: note, issue_resolved_at: null, updated_at: now })
    .eq('id', job.id);
  if (error) throw error;

  await supabase
    .from('print_events')
    .insert([{ id: crypto.randomUUID(), job_id: job.id, event_type: 'customer_report', message: note, created_at: now }]);
}

export async function resolveJobIssue(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('jobs')
    .update({ issue_resolved_at: now, updated_at: now })
    .eq('id', id);
  if (error) throw error;

  await supabase
    .from('print_events')
    .insert([{ id: crypto.randomUUID(), job_id: id, event_type: 'issue_resolved', message: 'Staff resolved the reported issue.', created_at: now }]);
}

// Payment is tracked independently of print-progress status — a job can be
// released/printed before it's paid (pay-at-counter-after-print flow), so
// marking paid only ever touches paid_at, never the status column.
export async function markJobPaid(id: string, via: 'online' | 'counter' = 'counter'): Promise<{ paidAt: string }> {
  const { data: existing, error: selError } = await supabase
    .from('jobs')
    .select('paid_at')
    .eq('id', id)
    .single();
  if (selError) throw selError;

  if (existing?.paid_at) {
    return { paidAt: String(existing.paid_at) };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('jobs')
    .update({ paid_at: now, paid_via: via, updated_at: now })
    .eq('id', id);
  if (error) throw error;

  await supabase
    .from('print_events')
    .insert([{ id: crypto.randomUUID(), job_id: id, event_type: 'paid', message: `Marked as paid (${via}).`, created_at: now }]);

  return { paidAt: now };
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
  duplexBwPerPagePaise: 100,
  expiryMinutes: 1440,
  deliveryFeePaise: 0,
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
    duplexBwPerPagePaise: data.duplex_bw_per_page_paise ?? PRICING_DEFAULTS.duplexBwPerPagePaise,
    expiryMinutes: data.expiry_minutes ?? PRICING_DEFAULTS.expiryMinutes,
    deliveryFeePaise: data.delivery_fee_paise ?? PRICING_DEFAULTS.deliveryFeePaise,
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
      duplex_bw_per_page_paise: pricing.duplexBwPerPagePaise,
      expiry_minutes: pricing.expiryMinutes,
      delivery_fee_paise: pricing.deliveryFeePaise,
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

export async function getAgentToken(rawToken: string) {
  const { data, error } = await supabase
    .from('agent_tokens')
    .select('token_hash');

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const { verifyToken } = await import('./token-hash');
  for (const row of data) {
    if (verifyToken(rawToken, row.token_hash)) return row;
  }
  return null;
}

// Daily-reset serial: #1 is the first job created after UTC midnight, not a
// global ever-climbing ticket number. Matches the familiar shop-counter feel
// and keeps the number small/meaningful for staff and customers.
export async function nextQueuePosition(): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('jobs')
    .select('queue_position')
    .gte('created_at', todayStart.toISOString())
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
  // Printed delivery jobs awaiting hand-off (delivery_status not yet 'delivered')
  // must survive cleanup — only cancelled/failed/delivered delivery jobs clean up.
  const { data: finishedRaw, error: finErr } = await supabase
    .from('jobs')
    .select('id, delivery_method, status, delivery_status')
    .in('status', ['printed', 'cancelled', 'failed']);
  if (finErr) throw finErr;
  const finished = (finishedRaw || []).filter((r) => {
    const isUndeliveredDelivery =
      r.delivery_method === 'delivery' && r.status === 'printed' && r.delivery_status !== 'delivered';
    return !isUndeliveredDelivery;
  });

  const { data: expired, error: expErr } = await supabase
    .from('jobs')
    .select('id')
    .eq('status', 'pending_payment')
    .lt('created_at', cutoff)
    .is('paid_at', null);
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

// ─── Analytics / Accounts ────────────────────────────────────────────────────

import type { DailyJobSummary, AccountsSummary } from './types';

/**
 * Returns per-day aggregates for jobs created between `from` and `to` (inclusive, YYYY-MM-DD strings).
 * Aggregation happens in JavaScript over the raw rows — no custom SQL view needed.
 */
export async function getDailyAnalytics(from: string, to: string): Promise<DailyJobSummary[]> {
  // Use the date boundaries directly as ISO timestamps so Supabase can use its index.
  const fromTs = `${from}T00:00:00.000Z`;
  const toTs   = `${to}T23:59:59.999Z`;

  const { data, error } = await supabase
    .from('jobs')
    .select('created_at, status, print_type, page_count, price_paise, paid_at')
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const byDate: Record<string, DailyJobSummary> = {};

  for (const row of data || []) {
    const date = String(row.created_at).slice(0, 10); // "YYYY-MM-DD"
    if (!byDate[date]) {
      byDate[date] = {
        date,
        totalJobs: 0,
        totalRevenuePaise: 0,
        confirmedRevenuePaise: 0,
        bwJobs: 0,
        colorJobs: 0,
        photoJobs: 0,
        pagesTotal: 0,
        printedJobs: 0,
        cancelledJobs: 0,
        pendingJobs: 0,
      };
    }
    const d = byDate[date];
    const pricePaise = Number(row.price_paise) || 0;
    const pages      = Number(row.page_count)  || 0;
    const status     = String(row.status);
    const printType  = String(row.print_type);

    d.totalJobs++;
    d.totalRevenuePaise += pricePaise;
    d.pagesTotal += pages;

    if (row.paid_at) {
      d.confirmedRevenuePaise += pricePaise;
    }
    if (status === 'printed')   d.printedJobs++;
    if (status === 'cancelled') d.cancelledJobs++;
    if (status === 'pending_payment') d.pendingJobs++;

    if (printType === 'color') d.colorJobs++;
    else if (printType === 'photo') d.photoJobs++;
    else d.bwJobs++;
  }

  // Return sorted by date ascending, filling no gaps (only days with jobs are returned).
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns an aggregated summary for a single calendar day (defaults to today in UTC).
 */
export async function getAccountsSummary(date?: string): Promise<AccountsSummary> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const rows = await getDailyAnalytics(day, day);
  const d = rows[0];

  if (!d) {
    return {
      totalRevenuePaise: 0,
      confirmedRevenuePaise: 0,
      pendingRevenuePaise: 0,
      totalJobs: 0,
      printedJobs: 0,
      totalPages: 0,
      bwJobs: 0,
      colorJobs: 0,
      photoJobs: 0,
    };
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
