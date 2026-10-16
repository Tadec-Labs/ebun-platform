import type { NewRecipient } from './campaigns.repository';

/** Most people a single campaign can hold. Big enough for a large company's December; small enough for one webhook to fund. */
export const MAX_CAMPAIGN_RECIPIENTS = 2000;

export interface ParsedRecipientList {
  people: NewRecipient[];
  /** Lines that couldn't be used, with why — shown to HR so they can fix the sheet. */
  problems: { line: number; reason: string }[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A Nigerian number as people type it into a spreadsheet — "0803 123
 * 4567", "8031234567" (Excel ate the leading zero), "234803…",
 * "+234 803…" — to E.164. Other countries must already carry their "+".
 * Null when it can't be a phone number.
 */
export function normalisePhone(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, '');
  if (/^0[789]\d{9}$/.test(compact)) return `+234${compact.slice(1)}`;
  if (/^[789][01]\d{8}$/.test(compact)) return `+234${compact}`;
  if (/^234\d{10}$/.test(compact)) return `+${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

/**
 * Reads the list HR pastes or uploads: CSV (or tab-separated, which is
 * what copying from Excel or Google Sheets gives you).
 *
 * Columns are found by their heading, in any order: name, phone, email,
 * and an optional note (team, city — whatever they want back in the
 * report). Without a heading row, the order name, phone, email, note is
 * assumed. Bad rows are reported, not fatal: one typo in row 214 must not
 * cost HR the other 299 people.
 */
export function parseRecipientList(text: string): ParsedRecipientList {
  const rows = splitRows(text.replace(/^\uFEFF/, ''));
  const problems: ParsedRecipientList['problems'] = [];
  const people: NewRecipient[] = [];
  if (rows.length === 0) return { people, problems };

  const header = rows[0].cells.map((c) => c.trim().toLowerCase());
  const find = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  let nameAt = find('name', 'full name', 'recipient');
  let phoneAt = find('phone', 'whatsapp', 'mobile', 'number', 'tel');
  let emailAt = find('email', 'e-mail', 'mail');
  let noteAt = find('note', 'team', 'department', 'dept', 'city', 'location');
  const hasHeader = nameAt >= 0 && phoneAt >= 0;
  if (!hasHeader) {
    [nameAt, phoneAt, emailAt, noteAt] = [0, 1, 2, 3];
  }

  const seen = new Set<string>();
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const cell = (i: number) => (i >= 0 ? (row.cells[i] ?? '').trim() : '');
    if (row.cells.every((c) => c.trim() === '')) continue;

    const name = cell(nameAt).replace(/\s+/g, ' ');
    const phone = normalisePhone(cell(phoneAt));
    const emailRaw = cell(emailAt).toLowerCase();
    const note = cell(noteAt).slice(0, 120) || null;

    if (!name) {
      problems.push({ line: row.line, reason: 'No name.' });
      continue;
    }
    if (name.length > 120) {
      problems.push({ line: row.line, reason: 'Name is too long.' });
      continue;
    }
    if (!phone) {
      problems.push({
        line: row.line,
        reason: `"${cell(phoneAt) || '(blank)'}" isn't a phone number.`,
      });
      continue;
    }
    if (emailRaw && !EMAIL_PATTERN.test(emailRaw)) {
      problems.push({
        line: row.line,
        reason: `"${emailRaw}" isn't an email address.`,
      });
      continue;
    }
    if (seen.has(phone)) {
      problems.push({
        line: row.line,
        reason: `${phone} is already on the list.`,
      });
      continue;
    }
    seen.add(phone);
    people.push({ name, phone, email: emailRaw || null, note });
  }
  return { people, problems };
}

/** Minimal RFC 4180: quoted fields, doubled quotes, commas/newlines inside quotes. Tab-separated when the first line has tabs and no commas. */
function splitRows(text: string): { line: number; cells: string[] }[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === sep) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cells.push(field);
      rows.push({ line: rowLine, cells });
      cells = [];
      field = '';
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || cells.length > 0) {
    cells.push(field);
    rows.push({ line: rowLine, cells });
  }
  return rows;
}
