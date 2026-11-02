import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { P } from '@gps/shared';
import { IS_AUTHENTICATED, IS_PUBLIC, NO_TENANT, REQUIRED_PERMISSIONS } from '../../common/decorators';
import { PermissionsGuard } from './permissions.guard';

function guardWith(meta: Record<string, unknown>, permissions?: string[]) {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  const cls = {
    get: (k: string) => (k === 'tenant' && permissions ? { permissions: new Set(permissions) } : undefined),
  };
  const ctx = { getHandler: () => () => undefined, getClass: () => class {} } as unknown as ExecutionContext;
  return { run: () => new PermissionsGuard(reflector, cls as never).canActivate(ctx) };
}

describe('PermissionsGuard', () => {
  it('fails closed when a route declares nothing', () => {
    expect(() => guardWith({}).run()).toThrow(expect.objectContaining({ code: 'PERMISSION_NOT_DECLARED' }));
  });

  it.each([IS_PUBLIC, IS_AUTHENTICATED, NO_TENANT])('allows routes explicitly marked %s', (flag) => {
    expect(guardWith({ [flag]: true }).run()).toBe(true);
  });

  it('requires ALL listed permissions', () => {
    const meta = { [REQUIRED_PERMISSIONS]: [P.USERS_READ, P.USERS_UPDATE] };
    expect(guardWith(meta, [P.USERS_READ, P.USERS_UPDATE]).run()).toBe(true);
    expect(() => guardWith(meta, [P.USERS_READ]).run()).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
  });

  it('denies when there is no tenant context at all', () => {
    expect(() => guardWith({ [REQUIRED_PERMISSIONS]: [P.USERS_READ] }).run()).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    );
  });
});
