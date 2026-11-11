/** Shared by HTTP logging and the serialization regression test. */
export const privateLogOptions = {
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-dev-user"]',
    'req.body',
    'res.headers["set-cookie"]',
  ],
  serializers: {
    req(request: Record<string, unknown>) {
      return {
        method: request.method,
        url: typeof request.url === 'string' ? request.url.split('?')[0] : undefined,
        headers: request.headers,
      };
    },
  },
};
