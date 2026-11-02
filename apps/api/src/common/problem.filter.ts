import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import type { ProblemDetails } from '@gps/shared';
import { AppException } from './errors';

const GENERIC: Record<number, { code: string; title: string }> = {
  400: { code: 'BAD_REQUEST', title: 'Bad request' },
  401: { code: 'UNAUTHENTICATED', title: 'Authentication required' },
  403: { code: 'FORBIDDEN', title: 'Forbidden' },
  404: { code: 'NOT_FOUND', title: 'Resource not found' },
  409: { code: 'CONFLICT', title: 'Conflict' },
  429: { code: 'RATE_LIMITED', title: 'Too many requests' },
};

/**
 * RFC 9457 problem details for every error. Never leaks stack traces, SQL or provider responses.
 * Clients switch on `code`, never on `title`/`detail`.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let body: ProblemDetails;

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      body = {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof AppException) {
      body = {
        type: 'about:blank',
        title: exception.title,
        status: exception.getStatus(),
        code: exception.code,
        ...(exception.detail ? { detail: exception.detail } : {}),
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const g = GENERIC[status] ?? { code: `HTTP_${status}`, title: exception.name };
      body = { type: 'about:blank', title: g.title, status, code: g.code };
    } else {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      body = {
        type: 'about:blank',
        title: 'Internal server error',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
      };
    }
    res.status(body.status).type('application/problem+json').json(body);
  }
}
