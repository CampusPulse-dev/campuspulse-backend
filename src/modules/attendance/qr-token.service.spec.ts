import { generateKeyPairSync, webcrypto } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { QrTokenService } from './qr-token.service';

function generatePkcs8Base64(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

function makeService(privateKeyBase64 = generatePkcs8Base64()): QrTokenService {
  const config = {
    get: (key: string) => {
      if (key === 'QR_SIGNING_PRIVATE_KEY') return privateKeyBase64;
      return undefined;
    },
  } as unknown as ConfigService;
  return new QrTokenService(config as never);
}

describe('QrTokenService (Ed25519 S3-01)', () => {
  const payload = {
    rsvpId: '11111111-1111-4111-8111-111111111111',
    eventId: '22222222-2222-4222-8222-222222222222',
    showtimeId: '33333333-3333-4333-8333-333333333333',
    issuedAt: 1_755_000_000_000,
  };

  it('signs v:1 Ed25519 tokens and verifies round-trip with optional showtimeId', () => {
    const service = makeService();
    const token = service.sign(payload);
    const [body] = token.split('.');
    expect(body).toBeDefined();

    const decodedJson = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(decodedJson).toEqual({
      v: 1,
      ...payload,
    });

    expect(service.verify(token)).toEqual({
      v: 1,
      ...payload,
    });
  });

  it('exports a raw 32-byte base64url public key verifiable via Web Crypto Ed25519', async () => {
    const service = makeService();
    const token = service.sign({
      rsvpId: payload.rsvpId,
      eventId: payload.eventId,
      issuedAt: payload.issuedAt,
    });
    const [body, sig] = token.split('.');
    const rawPubBytes = Buffer.from(service.getPublicKey(), 'base64url');
    expect(rawPubBytes).toHaveLength(32);

    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      rawPubBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const valid = await webcrypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      Buffer.from(sig!, 'base64url'),
      new TextEncoder().encode(body),
    );
    expect(valid).toBe(true);
  });

  it('rejects a token whose payload was altered', () => {
    const service = makeService();
    const [, signature] = service.sign(payload).split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ v: 1, ...payload, eventId: '44444444-4444-4444-8444-444444444444' }),
    ).toString('base64url');

    expect(service.verify(`${forgedBody}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different Ed25519 private key', () => {
    const token = makeService().sign(payload);
    expect(makeService().verify(token)).toBeNull();
  });

  it('rejects malformed tokens and wrong-length signatures without throwing', () => {
    const service = makeService();
    for (const bad of ['', 'nonsense', 'no-dot-separator', 'a.b', '.', 'a.', 'a.b.c']) {
      expect(() => service.verify(bad)).not.toThrow();
      expect(service.verify(bad)).toBeNull();
    }

    const [body] = service.sign(payload).split('.');
    expect(() => service.verify(`${body}.short`)).not.toThrow();
    expect(service.verify(`${body}.short`)).toBeNull();
  });

  it('computes deterministic SHA-256 hex digest for offline scanner roster matching', () => {
    const service = makeService();
    const token = service.sign(payload);
    const digest = service.digest(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(service.digest(token)).toBe(digest);
  });
});
