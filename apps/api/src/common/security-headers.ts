import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline response headers for a JSON API (OWASP ASVS L1; the Brief's
 * "secure headers on all API responses").
 *
 * Written out rather than pulling in helmet: this API serves only JSON
 * to a separate web app, so the relevant set is small and fixed, and
 * every header here is one whose purpose can be read in a line.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Never let a browser guess a response is HTML or script.
  'X-Content-Type-Options': 'nosniff',
  // Nothing here should ever render in a frame or load sub-resources.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  // API URLs carry codes and tokens in paths; never leak them onward.
  'Referrer-Policy': 'no-referrer',
  // Production is HTTPS-only; browsers ignore this over plain HTTP.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function securityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  next();
}
