# auth

**Purpose:** identity and sessions — registration, email verification, login/logout, rotating refresh tokens, password reset/change, optional TOTP, step-up re-authentication, session management (ADR-0002).
**Owned tables:** `sessions`, `refresh_tokens`, `totp_recovery_codes` (via `TotpService`); uses `users` / `email_tokens` through `UsersService`.
**Public service methods:** `SessionService` (`create`, `rotate`, `revoke`, `revokeAllForUser`, `isRevoked`, `markStepUp`, `hasFreshStepUp`), `AuthService` (used by `AuthController` only).
**Guards exported:** `JwtAuthGuard`, `StepUpGuard` (registered globally in `AppModule`, order matters).
**Events/jobs:** none (audit rows only).
**Permissions:** none — routes are `@Public()` or `@Authenticated()`.
**Failure scenarios covered by tests:** wrong credentials (no enumeration), unverified email, lockout, token tampering, refresh reuse vs benign race, revoked session, expired reset token, duplicate registration.
**Not yet:** SSO, API keys, forced-2FA policy, 2FA secret key rotation.
