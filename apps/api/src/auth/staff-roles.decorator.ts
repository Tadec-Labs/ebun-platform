import { SetMetadata } from '@nestjs/common';

/** The staff subset of users.role — see the column comment in the schema. */
export type StaffRole =
  'ebun_admin' | 'ebun_ops' | 'ebun_finance' | 'ebun_support';

export const STAFF_ROLES_KEY = 'staffRoles';

/**
 * Required on every route behind StaffGuard. A route with the guard but
 * no roles declared is DENIED, not allowed — forgetting the decorator
 * must fail closed.
 */
export const StaffRoles = (...roles: StaffRole[]) =>
  SetMetadata(STAFF_ROLES_KEY, roles);
