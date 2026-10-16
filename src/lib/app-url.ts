// Public base URL for links that leave the app (pay links in emails, the Vapi webhook).
// On Vercel a missing or localhost NEXT_PUBLIC_APP_URL falls back to the project's production domain.
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (configured && !(process.env.VERCEL && /localhost|127\.0\.0\.1/.test(configured))) return configured;
  if (vercelProd) return `https://${vercelProd}`;
  return configured || "http://localhost:3000";
}
