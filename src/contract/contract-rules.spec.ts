import { DecideVerificationBody } from './api/identity';
import { StudentEmail } from './domain/primitives';
import { CreateEventBody } from './api/events';

describe('DecideVerificationBody', () => {
  it('accepts an approval with no note', () => {
    expect(DecideVerificationBody.safeParse({ decision: 'APPROVED' }).success).toBe(true);
  });

  it('rejects a rejection with no note', () => {
    const r = DecideVerificationBody.safeParse({ decision: 'REJECTED' });
    expect(r.success).toBe(false);
  });

  it('rejects a rejection whose note is only whitespace', () => {
    const r = DecideVerificationBody.safeParse({ decision: 'REJECTED', note: '   ' });
    expect(r.success).toBe(false);
  });

  it('accepts an info request with a real note', () => {
    const r = DecideVerificationBody.safeParse({
      decision: 'INFO_REQUESTED',
      note: 'Please re-upload; the ID photo is cropped.',
    });
    expect(r.success).toBe(true);
  });
});

describe('StudentEmail', () => {
  it('accepts a University of Ibadan address', () => {
    expect(StudentEmail.safeParse('tobi@stu.ui.edu.ng').success).toBe(true);
  });

  it('rejects an unaffiliated address', () => {
    expect(StudentEmail.safeParse('tobi@gmail.com').success).toBe(false);
  });
});

describe('CreateEventBody', () => {
  it('requires a category', () => {
    const r = CreateEventBody.safeParse({
      title: 'Freshers Night',
      description: 'Come through',
      startsAt: '2026-09-01T19:00:00+01:00',
      endsAt: '2026-09-01T23:00:00+01:00',
      venueName: 'Trenchard Hall',
      coverImageUrl: 'https://example.com/a.jpg',
    });
    expect(r.success).toBe(false);
  });
});
