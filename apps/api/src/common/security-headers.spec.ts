import type { NextFunction, Request, Response } from 'express';
import { SECURITY_HEADERS, securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('sets every baseline header and passes the request on', () => {
    const set: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => {
        set[name] = value;
      },
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    securityHeaders({} as Request, response, next);

    expect(set).toEqual(SECURITY_HEADERS);
    expect(set['X-Content-Type-Options']).toBe('nosniff');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
