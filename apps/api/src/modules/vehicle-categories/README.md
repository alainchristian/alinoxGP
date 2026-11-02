# vehicle-categories

**Purpose:** a customer's own grouping of vehicles. **Table:** `vehicle_categories` [T] (name unique per organization ignoring case/space; optional `#rrggbb` accent that is never a status colour).
**Endpoints:** `GET /vehicle-categories` (`vehicles.read`, with live vehicle counts) · `POST`, `PATCH /:id`, `DELETE /:id` (`vehicles.categories.manage`; Fleet Manager, Administrator, Owner).
**Rules:** duplicate name `CATEGORY_NAME_TAKEN` (409); delete refused while a live vehicle uses it (`CATEGORY_IN_USE`, 409); audited.
