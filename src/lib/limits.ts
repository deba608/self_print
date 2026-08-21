// Shared, client-safe upload limits. Kept separate from lib/bulk.ts because
// that file pulls in node:crypto/node:path (via storage.ts) and can't be
// imported from client components.
export const MAX_BULK_FILES = 20;
