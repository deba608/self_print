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
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 25);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const SESSION_COOKIE = "selfprint_session";
export const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";
export const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "1234";
export const DEFAULT_AGENT_TOKEN = process.env.AGENT_TOKEN ?? "dev-agent";
export const DEFAULT_EXPIRY_MINUTES = 1440;
