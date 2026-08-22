import type { ConfigService } from '@nestjs/config';
import { QrTokenService } from './qr-token.service';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';

function makeService(secret = SECRET): QrTokenService {
  const config = { get: () => secret } as unknown as ConfigService;
  return new QrTokenService(config as never);
}

describe('QrTokenService', () => {
  const payload = {
    rsvpId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    issuedAt: 1_755_000_000_000,
  };

  it('round-trips a payload it signed', () => {
    const service = makeService();
    expect(service.verify(service.sign(payload))).toEqual(payload);
  });

  it('rejects a token whose payload was altered', () => {
    const service = makeService();
    const [, signature] = service.sign(payload).split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ ...payload, eventId: '33333333-3333-4333-8333-333333333333' }),
    ).toString('base64url');

    expect(service.verify(`${forgedBody}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = makeService('a-completely-different-secret-32-chars-yes').sign(payload);
    expect(makeService().verify(token)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    const service = makeService();
    for (const bad of ['', 'nonsense', 'no-dot-separator', 'a.b', '.', 'a.']) {
      expect(service.verify(bad)).toBeNull();
    }
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch — the guard must catch it.
    const service = makeService();
    const [body] = service.sign(payload).split('.');
    expect(() => service.verify(`${body}.short`)).not.toThrow();
    expect(service.verify(`${body}.short`)).toBeNull();
  });
});
