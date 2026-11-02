import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/auth-store';
import { LoginPage } from './LoginPage';

const problem = (status: number, code: string) => new Response(JSON.stringify({ status, code, title: 'x' }), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

const me = {
  user: { id: 'u1', email: 'a@b.co', fullName: 'Ada', locale: 'en', emailVerified: true, totpEnabled: false },
  memberships: [{ memberId: 'm1', relation: 'MEMBER', roleKeys: ['ORG_OWNER'], organization: { id: 'o1', type: 'CUSTOMER', name: 'Org', timezone: 'Africa/Kigali' } }],
  activeOrganizationId: 'o1',
  permissions: ['organization.read'],
  entitlements: {},
};

function setup() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app" element={<p>Customer app home</p>} />
        <Route path="/forgot-password" element={<p>Forgot</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null, me: null, activeOrganizationId: null, status: 'anonymous' });
});

describe('LoginPage', () => {
  it('validates before calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a code-based message for wrong credentials without revealing which field was wrong', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(401, 'INVALID_CREDENTIALS')));
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('asks for the authenticator code when the server requires it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(401, 'TOTP_REQUIRED')));
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('offers to resend verification for an unverified account', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem(403, 'EMAIL_NOT_VERIFIED')));
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Resend verification email' })).toBeInTheDocument();
  });

  it('signs in, loads the profile and navigates to the app', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('/auth/login') ? ok({ accessToken: 't', expiresInSeconds: 900, user: me.user }) : ok(me)));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('Customer app home')).toBeInTheDocument());
    expect(useAuthStore.getState().accessToken).toBe('t');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});
