import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { ListMeta } from '@gps/shared';
import { map } from 'rxjs';

/** Return from a controller to produce `{ data: [...], meta }`. */
export class PagedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: ListMeta,
  ) {}
}

/** Wraps successful responses in the standard envelope `{ data }` / `{ data, meta }`. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((result: unknown) => {
        if (result === undefined) return result;
        if (result instanceof PagedResult) return { data: result.items, meta: result.meta };
        return { data: result };
      }),
    );
  }
}
