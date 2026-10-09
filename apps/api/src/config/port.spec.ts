import { DEFAULT_PORT, resolvePort } from './port';

describe('resolvePort', () => {
  it('does not default to 3000, which belongs to the web dev server', () => {
    // This is the whole point of the module. If someone "tidies" the
    // default back to 3000, local dev silently breaks again: the API and
    // Next fight for the port and /send reports an unreachable catalogue.
    expect(DEFAULT_PORT).not.toBe(3000);
    expect(resolvePort({})).toBe(DEFAULT_PORT);
  });

  it('honours the port a host injects', () => {
    expect(resolvePort({ PORT: '8080' })).toBe(8080);
  });

  it('treats an empty PORT as unset', () => {
    expect(resolvePort({ PORT: '  ' })).toBe(DEFAULT_PORT);
  });

  it('refuses a malformed PORT rather than quietly binding elsewhere', () => {
    for (const bad of ['abc', '0', '70000', '3001.5']) {
      expect(() => resolvePort({ PORT: bad })).toThrow(/not a valid port/);
    }
  });
});
