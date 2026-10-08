import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { STAFF_ROLES_KEY, StaffRole } from './staff-roles.decorator';

export interface StaffContext {
  userId: string;
  authId: string;
  role: StaffRole;
  email: string | null;
  name: string | null;
}

export type StaffRequest = Request & { staff?: StaffContext };

/**
 * 401 = we couldn't establish who you are. 403 = we know, and the answer
 * is no — deliberately the same generic response whether the account
 * doesn't exist in `users`, is deactivated, or just has the wrong role,
 * so this can't be used to probe which emails are staff.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();

    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    const identity = await this.auth.verifyAccessToken(token);
    if (!identity) {
      throw new UnauthorizedException();
    }

    const allowedRoles = this.reflector.getAllAndOverride<
      StaffRole[] | undefined
    >(STAFF_ROLES_KEY, [context.getHandler(), context.getClass()]);

    const user = await this.users.findStaffByAuthId(identity.authId);

    if (
      !user ||
      !user.is_active ||
      !allowedRoles ||
      !allowedRoles.includes(user.role as StaffRole)
    ) {
      throw new ForbiddenException();
    }

    request.staff = {
      userId: user.id,
      authId: identity.authId,
      role: user.role as StaffRole,
      email: user.email,
      name: user.name,
    };
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }
}
