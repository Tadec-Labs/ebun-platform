// Defaults to :3001 for local dev, which is also apps/api's own default
// (see apps/api/src/main.ts) — 3000 belongs to Next's dev server, so the
// API cannot have it. Nothing needs setting locally: `pnpm --filter api
// start:dev` and `pnpm --filter web dev` agree out of the box.
// In deployment, NEXT_PUBLIC_API_BASE_URL must be set explicitly
// (Vercel Project Settings -> Environment Variables) to the real API
// URL — there's no sensible production default to fall back to.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
