# QuiverCRM Multi-Tenant Vendor Architecture

QuiverCRM now supports multiple independent vendors (tenants) on one deployment.

## Isolation
Every vendor-owned user, order, customer, task, and activity record carries `vendorId`. Authenticated vendor endpoints filter records by the logged-in user's vendor. The backend performs the checks; the UI is not trusted for isolation.

## Vendor onboarding
The first setup creates a vendor and its administrator. Platform administrators can create additional vendors from the **Vendors** tab. Each vendor receives a unique integration key (`qcrm_live_...`) for inbound store webhooks.

## Store integration
POST orders to `/api/integrations/orders` with the vendor integration key in `X-QuiverCRM-Key` (or Bearer auth). The order is automatically assigned to that vendor. The legacy global integration key remains supported and maps to the first migrated vendor for compatibility.

## Existing data migration
On startup, the migration creates a first vendor named **Godwyn Stores** when existing data has users but no vendors, then assigns existing users, orders, customers, tasks, and activity records to that vendor. This keeps the existing Upstash dataset usable.

## SaaS direction
The vendor model is intentionally designed for subscription plans: `starter`, `business`, and `enterprise`. Vendor status can be activated/deactivated by a platform administrator.


## Vendor service control
Platform admins can stop or start a vendor service. Stopping a vendor blocks its users from logging in and disables its store integration key until the service is started again.
