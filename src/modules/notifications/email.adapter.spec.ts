import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { EmailAdapter } from './email.adapter';

const input = {
  userId: 'synthetic-user',
  to: 'synthetic@stu.ui.edu.ng',
  subject: 'Code',
  text: 'OTP secret 123456',
  template: 'student-otp' as const,
  idempotencyKey: 'otp/synthetic-attempt',
};
function config(transport = 'resend') {
  return new ConfigService<Env, true>({
    EMAIL_TRANSPORT: transport,
    RESEND_API_KEY: 'test-only-key',
    EMAIL_FROM: 'CampusPulse <test@example.com>',
  });
}
afterEach(() => jest.restoreAllMocks());
it('retries a transient response with the same idempotency key and accepts the delivered response', async () => {
  const requests: RequestInit[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    requests.push(init!);
    return Promise.resolve(
      new Response(
        JSON.stringify(requests.length === 1 ? { message: input.to } : { id: 'delivered-id' }),
        { status: requests.length === 1 ? 503 : 200 },
      ),
    );
  });
  const adapter = new EmailAdapter(config());
  await adapter.send(input);
  expect(requests).toHaveLength(2);
  expect(requests.map((r) => new Headers(r.headers).get('Idempotency-Key'))).toEqual([
    'otp/synthetic-attempt',
    'otp/synthetic-attempt',
  ]);
  expect(JSON.parse(requests[1]!.body as string) as unknown).toEqual({
    from: 'CampusPulse <test@example.com>',
    to: [input.to],
    subject: 'Code',
    text: input.text,
  });
  expect(adapter.getSentMessages()).toHaveLength(0);
});
it('does not retry permanent provider failures or leak provider response PII', async () => {
  const send = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(input.to + input.text, { status: 422 }));
  await expect(new EmailAdapter(config()).send(input)).rejects.toThrow(
    'Transactional email rejected (422)',
  );
  expect(send).toHaveBeenCalledTimes(1);
});
it('retains local delivery records only in memory mode', async () => {
  const adapter = new EmailAdapter(config('memory'));
  await adapter.send(input);
  expect(adapter.getSentMessages()[0]).toMatchObject(input);
});
it('bounds network timeouts to three attempts and sanitizes the final failure', async () => {
  jest.useFakeTimers();
  try {
    const send = jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error(input.text + input.to)), {
            once: true,
          });
        }),
    );
    // Mock the platform timeout to let fake timers exercise the real cancellation path.
    jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const rejected = expect(new EmailAdapter(config()).send(input)).rejects.toThrow(
      'Transactional email transport unavailable',
    );
    await jest.advanceTimersByTimeAsync(16000);
    await rejected;
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every(([, init]) => init!.signal!.aborted)).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
