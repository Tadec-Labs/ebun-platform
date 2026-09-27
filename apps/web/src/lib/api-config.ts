// Defaults to :3001 for local dev specifically because apps/api's own
// default (3000) collides with Next's dev server default — run the API
// locally with `PORT=3001 pnpm --filter api start:dev` to match this.
// In deployment, NEXT_PUBLIC_API_BASE_URL must be set explicitly
// (Vercel Project Settings -> Environment Variables) to the real API
// URL — there's no sensible production default to fall back to.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
