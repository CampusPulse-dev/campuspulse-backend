export function allowsOrigin(origin: string | undefined): boolean {
  if (!origin || origin === process.env.WEB_ORIGIN) return true;
  // Disposable browser tests use a transport-blocking loopback proxy for WebKit.
  return process.env.NODE_ENV === 'test' && /^http:\/\/localhost:\d+$/.test(origin);
}
