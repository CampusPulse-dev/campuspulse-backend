import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * Every non-2xx response leaves the API in the ApiError shape declared
 * in src/contract and published in the OpenAPI spec, so the frontend
 * has exactly one error path.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string) ?? 'unknown';

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: exception.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
        requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json({
        statusCode: status,
        code:
          typeof body === 'object' && body !== null && 'code' in body
            ? String((body as Record<string, unknown>).code)
            : exception.name,
        message: exception.message,
        requestId,
      });
      return;
    }

    // ORM/provider stacks may embed input values. Correlate by request ID instead.
    this.logger.error({
      msg: 'Unhandled request exception',
      method: request.method,
      path: request.path,
      errorType: exception instanceof Error ? exception.name : 'UnknownError',
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    });
  }
}
