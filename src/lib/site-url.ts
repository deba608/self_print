const LOCAL_SITE_URL = "http://localhost:3000";

function normalizeSiteUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

/**
 * Returns the canonical application origin used in authentication emails.
 * Vercel supplies the production/preview fallbacks automatically, while an
 * explicit NEXT_PUBLIC_SITE_URL remains the highest-priority custom domain.
 */
export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return normalizeSiteUrl(configured);

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return normalizeSiteUrl(productionHost);

  const deploymentHost = process.env.VERCEL_URL?.trim();
  if (deploymentHost) return normalizeSiteUrl(deploymentHost);

  return LOCAL_SITE_URL;
}

export function getAuthRedirectUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${normalizedPath}`;
}
