import { allowsOrigin } from './cors-origin';
it('allows the offline proxy only in test and rejects lookalike loopback origins', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';
    expect(allowsOrigin('http://localhost:3105')).toBe(true);
    expect(allowsOrigin('http://localhost.evil.test:3105')).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(allowsOrigin('http://localhost:3105')).toBe(false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
