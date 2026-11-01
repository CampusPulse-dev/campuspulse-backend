import type { ZodTypeAny } from 'zod';
import * as domainEnums from './domain/enums';
import * as entities from './domain/entities';
import * as events from './api/events';
import * as attendance from './api/attendance';
import * as identity from './api/identity';
import * as errors from './api/errors';
import * as attendee from './api/attendee';

/**
 * Every schema published in the OpenAPI document, by name.
 *
 * The frontend generates its types from this, so adding a schema here is
 * how you make a shape available to it. A schema that is not registered
 * simply does not exist as far as the frontend is concerned.
 */
export const schemaRegistry: Record<string, ZodTypeAny> = Object.fromEntries(
  Object.entries({
    ...domainEnums,
    ...entities,
    ...events,
    ...attendance,
    ...identity,
    ...errors,
    ...attendee,
    // `page` is a helper that builds schemas; it is not one itself.
  }).filter(([name, value]) => name !== 'page' && isZodSchema(value)),
) as Record<string, ZodTypeAny>;

function isZodSchema(value: unknown): value is ZodTypeAny {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
}
