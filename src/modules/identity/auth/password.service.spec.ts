import { PasswordService } from './password.service';

describe('PasswordService (S1-02)', () => {
  const service = new PasswordService();

  it('verifies the password it hashed and rejects a different one', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
    await expect(service.verify('correct horse battery', hash)).resolves.toBe(true);
    await expect(service.verify('correct horse batterz', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);
    expect(a).not.toEqual(b);
  });

  it('returns false instead of throwing for foreign or tampered hashes', async () => {
    const oversizedCost = ['scrypt', 2 ** 30, 8, 1, 'AAAAAAAA', 'A'.repeat(88)].join('$');
    await expect(service.verify('anything', 'dev-auth-placeholder')).resolves.toBe(false);
    await expect(service.verify('anything', '')).resolves.toBe(false);
    await expect(service.verify('anything', 'scrypt$0$8$1$AAAA$AAAA')).resolves.toBe(false);
    await expect(service.verify('anything', oversizedCost)).resolves.toBe(false);
  });
});
