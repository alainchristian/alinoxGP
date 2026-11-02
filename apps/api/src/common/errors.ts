import { HttpException } from '@nestjs/common';

/** Domain error carrying a stable machine-readable `code` (clients switch on code, never on message). */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    status: number,
    public readonly title: string,
    public readonly detail?: string,
    public readonly errors?: { path: string; message: string }[],
  ) {
    super({ code, title, detail, errors }, status);
  }
}

export const notFound = (code: string, title = 'Resource not found') => new AppException(code, 404, title);
export const forbidden = (code: string, title = 'Forbidden', detail?: string) =>
  new AppException(code, 403, title, detail);
export const unauthorized = (code: string, title = 'Authentication required', detail?: string) =>
  new AppException(code, 401, title, detail);
export const conflict = (code: string, title: string, detail?: string) => new AppException(code, 409, title, detail);
export const badRequest = (code: string, title: string, detail?: string) => new AppException(code, 400, title, detail);
