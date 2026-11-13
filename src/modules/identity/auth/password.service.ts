import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// OWASP-recommended interactive parameters; stored per hash so they can be raised later.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Password hashing on `node:crypto` scrypt — no native add-on to compile in
 * Docker. Format: `scrypt$N$r$p$saltBase64$hashBase64`.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELISM,
      maxmem: 128 * COST * BLOCK_SIZE * 2,
    });
    return [
      'scrypt',
      COST,
      BLOCK_SIZE,
      PARALLELISM,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  /** False for any malformed or foreign hash (e.g. dev-auth placeholders); never throws. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
    const N = Number(n);
    const blockSize = Number(r);
    const parallelism = Number(p);
    if (![N, blockSize, parallelism].every((v) => Number.isInteger(v) && v > 0)) return false;
    // Refuse absurd parameters from a tampered row rather than burn memory on them.
    if (N > 2 ** 20 || blockSize > 32 || parallelism > 16) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

    try {
      const actual = await derive(password, salt, {
        N,
        r: blockSize,
        p: parallelism,
        maxmem: 128 * N * blockSize * 2,
      });
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
