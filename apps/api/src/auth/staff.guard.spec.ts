import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { StaffGuard, StaffRequest } from './staff.guard';
import { StaffRole } from './staff-roles.decorator';

function makeContext(headers: Record<string, string>): {
  context: ExecutionContext;
  request: StaffRequest;
} {
  const request = { headers } as unknown as StaffRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

const STAFF_USER = {
  id: 'user-1',
  auth_id: 'auth-1',
  email: 'ops@ebun.example',
  name: 'Ops Person',
  role: 'ebun_ops',
  is_active: true,
};

describe('StaffGuard', () => {
  let sut: StaffGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let auth: { verifyAccessToken: jest.Mock };
  let users: { findStaffByAuthId: jest.Mock };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(['ebun_admin', 'ebun_ops'] as StaffRole[]),
    };
    auth = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ authId: 'auth-1', email: 'ops@ebun.example' }),
    };
    users = { findStaffByAuthId: jest.fn().mockResolvedValue(STAFF_USER) };
    sut = new StaffGuard(
      reflector as unknown as Reflector,
      auth as unknown as AuthService,
      users as never,
    );
  });

  it('401s with no Authorization header, without touching Supabase', async () => {
    const { context } = makeContext({});
    await expect(sut.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('401s on a non-Bearer scheme', async () => {
    const { context } = makeContext({ authorization: 'Basic abc123' });
    await expect(sut.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('401s when Supabase rejects the token, without querying users', async () => {
    auth.verifyAccessToken.mockResolvedValue(null);
    const { context } = makeContext({ authorization: 'Bearer bad' });
    await expect(sut.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(users.findStaffByAuthId).not.toHaveBeenCalled();
  });

  it('403s a valid Supabase account that has no users row', async () => {
    users.findStaffByAuthId.mockResolvedValue(null);
    const { context } = makeContext({ authorization: 'Bearer good' });
    await expect(sut.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('403s a deactivated staff account', async () => {
    users.findStaffByAuthId.mockResolvedValue({
      ...STAFF_USER,
      is_active: false,
    });
    const { context } = makeContext({ authorization: 'Bearer good' });
    await expect(sut.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('403s a role the route does not allow (a sender, a vendor, or support on an ops-only route)', async () => {
    for (const role of ['sender', 'vendor', 'ebun_support']) {
      users.findStaffByAuthId.mockResolvedValue({ ...STAFF_USER, role });
      const { context } = makeContext({ authorization: 'Bearer good' });
      await expect(sut.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('fails CLOSED when a guarded route declares no roles — even for an admin', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    users.findStaffByAuthId.mockResolvedValue({
      ...STAFF_USER,
      role: 'ebun_admin',
    });
    const { context } = makeContext({ authorization: 'Bearer good' });
    await expect(sut.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows an allowed role and attaches the staff context', async () => {
    const { context, request } = makeContext({ authorization: 'Bearer good' });

    await expect(sut.canActivate(context)).resolves.toBe(true);

    expect(auth.verifyAccessToken).toHaveBeenCalledWith('good');
    expect(request.staff).toEqual({
      userId: 'user-1',
      authId: 'auth-1',
      role: 'ebun_ops',
      email: 'ops@ebun.example',
      name: 'Ops Person',
    });
  });

  it('accepts a lower-case "bearer" scheme', async () => {
    const { context } = makeContext({ authorization: 'bearer good' });
    await expect(sut.canActivate(context)).resolves.toBe(true);
  });
});
