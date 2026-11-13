# ASRIVA Supabase Backend

Backend source for the ASRIVA An Tours storefront. This folder contains Supabase PostgreSQL migrations and Deno Edge Functions. The application remains Midtrans **Legacy CORE_API** only; Snap is not implemented.

## Edge Function map

| Frontend contract | Edge Function slug | Purpose |
|---|---|---|
| `products.list` | `asriva-products-list` | Published product catalogue and filters |
| `products.detail` | `asriva-product-detail` | Product, verified reviews, related products |
| `availability.validate` | `asriva-validate-availability` | Server-side slot, capacity and IDR quote |
| `bookings.create` | `asriva-create-booking` | Atomic quote consumption, capacity reservation and booking |
| `bookings.lookup` | `asriva-get-booking` | Guest contact verification or authenticated owner lookup |
| `payments.initiate` | `asriva-initiate-payment` | One Midtrans CORE_API invoice per booking |
| `payments.verifyStatus` | `asriva-verify-payment` | Midtrans GET Status API reconciliation |
| Midtrans notification | `asriva-midtrans-notification` | Signature verification and server-side status reconciliation |

Use the function URLs in the existing frontend Integration Configuration modal:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-products-list
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-product-detail
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-validate-availability
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-create-booking
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-get-booking
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-initiate-payment
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-verify-payment
```

All user-facing functions retain JWT verification at the Supabase gateway. The Midtrans notification function is the only endpoint configured with `verify_jwt = false`; it verifies the Midtrans SHA-512 signature itself and then calls Midtrans GET Status before changing payment state.

## Database

Migration: `migrations/20261113000100_asriva_booking_payment_backend.sql`

| Table | Purpose |
|---|---|
| `asriva_products` | Product catalogue and display data |
| `asriva_product_reviews` | Published verified reviews |
| `asriva_inventory_slots` | Date, option, pickup/time-specific capacity and price |
| `asriva_quotes` | Short-lived opaque quote token hashes and server price snapshots |
| `asriva_bookings` | Booking, contact hashes, owner and opaque booking-access token hash |
| `asriva_payment_invoices` | Unique invoice per booking, locked payment channel, Midtrans response |
| `asriva_payment_events` | Verified webhook event audit trail |

RLS is enabled on all application tables. Direct `anon` and `authenticated` table grants are revoked; the Edge Functions use the server-side Supabase secret/service-role key. Never expose that key to the browser.

### Catalogue and inventory population

The migration intentionally creates an empty catalogue. No products, prices, reviews, schedules or capacity are fabricated. An authorized operator must populate `asriva_products`, `asriva_product_reviews` and `asriva_inventory_slots` with real merchant data before the storefront can return bookable products.

`product_data` stores the existing frontend Product display fields in camelCase (for example `coverImage`, `duration`, `priceUnit`, `availableQuota`, `description`, `options`, `itinerary`, `inclusions`, `exclusions`). The authoritative price is always `base_price` or the matching inventory slot's `unit_price`; never trust the price sent by the browser.

An inventory slot must match the requested product, start/end date, option, pickup location and time slot. Missing inventory means unavailable. Capacity is reserved atomically when the booking is created.

## Booking access and idempotency

- Guest lookup requires booking reference plus the exact email or phone entered at booking. The backend stores SHA-256 hashes for comparison.
- Successful lookup issues a high-entropy opaque `bookingAccessToken`; only its hash is stored in PostgreSQL. The token expires according to `ASRIVA_BOOKING_ACCESS_TTL_SECONDS`.
- Payment initiation and status verification require either a verified Supabase user who owns the booking or a valid booking access token.
- Booking creation consumes a short-lived quote token and reserves capacity in one PostgreSQL transaction. Duplicate booking requests with the same idempotency key return the existing booking.
- The database enforces one invoice row per booking. The first payment channel is locked. Retries reuse the same Midtrans order ID, invoice and channel; they do not create a second invoice.

## Midtrans CORE_API

The implementation uses the Legacy Core API endpoints:
- Charge: `POST https://api.sandbox.midtrans.com/v2/charge` or production host.
- Status: `GET /v2/{order_id}/status`.
- Notification signature: `SHA512(order_id + status_code + gross_amount + ServerKey)`.

Payment-channel enablement differs per merchant. Configure a channel that is actually active on the ASRIVA Midtrans merchant. `MIDTRANS_CHANNEL_CONFIG_JSON` is merged into the Charge request under the selected `payment_type`. Example for a merchant-enabled BCA bank transfer:

```json
{
  "bank_transfer": {
    "bank": "bca"
  }
}
```

Do not use this example unless BCA VA is enabled for the merchant. Configure the Midtrans Payment Notification URL to:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/asriva-midtrans-notification
```

The browser never receives `MIDTRANS_SERVER_KEY`.

## Required Edge Function secrets

See `functions/.env.example`. Required values:
- Supabase-provided `SUPABASE_URL` and server secret/service-role key.
- `MIDTRANS_ENVIRONMENT`: `sandbox` or `production`.
- `MIDTRANS_SERVER_KEY`.
- `MIDTRANS_DEFAULT_PAYMENT_TYPE` or a frontend `preferredChannel`.
- `MIDTRANS_CHANNEL_CONFIG_JSON` matching the chosen payment type.

Optional:
- `ASRIVA_QUOTE_TTL_SECONDS` (default 600).
- `ASRIVA_BOOKING_ACCESS_TTL_SECONDS` (default 86400).

Never commit `supabase/functions/.env` or real credentials. Production secrets belong in Supabase Edge Function Secrets.

## Current implementation boundaries

- No Supabase project is linked and no migration or Edge Function has been executed/deployed.
- Product/admin CRUD is not part of the current storefront API contract; catalogue data must be populated through a separately authorized admin workflow.
- The booking access token is returned by create/lookup. The frontend must preserve it in tab-scoped storage and include it in payment initiation/status requests; do not put it in a URL or log it.
- Run local Edge Function and SQL migration tests before applying this migration to a hosted project.
