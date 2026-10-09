/**
 * The port the API binds to.
 *
 * Kept out of main.ts so the default is testable. The default matters
 * more than it looks: 3000 is Next's dev server, so an API defaulting to
 * 3000 fights apps/web for the port locally, and whichever loses is
 * invisible — the frontend just reports that it couldn't load anything.
 *
 * Hosts (Railway, Fly, Render) all inject PORT, so the default is a
 * local-dev concern only.
 */
export const DEFAULT_PORT = 3001;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;

  const port = Number(raw);
  // A malformed PORT must not silently fall back: on a host that injects
  // PORT, binding something else means the platform's health check never
  // reaches us and the deploy fails with no explanation.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT is not a valid port number: ${raw}`);
  }
  return port;
}
