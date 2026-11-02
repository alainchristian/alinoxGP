# drivers

**Purpose:** the people who drive an organization's vehicles. **Table:** `drivers` [T] — deliberately minimal personal data (name, phone E.164, email, licence number/class/expiry, status, notes); no national id, photo or address.
**Endpoints:** `GET /drivers` (`drivers.read`; `q`, `status`, `assigned`) · `POST`, `PATCH /:id`, `DELETE /:id` (`drivers.manage`). Assignment to a vehicle is done through the vehicle (`POST/DELETE /vehicles/:id/driver`).
**Rules:** licence number unique per organization among live drivers (`DRIVER_LICENSE_TAKEN`); an inactive or deleted driver cannot be assigned; an assigned driver cannot be deleted or deactivated (`DRIVER_ASSIGNED`); soft delete; audit entries name the fields changed, never the personal values.
