import { sealRefreshCookie, openRefreshCookie } from './refresh-cookie';
const secret = 'unit-test-key-material-'.repeat(3);
it('encrypts the browser cookie and detects tampering [S6-02]', () => {
  const token = 'user-id.refresh-secret-sentinel';
  const encoded = sealRefreshCookie(token, secret);
  expect(encoded).not.toContain('refresh-secret-sentinel');
  expect(openRefreshCookie(encoded, secret)).toBe(token);
  expect(openRefreshCookie(encoded, secret + 'different')).toBeUndefined();
  expect(openRefreshCookie('tampered.' + encoded, secret)).toBeUndefined();
  expect(openRefreshCookie(undefined, secret)).toBeUndefined();
});
