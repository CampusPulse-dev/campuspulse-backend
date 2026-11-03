import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { schemaRegistry } from './contract/registry';

/**
 * One definition of the OpenAPI document, used by both the live /docs route
 * and scripts/generate-openapi.ts. A single definition is what makes the
 * committed spec trustworthy: the frontend generates its types from the
 * same document this API serves.
 *
 * Paths come from the Nest decorators; `components.schemas` is generated
 * directly from the Zod schemas in src/contract, so the published shapes
 * are the ones the API actually validates against rather than a
 * hand-maintained description of them.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CampusPulse API')
    .setDescription(
      'Events, identity, attendance and admin. Schemas are generated from the ' +
        'Zod definitions in src/contract; this document is what ' +
        'campuspulse-frontend generates its types from.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addServer('http://localhost:3001', 'Local')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ...Object.fromEntries(
      Object.entries(schemaRegistry).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject,
      ]),
    ),
  };

  return document;
}
