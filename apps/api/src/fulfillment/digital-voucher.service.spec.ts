import { DigitalVoucherService } from './digital-voucher.service';

describe('DigitalVoucherService', () => {
  it('generates an EBN-VCH- prefixed, high-entropy code', () => {
    const code = new DigitalVoucherService().generateCode();
    expect(code).toMatch(/^EBN-VCH-[0-9A-F]{16}$/);
  });

  it('does not repeat codes across calls', () => {
    const service = new DigitalVoucherService();
    const codes = new Set(
      Array.from({ length: 50 }, () => service.generateCode()),
    );
    expect(codes.size).toBe(50);
  });
});
