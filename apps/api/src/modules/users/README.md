# users

**Purpose:** global user identity primitives shared by `auth` and `organizations`: user records, argon2id hashing, single-use email tokens (verify / reset; only hashes stored), crypto helpers (sha256, AES-256-GCM, random tokens).
**Owned tables:** `users`, `email_tokens`.
**Public service:** `UsersService` (`findByEmail`, `create`, `hashPassword`, `verifyPassword`, `verifyDummyPassword` for timing equalisation, `issueEmailToken`, `consumeEmailToken`, `markEmailVerified`, `toDto`).
**No endpoints, no permissions** (users are managed through organizations/members and /auth).
