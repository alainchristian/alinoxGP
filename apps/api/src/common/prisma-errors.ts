import { Prisma } from '@prisma/client';

/** True for a unique-constraint violation, including hand-written partial/expression unique indexes. */
export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return true;
  // Raw-SQL indexes and triggers can surface as unknown request errors carrying the SQLSTATE in the message.
  return err instanceof Error && /\b23505\b|unique constraint|duplicate key/i.test(err.message);
}

/** True for CHECK / trigger violations raised by our hand-written migration SQL (SQLSTATE 23514, 42501). */
export function isRuleViolation(err: unknown): boolean {
  return err instanceof Error && /\b23514\b|\b42501\b/.test(err.message);
}
