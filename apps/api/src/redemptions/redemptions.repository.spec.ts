import { Test } from '@nestjs/testing';
import { RedemptionsRepository } from './redemptions.repository';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';

describe('RedemptionsRepository.findByFallbackCode', () => {
  let sut: RedemptionsRepository;
  let select: jest.Mock;

  beforeEach(async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    select = jest.fn().mockReturnValue({ eq });
    const supabase = { from: jest.fn().mockReturnValue({ select }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RedemptionsRepository,
        { provide: SUPABASE_CLIENT, useValue: supabase },
      ],
    }).compile();

    sut = moduleRef.get(RedemptionsRepository);
  });

  it('embeds the gift through the named gift_template_id FK, never a bare (ambiguous) gift_templates', async () => {
    await sut.findByFallbackCode('5PXNPZ');

    const [[columns]] = select.mock.calls as [[string]];
    // orders has two FKs to gift_templates; a bare embed is a PGRST201
    // error at runtime, which mocks would never catch on their own.
    expect(columns).toContain(
      'gift_templates:gift_templates!gift_template_id(name)',
    );
    expect(columns).not.toMatch(/(^|[\s,(])gift_templates\(/);
  });
});
