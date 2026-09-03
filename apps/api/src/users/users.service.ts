import { Injectable } from '@nestjs/common';
import { UserRow, UsersRepository } from './users.repository';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  /**
   * Looks up a guest sender by email, creating one if none exists.
   * `users.email` is UNIQUE, so two near-simultaneous guest checkouts with the same brand-new email can race on the insert — one will hit a unique-constraint violation. Rather than surfacing that as an
   * error, this refetches and returns the row the other request created, since "the user now exists" is exactly what the caller wanted regardless of which request created it.
   */
  async findOrCreateGuestSender(params: {
    email: string;
    phone?: string;
    name: string;
  }): Promise<UserRow> {
    const existing = await this.repository.findByEmail(params.email);
    if (existing) {
      return existing;
    }

    try {
      return await this.repository.create(params);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const winner = await this.repository.findByEmail(params.email);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
