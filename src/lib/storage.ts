import path from 'node:path';
import { ORIGINALS_DIR, CONVERTED_DIR } from './config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const isSupabase = Boolean(supabaseUrl && supabaseKey);

let supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

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
  
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client not initialized');
  
  const { error } = await supabase.storage.from('selfprint').upload(bucketPath, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: true
  });
  
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage.from('selfprint').getPublicUrl(bucketPath);
  
  return {
    storedName,
    storagePath: publicUrl,
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
    try {
      const url = new URL(storagePath);
      const pathname = url.pathname.split('/object/public/')[1] || url.pathname.split('/storage/v1/object/public/')[1];
      const supabase = getSupabase();
      if (!supabase) return;
      await supabase.storage.from('selfprint').remove([pathname]);
    } catch {
      // Ignore errors if file doesn't exist
    }
  } else {
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
    const supabase = getSupabase();
    if (!supabase) return [];
    const { data } = await supabase.storage.from('selfprint').list(prefix);
    if (!data) return [];
    const { data: { publicUrl } } = supabase.storage.from('selfprint').getPublicUrl('');
    return data.map(f => `${publicUrl}${prefix}/${f.name}`);
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
