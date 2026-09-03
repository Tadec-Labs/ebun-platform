import { Test } from '@nestjs/testing';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

describe('UsersService', () => {
  let sut: UsersService;
  let repository: { findByEmail: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    repository = { findByEmail: jest.fn(), create: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
      ],
    }).compile();

    sut = moduleRef.get(UsersService);
  });

  it('returns an existing user by email without creating a new one', async () => {
    repository.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
    });

    const result = await sut.findOrCreateGuestSender({
      email: 'a@example.com',
      name: 'Ada',
    });

    expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('creates a new guest user when none exists', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.create.mockResolvedValue({
      id: 'user-2',
      email: 'b@example.com',
    });

    const result = await sut.findOrCreateGuestSender({
      email: 'b@example.com',
      name: 'Bola',
    });

    expect(repository.create).toHaveBeenCalledWith({
      email: 'b@example.com',
      name: 'Bola',
    });
    expect(result).toEqual({ id: 'user-2', email: 'b@example.com' });
  });

  it('recovers from a lost race (unique violation on create) by refetching the winner', async () => {
    repository.findByEmail
      .mockResolvedValueOnce(null) // initial check — doesn't exist yet
      .mockResolvedValueOnce({ id: 'user-3', email: 'c@example.com' }); // refetch after losing the race
    repository.create.mockRejectedValue({
      code: '23505',
      message: 'duplicate key',
    });

    const result = await sut.findOrCreateGuestSender({
      email: 'c@example.com',
      name: 'Chidi',
    });

    expect(result).toEqual({ id: 'user-3', email: 'c@example.com' });
  });

  it('rethrows a create failure that is not a unique violation', async () => {
    repository.findByEmail.mockResolvedValue(null);
    repository.create.mockRejectedValue(new Error('connection refused'));

    await expect(
      sut.findOrCreateGuestSender({ email: 'd@example.com', name: 'Deji' }),
    ).rejects.toThrow('connection refused');
  });
});
