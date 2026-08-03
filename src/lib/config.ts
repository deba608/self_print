import path from "node:path";

export const ROOT_DIR = process.cwd();
const isVercel = Boolean(process.env.VERCEL);
const runtimeDataRoot = isVercel ? "/tmp/selfprint" : ROOT_DIR;
export const DB_PATH = path.resolve(
  process.env.DATABASE_PATH ?? path.join(runtimeDataRoot, "data/selfprint.sqlite")
);
export const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_DIR ?? path.join(runtimeDataRoot, "uploads")
);
export const ORIGINALS_DIR = path.join(UPLOAD_ROOT, "originals");
export const CONVERTED_DIR = path.join(UPLOAD_ROOT, "converted");
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 50);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
// Used for upload-signing (src/lib/storage.ts: signStoredName/verifyStoredNameSig),
// unrelated to admin sessions (those are Supabase Auth now).
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";
// No hardcoded token default — AGENT_TOKEN must be set via env (.env locally,
// Vercel env vars in production). Empty default fails closed: verifyAgentToken
// rejects empty/missing bearer tokens, so no guessable secret ships in the repo.
export const DEFAULT_AGENT_TOKEN = process.env.AGENT_TOKEN ?? "";
export const DEFAULT_EXPIRY_MINUTES = 1440;
// Cleanup-only: how long an unpaid "pending_payment" cart can sit before its
// row + files are deleted outright. Deliberately separate from the
// customer-facing job/token expiry (DEFAULT_EXPIRY_MINUTES / pricing.expiryMinutes)
// so changing what customers see never silently changes retention behavior.
export const CART_ABANDON_MINUTES = Number(process.env.CART_ABANDON_MINUTES ?? 1440);
// How long an uploaded file can sit without a matching job_files row before
// the cleanup sweep deletes it as orphaned (e.g. upload succeeded but job
// creation failed). Separate from CART_ABANDON_MINUTES because it targets
// filesystem/storage orphans, not database rows.
export const STRAY_FILE_RETENTION_HOURS = Number(process.env.STRAY_FILE_RETENTION_HOURS ?? 2);
// Privacy retention: uploaded file bytes for finished orders (printed/cancelled/
// failed) are purged this many days after the job was created. The job row and
// job_files metadata (filename, page count, price) are kept forever so order
// history and receipts remain available — only the actual file content is deleted.
export const FILE_RETENTION_DAYS = Number(process.env.FILE_RETENTION_DAYS ?? 3);
// Staff login-event history (admin_login_events) is purged after this many
// days. Job/order history is kept forever by design (see FILE_RETENTION_DAYS
// comment above) — this constant applies only to auth audit log rows, which
// carry no customer order data.
export const LOGIN_EVENT_RETENTION_DAYS = Number(process.env.LOGIN_EVENT_RETENTION_DAYS ?? 365);

// Warn in production if security-critical secrets are unset or still on dev defaults.
// Skip during Next.js build (NEXT_PHASE=phase-production-build) — env vars may not
// be injected at build time on Vercel; they are present at runtime only.
if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  const insecure: string[] = [];
  if (SESSION_SECRET === "dev-session-secret-change-me") insecure.push("SESSION_SECRET");
  if (!DEFAULT_AGENT_TOKEN) insecure.push("AGENT_TOKEN");
  if (insecure.length > 0) {
    console.error(
      `[selfprint] WARNING — missing or insecure secrets: ${insecure.join(", ")}. ` +
      "Set these environment variables to strong random secrets in production."
    );
  }
}
