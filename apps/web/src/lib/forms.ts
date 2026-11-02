import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';
import { errorMessage } from './i18n';

/**
 * Maps an API failure onto a form: VALIDATION_FAILED field errors go inline; anything else becomes a
 * form-level message chosen by error `code` (never raw server text). Returns the form-level message.
 */
export function applyApiError<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>): string | null {
  if (err instanceof ApiError) {
    if (err.code === 'VALIDATION_FAILED' && setError) {
      const fields = err.fieldErrors;
      let mapped = 0;
      for (const [path, message] of Object.entries(fields)) {
        if (path) {
          setError(path as Path<T>, { message });
          mapped++;
        }
      }
      if (mapped > 0) return null;
    }
    if (err.code === 'NETWORK_ERROR') return errorMessage('NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
    return errorMessage(err.code);
  }
  return errorMessage(undefined);
}
