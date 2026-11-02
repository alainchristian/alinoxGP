# device-support

**Purpose:** "my device is not in the catalogue". Onboarding stops honestly and the customer sends a request; nothing is guessed.
**Table:** `device_support_requests` [T] (RLS forced). **Endpoints:** `GET/POST /device-support-requests` (`devices.read` / `devices.register`); staff: `GET /admin/device-support-requests`, `POST …/:id/resolve` (`platform.catalogue.manage`; reads across tenants with the system role, a reviewed use).
