import { put, del, list } from '@vercel/blob';
import path from 'node:path';
import { ORIGINALS_DIR, CONVERTED_DIR } from './config';

const isSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export interface SavedFile {
  storedName: string;
  storagePath: string;
  sizeBytes: number;
  bytes: Buffer;
}

// Local filesystem storage (for development)
async function saveToLocal(file: File, ext: string, kind: string): Promise<SavedFile> {
  const crypto = await import('node:crypto');
  const storedName = `${crypto.randomUUID()}${ext}`;
  const dir = kind === 'document' ? CONVERTED_DIR : ORIGINALS_DIR;
  const storagePath = path.join(dir, storedName);
  
  // Ensure directory exists
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, bytes);
  
  return {
    storedName,
    storagePath,
    sizeBytes: bytes.length,
    bytes
  };
}

// Supabase Storage (for production)
async function saveToSupabase(file: File, ext: string, kind: string): Promise<SavedFile> {
  const crypto = await import('node:crypto');
  const storedName = `${crypto.randomUUID()}${ext}`;
  const bucketPath = `${kind === 'document' ? 'converted' : 'originals'}/${storedName}`;
  
  const bytes = Buffer.from(await file.arrayBuffer());
  
  // Upload to Vercel Blob (or Supabase Storage)
  const blob = await put(bucketPath, bytes, {
    access: 'public',
    addRandomSuffix: false
  });
  
  return {
    storedName,
    storagePath: blob.url,
    sizeBytes: bytes.length,
    bytes
  };
}

export async function saveUpload(file: File, ext: string, kind: string = 'pdf'): Promise<SavedFile> {
  if (isSupabase) {
    return saveToSupabase(file, ext, kind);
  }
  return saveToLocal(file, ext, kind);
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (isSupabase) {
    // Delete from Vercel Blob / Supabase Storage
    try {
      const url = new URL(storagePath);
      const pathname = url.pathname.replace('/storage/v1/object/public/', '');
      await del(pathname);
    } catch {
      // Ignore errors if file doesn't exist
    }
  } else {
    // Delete from local filesystem
    const fs = await import('node:fs/promises');
    try {
      await fs.unlink(storagePath);
    } catch {
      // Ignore errors if file doesn't exist
    }
  }
}

export async function listFiles(prefix: string): Promise<string[]> {
  if (isSupabase) {
    const { blobs } = await list({ prefix });
    return blobs.map(b => b.url);
  } else {
    const fs = await import('node:fs/promises');
    const dir = prefix.includes('converted') ? CONVERTED_DIR : ORIGINALS_DIR;
    try {
      const files = await fs.readdir(dir);
      return files.map(f => path.join(dir, f));
    } catch {
      return [];
    }
  }
}
