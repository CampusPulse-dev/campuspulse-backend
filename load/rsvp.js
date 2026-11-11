/* global __ENV, open */
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

const data = new SharedArray('fixture', () => [JSON.parse(open(__ENV.LOAD_FIXTURE))])[0];
const origin = __ENV.API_BASE_URL || 'http://localhost:3001';
if (!__ENV.LOAD_FIXTURE) throw new Error('Set LOAD_FIXTURE to the synthetic fixture path');
const duration = new Trend('rsvp_duration', true);
const errors = new Counter('unexpected_errors');
const raceConfirmed = new Counter('race_confirmed');
const raceWaitlisted = new Counter('race_waitlisted');
export const options = {
  scenarios: {
    sustained: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1m',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'rsvp',
    },
    feed: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'feed',
    },
    contention: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      maxDuration: '1m',
      exec: 'race',
    },
  },
  thresholds: {
    rsvp_duration: ['p(95)<1000'],
    unexpected_errors: ['count==0'],
    race_confirmed: ['count==10'],
    race_waitlisted: ['count==40'],
    dropped_iterations: ['count==0'],
    checks: ['rate==1'],
  },
};
function reserve(eventId) {
  errors.add(0);
  const token = data.tokens[exec.scenario.iterationInTest];
  const response = http.post(`${origin}/api/v1/attendance/rsvps`, JSON.stringify({ eventId }), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { operation: 'rsvp' },
  });
  if (!check(response, { 'RSVP accepted': (r) => r.status === 201 })) errors.add(1);
  return response;
}
export function rsvp() {
  const response = reserve(data.eventId);
  duration.add(response.timings.duration);
}
export function feed() {
  const response = http.get(`${origin}/api/v1/events/feed?limit=20`);
  if (!check(response, { 'feed accepted': (r) => r.status === 200 })) errors.add(1);
}
export function race() {
  const response = reserve(data.raceEventId);
  if (response.status !== 201) return;
  const status = response.json('status');
  if (status === 'CONFIRMED') raceConfirmed.add(1);
  else if (status === 'WAITLISTED') raceWaitlisted.add(1);
  else errors.add(1);
}
export function teardown() {
  for (const [eventId, expected] of [
    [data.eventId, 1000],
    [data.raceEventId, 10],
  ]) {
    const response = http.get(`${origin}/api/v1/attendance/events/${eventId}/stats`, {
      headers: { Authorization: `Bearer ${data.ownerToken}` },
    });
    check(response, {
      'no overbooking and exact capacity count': (r) =>
        r.status === 200 && r.json('rsvpCount') === expected,
    });
  }
}
