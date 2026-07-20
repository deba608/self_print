import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ORIGINALS_DIR, CONVERTED_DIR, SESSION_SECRET } from './config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
export const cloudStorageEnabled = Boolean(supabaseUrl && supabaseKey);
const BUCKET = 'selfprint';
const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes

let supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

// Server-generated stored names are always `<uuid><ext>`. Any client-supplied
// storedName (direct-upload / bulk flows) must match this exactly before it's
// used to build a storage path — otherwise `..`/`/` could escape the bucket.
const STORED_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png|doc|docx)$/i;

export function isValidStoredName(storedName: string): boolean {
  return STORED_NAME_RE.test(storedName);
}

// HMAC binding between the sign step and job creation: /api/uploads/sign issues
// a signature over the storedName it generated; /api/jobs only accepts a
// client-supplied storedName if it carries a matching signature. This stops a
// client from attaching an object it never uploaded (IDOR) even if it somehow
// learns another customer's storedName.
export function signStoredName(storedName: string): string {
  return createHmac('sha256', SESSION_SECRET).update(`upload:${storedName}`).digest('hex');
}

export function verifyStoredNameSig(storedName: string, sig: string): boolean {
  const expected = signStoredName(storedName);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export interface SavedFile {
  storedName: string;
  storagePath: string;
  sizeBytes: number;
  bytes: Buffer;
}

// Object path inside the Supabase bucket for a given file kind + stored name.
export function bucketPathFor(kind: string, storedName: string): string {
  return `${kind === 'document' ? 'converted' : 'originals'}/${storedName}`;
}

// Extracts the bucket object path from either a stored object path or a
// legacy public/signed URL (handles the few rows created before this change).
function toObjectPath(storagePath: string): string {
  if (!/^https?:\/\//i.test(storagePath)) return storagePath;
  try {
    const url = new URL(storagePath);
    const marker = url.pathname.match(/\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
    if (marker?.[1]) return decodeURIComponent(marker[1]);
  } catch {
    // fall through
  }
  return storagePath;
}

// Local filesystem storage (for development)
async function saveToLocal(file: File, ext: string, kind: string): Promise<SavedFile> {
  const crypto = await import('node:crypto');
  const storedName = `${crypto.randomUUID()}${ext}`;
  const dir = kind === 'document' ? CONVERTED_DIR : ORIGINALS_DIR;
  const storagePath = path.join(dir, storedName);

  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });

  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, bytes);

  return { storedName, storagePath, sizeBytes: bytes.length, bytes };
}

// Supabase Storage (private bucket — stores the object path, not a public URL)
async function saveToSupabase(file: File, ext: string, kind: string): Promise<SavedFile> {
  const crypto = await import('node:crypto');
  const storedName = `${crypto.randomUUID()}${ext}`;
  const objectPath = bucketPathFor(kind, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());

  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not initialized');

  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  });
  if (error) throw error;

  return { storedName, storagePath: objectPath, sizeBytes: bytes.length, bytes };
}

export async function saveUpload(file: File, ext: string, kind: string = 'pdf'): Promise<SavedFile> {
  if (cloudStorageEnabled) return saveToSupabase(file, ext, kind);
  return saveToLocal(file, ext, kind);
}

// Creates a short-lived signed URL the browser can upload to directly. Keeps
// the bucket private and the object path server-controlled.
export async function createSignedUpload(kind: string, storedName: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not initialized');
  const objectPath = bucketPathFor(kind, storedName);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(objectPath);
  if (error) throw error;
  return { objectPath, signedUrl: data.signedUrl, token: data.token };
}

// Returns a URL a client/agent can fetch the file from, or null for local FS.
export async function createSignedDownloadUrl(storagePath: string): Promise<string | null> {
  if (!cloudStorageEnabled) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const objectPath = toObjectPath(storagePath);
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

// Reads raw bytes from a stored file (Supabase object or local path).
export async function readFileBytes(storagePath: string): Promise<Buffer> {
  if (cloudStorageEnabled) {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.storage.from(BUCKET).download(toObjectPath(storagePath));
    if (error) throw error;
    return Buffer.from(await data.arrayBuffer());
  }
  if (/^https?:\/\//i.test(storagePath)) {
    const res = await fetch(storagePath);
    if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const fs = await import('node:fs/promises');
  return fs.readFile(storagePath);
}

// Streams a stored file instead of buffering the whole thing into memory
// first — used by the manual-print proxy so bytes start reaching the browser
// (and its PDF viewer) as soon as they arrive from storage, instead of
// waiting for the entire file to download server-side before responding.
export async function readFileStream(storagePath: string): Promise<ReadableStream> {
  if (cloudStorageEnabled) {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client not initialized');
    const { data, error } = await supabase.storage.from(BUCKET).download(toObjectPath(storagePath));
    if (error) throw error;
    return data.stream();
  }
  if (/^https?:\/\//i.test(storagePath)) {
    const res = await fetch(storagePath);
    if (!res.ok || !res.body) throw new Error(`Failed to fetch file: ${res.status}`);
    return res.body;
  }
  const fs = await import('node:fs');
  const { Readable } = await import('node:stream');
  return Readable.toWeb(fs.createReadStream(storagePath)) as ReadableStream;
}

// Saves a buffer (e.g. a converted PDF) using the active storage backend.
export async function saveBuffer(
  bytes: Buffer,
  ext: string,
  kind: string,
  contentType: string
): Promise<SavedFile> {
  const crypto = await import('node:crypto');
  const storedName = `${crypto.randomUUID()}${ext}`;

  if (cloudStorageEnabled) {
    const objectPath = bucketPathFor(kind, storedName);
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client not initialized');
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType,
      upsert: false
    });
    if (error) throw error;
    return { storedName, storagePath: objectPath, sizeBytes: bytes.length, bytes };
  }

  const dir = kind === 'document' ? CONVERTED_DIR : ORIGINALS_DIR;
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, storedName);
  await fs.writeFile(storagePath, bytes);
  return { storedName, storagePath, sizeBytes: bytes.length, bytes };
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (cloudStorageEnabled) {
    try {
      const supabase = getSupabase();
      if (!supabase) return;
      await supabase.storage.from(BUCKET).remove([toObjectPath(storagePath)]);
    } catch {
      // Ignore errors if file doesn't exist
    }
    return;
  }
  const fs = await import('node:fs/promises');
  try {
    await fs.unlink(storagePath);
  } catch {
    // Ignore errors if file doesn't exist
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  if (cloudStorageEnabled) {
    const supabase = getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.storage.from(BUCKET).list(prefix);
    if (!data) return [];
    return data.map((f) => `${prefix}/${f.name}`);
  }
  const fs = await import('node:fs/promises');
  const dir = prefix.includes('converted') ? CONVERTED_DIR : ORIGINALS_DIR;
  try {
    const files = await fs.readdir(dir);
    return files.map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// Lists files in storage that are older than maxAgeMs.
export async function listOldFiles(prefix: string, maxAgeMs: number): Promise<string[]> {
  const now = Date.now();
  if (cloudStorageEnabled) {
    const supabase = getSupabase();
    if (!supabase) return [];
    const allOldPaths: string[] = [];
    let offset = 0;
    const limit = 1000;
    
    while (true) {
      const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit, offset });
      if (!data || data.length === 0) break;
      
      for (const f of data) {
        if (!f.created_at || f.name === '.emptyFolderPlaceholder') continue;
        const createdMs = new Date(f.created_at).getTime();
        if (now - createdMs > maxAgeMs) {
          allOldPaths.push(`${prefix}/${f.name}`);
        }
      }
      if (data.length < limit) break;
      offset += limit;
    }
    return allOldPaths;
  }
  
  const fs = await import('node:fs/promises');
  const dir = prefix.includes('converted') ? CONVERTED_DIR : ORIGINALS_DIR;
  try {
    const files = await fs.readdir(dir);
    const oldPaths: string[] = [];
    for (const f of files) {
      const p = path.join(dir, f);
      const stat = await fs.stat(p);
      if (now - stat.mtimeMs > maxAgeMs) {
        oldPaths.push(p);
      }
    }
    return oldPaths;
  } catch {
    return [];
  }
}
