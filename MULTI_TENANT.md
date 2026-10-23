# QuiverCRM Multi-Tenant Vendor Architecture

QuiverCRM now supports multiple independent vendors (tenants) on one deployment.

## Isolation
Every vendor-owned user, order, contact, task, and activity record carries `vendorId`. Authenticated endpoints only return records whose `vendorId` matches the logged-in user's vendor. This applies to platform administrators too: a platform admin sees orders only for the vendor their own account belongs to, never for other vendors. Orders can only be assigned to users of the same vendor. The backend performs the checks; the UI is not trusted for isolation.

## Vendor onboarding
The first setup creates a vendor and its administrator. Platform administrators can create additional vendors from the **Vendors** tab. Each vendor receives a unique integration key (`qcrm_live_...`) for inbound store webhooks.

## Store integration
POST orders to `/api/integrations/orders` with the vendor integration key in `X-QuiverCRM-Key` (or Bearer auth). The order is automatically assigned to that vendor. The legacy global integration key remains supported and maps to the first migrated vendor for compatibility.

## Existing data migration
On startup, the migration creates a first vendor named **Godwyn Stores** when existing data has users but no vendors, then assigns existing users, orders, tasks, and activity records to that vendor. This keeps the existing Upstash dataset usable.

## Customers removed
The separate Customers feature has been removed. Store orders still create or update a **Contact** (matched by phone number within the vendor), so contact history is kept. The `customers` collection is no longer read or written; any legacy `customers` data remains in Upstash untouched.

## Platform backup
`GET /api/platform/backup` returns vendors and users only. Orders, contacts, tasks and activity are excluded so the platform operator cannot read vendor sales data through the backup.

## SaaS direction
The vendor model is intentionally designed for subscription plans: `starter`, `business`, and `enterprise`. Vendor status can be activated/deactivated by a platform administrator.


## Vendor service control
Platform admins can stop or start a vendor service. Stopping a vendor blocks its users from logging in and disables its store integration key until the service is started again.
