import { Writable } from 'node:stream';
import pino from 'pino';
import { privateLogOptions } from './http-logger';

it('removes bodies, credentials, query PII and Set-Cookie from actual serialized Pino output [S6-02]', () => {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const logger = pino(privateLogOptions, stream);
  logger.info({
    req: {
      method: 'POST',
      url: '/verification/student/email-otp?email=sentinel-query@stu.ui.edu.ng',
      headers: {
        authorization: 'Bearer sentinel-bearer',
        cookie: 'sentinel-cookie',
        'x-dev-user': 'sentinel-dev@stu.ui.edu.ng',
      },
      body: {
        email: 'sentinel-body@stu.ui.edu.ng',
        password: 'sentinel-password',
        code: 'sentinel-otp',
      },
    },
    res: { statusCode: 200, headers: { 'set-cookie': 'sentinel-refresh-token' } },
  });
  for (const secret of [
    'sentinel-query',
    'sentinel-bearer',
    'sentinel-cookie',
    'sentinel-dev',
    'sentinel-body',
    'sentinel-password',
    'sentinel-otp',
    'sentinel-refresh-token',
  ])
    expect(output).not.toContain(secret);
  expect(output).toContain('/verification/student/email-otp');
});
