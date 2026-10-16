import { normalisePhone, parseRecipientList } from './recipient-list';

describe('normalisePhone', () => {
  it.each([
    ['0803 123 4567', '+2348031234567'],
    ['08031234567', '+2348031234567'],
    ['8031234567', '+2348031234567'], // Excel dropped the leading zero
    ['234-803-123-4567', '+2348031234567'],
    ['+234 (803) 123 4567', '+2348031234567'],
    ['+447700900123', '+447700900123'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each(['', '12345', 'call me', '0803123456'])('rejects %p', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });
});

describe('parseRecipientList', () => {
  it('finds columns by heading, in any order', () => {
    const { people, problems } = parseRecipientList(
      'Email,Full Name,Phone Number,Department\nada@acme.ng,Ada Obi,08031234567,Finance\n',
    );
    expect(problems).toEqual([]);
    expect(people).toEqual([
      {
        name: 'Ada Obi',
        phone: '+2348031234567',
        email: 'ada@acme.ng',
        note: 'Finance',
      },
    ]);
  });

  it('reads tab-separated text pasted from a spreadsheet', () => {
    const { people } = parseRecipientList('name\tphone\nTunde\t0809 000 1111');
    expect(people[0]).toMatchObject({
      name: 'Tunde',
      phone: '+2348090001111',
      email: null,
    });
  });

  it('assumes name, phone, email, note without a heading row', () => {
    const { people } = parseRecipientList('Bisi,07012345678,bisi@x.com');
    expect(people[0]).toMatchObject({
      name: 'Bisi',
      phone: '+2347012345678',
      email: 'bisi@x.com',
    });
  });

  it('handles quoted names with commas and a BOM', () => {
    const { people } = parseRecipientList(
      '\uFEFFname,phone\n"Obi, Ada",08031234567\n',
    );
    expect(people[0].name).toBe('Obi, Ada');
  });

  it('reports bad and duplicate rows by line, and keeps the good ones', () => {
    const { people, problems } = parseRecipientList(
      [
        'name,phone,email',
        'Ada,08031234567,ada@acme.ng',
        ',08030000000,',
        'Chidi,not a phone,',
        'Emeka,0803 123 4567,', // same phone as Ada
        'Ngozi,08051112222,ngozi@',
        'Femi,08061112222,',
      ].join('\n'),
    );
    expect(people.map((p) => p.name)).toEqual(['Ada', 'Femi']);
    expect(problems.map((p) => p.line)).toEqual([3, 4, 5, 6]);
    expect(problems[2].reason).toMatch(/already on the list/);
  });

  it('ignores blank lines', () => {
    expect(
      parseRecipientList('name,phone\n\n\nAda,08031234567\n\n').people,
    ).toHaveLength(1);
  });
});
