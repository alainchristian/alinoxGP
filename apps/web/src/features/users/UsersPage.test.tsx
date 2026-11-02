import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StepUpProvider } from '@/components/step-up';
import { useAuthStore } from '@/lib/auth-store';
import { UsersPage } from './UsersPage';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const members = [
  { memberId: 'm-owner', userId: 'u-owner', email: 'owner@x.co', fullName: 'Olive Owner', status: 'ACTIVE', roleKeys: ['ORG_OWNER'], createdAt: '2026-11-01T00:00:00Z' },
  { memberId: 'm-me', userId: 'u-me', email: 'me@x.co', fullName: 'Me Myself', status: 'ACTIVE', roleKeys: ['ORG_ADMIN'], createdAt: '2026-11-01T00:00:00Z' },
  { memberId: 'm-v', userId: 'u-v', email: 'viewer@x.co', fullName: 'Vic Viewer', status: 'ACTIVE', roleKeys: ['VIEWER'], createdAt: '2026-11-01T00:00:00Z' },
];
const roles = ['ORG_OWNER', 'ORG_ADMIN', 'VIEWER', 'FLEET_MANAGER'].map((key) => ({ key, name: key, description: null, scope: 'ORGANIZATION', permissions: [] }));

function mockApi(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = extra?.(url, init);
    if (custom) return custom;
    if (url.includes('/members')) return res(200, { data: members, meta: { page: 1, pageSize: 100, total: 3 } });
    if (url.includes('/invitations')) return res(200, { data: [] });
    if (url.includes('/roles')) return res(200, { data: roles });
    return res(404, { code: 'NOT_FOUND', status: 404, title: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(permissions: string[]) {
  useAuthStore.setState({
    accessToken: 't',
    activeOrganizationId: 'org-1',
    status: 'authenticated',
    me: {
      user: { id: 'u-me', email: 'me@x.co', fullName: 'Me Myself', locale: 'en', emailVerified: true, totpEnabled: false },
      memberships: [],
      activeOrganizationId: 'org-1',
      permissions,
      entitlements: {},
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StepUpProvider>
          <UsersPage />
        </StepUpProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe('UsersPage', () => {
  it('a read-only user sees members but no invite button, role selects or action buttons', async () => {
    mockApi();
    renderPage(['users.read']);
    expect(await screen.findByText('Vic Viewer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite user/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('an administrator can change others but never the owner or themselves', async () => {
    mockApi();
    renderPage(['users.read', 'users.update', 'users.remove', 'users.invite', 'roles.read']);
    expect(await screen.findByText('Vic Viewer')).toBeInTheDocument();
    // Only the viewer row is editable: exactly one role select and one Remove button.
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getByText('(you)')).toBeInTheDocument();
    // The owner role is never offered as an assignable option.
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.value);
    expect(options).not.toContain('ORG_OWNER');
  });

  it('asks for the password once when the server requires step-up, then retries the change', async () => {
    let patches = 0;
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/members/m-v') && init?.method === 'PATCH') {
        patches++;
        return patches === 1 ? res(403, { code: 'STEP_UP_REQUIRED', status: 403, title: 'x' }) : res(200, { data: members[2] });
      }
      if (url.endsWith('/auth/step-up')) return res(204);
      return undefined;
    });
    renderPage(['users.read', 'users.update', 'roles.read']);
    await screen.findByText('Vic Viewer');
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'FLEET_MANAGER');
    await userEvent.type(await screen.findByLabelText('Password'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(patches).toBe(2));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/step-up'))).toBe(true);
  });

  it('shows a plain-language error when loading fails, with a retry', async () => {
    mockApi((url) => (url.includes('/members') ? res(403, { code: 'PERMISSION_DENIED', status: 403, title: 'x' }) : undefined));
    renderPage(['users.read']);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
