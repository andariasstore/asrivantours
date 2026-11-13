-- ASRIVA booking, quote and Midtrans CORE_API backend
-- Apply only after reviewing this migration in the target Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.asriva_products (
  id text primary key,
  category text not null,
  title text not null,
  destination text,
  base_price bigint not null check (base_price >= 0),
  taxes_and_fees bigint not null default 0 check (taxes_and_fees >= 0),
  is_published boolean not null default false,
  product_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asriva_products_published_category_idx
  on public.asriva_products (is_published, category);

create table if not exists public.asriva_product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.asriva_products(id) on delete cascade,
  reviewer_name text not null,
  rating numeric(2,1) not null check (rating between 1 and 5),
  review_text text not null,
  is_verified boolean not null default false,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.asriva_inventory_slots (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.asriva_products(id) on delete cascade,
  start_date date not null,
  end_date date,
  option_id text,
  pickup_location text,
  time_slot text,
  capacity_total integer not null check (capacity_total >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0 and reserved_count <= capacity_total),
  unit_price bigint check (unit_price is null or unit_price >= 0),
  taxes_and_fees bigint check (taxes_and_fees is null or taxes_and_fees >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists asriva_inventory_slots_unique_idx
  on public.asriva_inventory_slots (
    product_id, start_date, coalesce(end_date, date '0001-01-01'),
    coalesce(option_id, ''), coalesce(pickup_location, ''), coalesce(time_slot, '')
  );

create table if not exists public.asriva_quotes (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  inventory_slot_id uuid not null references public.asriva_inventory_slots(id),
  product_id text not null references public.asriva_products(id),
  schedule jsonb not null,
  travelers integer not null check (travelers > 0),
  unit_price bigint not null check (unit_price >= 0),
  subtotal bigint not null check (subtotal >= 0),
  taxes_and_fees bigint not null check (taxes_and_fees >= 0),
  total_amount bigint not null check (total_amount >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.asriva_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  idempotency_key_hash bytea not null unique,
  user_id uuid references auth.users(id) on delete set null,
  quote_id uuid not null unique references public.asriva_quotes(id),
  inventory_slot_id uuid not null references public.asriva_inventory_slots(id),
  contact_data jsonb not null,
  contact_email_hash bytea not null,
  contact_phone_hash bytea not null,
  booking_access_token_hash bytea not null,
  booking_access_expires_at timestamptz not null,
  booking_data jsonb not null,
  booking_status text not null default 'pending_payment'
    check (booking_status in ('draft','pending_confirmation','confirmed','pending_payment','paid','cancelled','expired')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','pending','settlement','capture','failed','expired','refund_pending','refunded')),
  total_amount bigint not null check (total_amount >= 0),
  currency text not null default 'IDR' check (currency = 'IDR'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asriva_bookings_user_created_idx
  on public.asriva_bookings (user_id, created_at desc);
create index if not exists asriva_bookings_status_idx
  on public.asriva_bookings (booking_status, payment_status);

create table if not exists public.asriva_payment_invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.asriva_bookings(id) on delete restrict,
  order_id text not null unique,
  idempotency_key_hash bytea not null,
  payment_channel text not null,
  gateway_request jsonb not null,
  gateway_response jsonb,
  gateway_transaction_id text,
  transaction_status text not null default 'processing',
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asriva_payment_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.asriva_payment_invoices(id) on delete set null,
  order_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table if not exists public.asriva_booking_lookup_rate_limits (
  id uuid primary key default gen_random_uuid(),
  ip_hash bytea not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  created_at timestamptz not null default now(),
  unique (ip_hash, window_started_at)
);

create or replace function public.asriva_consume_booking_lookup_attempt(
  p_ip_hash bytea,
  p_window_started_at timestamptz,
  p_max_attempts integer default 30
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_attempts integer;
begin
  insert into public.asriva_booking_lookup_rate_limits (ip_hash, window_started_at, attempts)
  values (p_ip_hash, p_window_started_at, 1)
  on conflict (ip_hash, window_started_at)
  do update set attempts = public.asriva_booking_lookup_rate_limits.attempts + 1
  returning attempts into v_attempts;

  return v_attempts <= p_max_attempts;
end;
$;

create index if not exists asriva_payment_events_order_idx
  on public.asriva_payment_events (order_id, received_at desc);

-- Atomic quote consumption + inventory reservation + booking creation.
-- SECURITY INVOKER: callable only by service_role; no end-user grants are added.
create or replace function public.asriva_create_booking_atomic(
  p_idempotency_key_hash bytea,
  p_booking_reference text,
  p_user_id uuid,
  p_quote_token_hash bytea,
  p_booking_data jsonb,
  p_contact_data jsonb,
  p_contact_email_hash bytea,
  p_contact_phone_hash bytea,
  p_booking_access_token_hash bytea,
  p_booking_access_expires_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.asriva_bookings%rowtype;
  v_quote public.asriva_quotes%rowtype;
  v_slot public.asriva_inventory_slots%rowtype;
  v_booking public.asriva_bookings%rowtype;
  v_travelers integer;
begin
  select * into v_existing
  from public.asriva_bookings
  where idempotency_key_hash = p_idempotency_key_hash
  for update;

  if found then
    if v_existing.booking_data->>'productId' is distinct from p_booking_data->>'productId'
       or v_existing.booking_data->'schedule' is distinct from p_booking_data->'schedule'
       or v_existing.booking_data->'contact' is distinct from p_booking_data->'contact'
       or v_existing.booking_data->'travelers' is distinct from p_booking_data->'travelers'
       or v_existing.booking_data->>'specialRequests' is distinct from p_booking_data->>'specialRequests' then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = 'P0001';
    end if;
    update public.asriva_bookings
      set booking_access_token_hash = p_booking_access_token_hash,
          booking_access_expires_at = p_booking_access_expires_at,
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    return jsonb_build_object('booking', v_existing.booking_data ||
      jsonb_build_object('bookingReference', v_existing.booking_reference,
        'bookingStatus', v_existing.booking_status, 'paymentStatus', v_existing.payment_status,
        'totalAmount', v_existing.total_amount, 'currency', v_existing.currency));
  end if;

  select * into v_quote
  from public.asriva_quotes
  where token_hash = p_quote_token_hash
  for update;

  if not found or v_quote.expires_at <= now() then
    raise exception 'QUOTE_INVALID_OR_EXPIRED' using errcode = 'P0001';
  end if;

  if v_quote.consumed_at is not null then
    select * into v_existing
    from public.asriva_bookings
    where quote_id = v_quote.id
    for update;
    if found then
      if v_existing.booking_data->>'productId' is distinct from p_booking_data->>'productId'
         or v_existing.booking_data->'schedule' is distinct from p_booking_data->'schedule'
         or v_existing.booking_data->'contact' is distinct from p_booking_data->'contact'
       or v_existing.booking_data->'travelers' is distinct from p_booking_data->'travelers'
       or v_existing.booking_data->>'specialRequests' is distinct from p_booking_data->>'specialRequests' then
        raise exception 'QUOTE_ALREADY_USED_WITH_DIFFERENT_PAYLOAD' using errcode = 'P0001';
      end if;
      update public.asriva_bookings
        set booking_access_token_hash = p_booking_access_token_hash,
            booking_access_expires_at = p_booking_access_expires_at,
            updated_at = now()
        where id = v_existing.id
        returning * into v_existing;
      return jsonb_build_object('booking', v_existing.booking_data ||
        jsonb_build_object('bookingReference', v_existing.booking_reference,
          'bookingStatus', v_existing.booking_status, 'paymentStatus', v_existing.payment_status,
          'totalAmount', v_existing.total_amount, 'currency', v_existing.currency));
    end if;
    raise exception 'QUOTE_ALREADY_CONSUMED' using errcode = 'P0001';
  end if;

  v_travelers := coalesce((p_booking_data->'schedule'->>'travelers')::integer, v_quote.travelers);
  if v_travelers <> v_quote.travelers or p_booking_data->>'productId' <> v_quote.product_id
     or p_booking_data->'schedule'->>'startDate' is distinct from v_quote.schedule->>'startDate'
     or coalesce(p_booking_data->'schedule'->>'endDate', '') is distinct from coalesce(v_quote.schedule->>'endDate', '')
     or coalesce(p_booking_data->'schedule'->>'optionId', '') is distinct from coalesce(v_quote.schedule->>'optionId', '')
     or coalesce(p_booking_data->'schedule'->>'pickupLocation', '') is distinct from coalesce(v_quote.schedule->>'pickupLocation', '')
     or coalesce(p_booking_data->'schedule'->>'timeSlot', '') is distinct from coalesce(v_quote.schedule->>'timeSlot', '') then
    raise exception 'QUOTE_PAYLOAD_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_slot
  from public.asriva_inventory_slots
  where id = v_quote.inventory_slot_id
  for update;

  if not found or not v_slot.is_active or
     v_slot.capacity_total - v_slot.reserved_count < v_travelers then
    raise exception 'INVENTORY_NO_LONGER_AVAILABLE' using errcode = 'P0001';
  end if;

  update public.asriva_inventory_slots
    set reserved_count = reserved_count + v_travelers
    where id = v_slot.id;

  insert into public.asriva_bookings (
    booking_reference, idempotency_key_hash, user_id, quote_id, inventory_slot_id,
    contact_data, contact_email_hash, contact_phone_hash,
    booking_access_token_hash, booking_access_expires_at, booking_data,
    booking_status, payment_status, total_amount
  ) values (
    p_booking_reference, p_idempotency_key_hash, p_user_id, v_quote.id, v_slot.id,
    p_contact_data, p_contact_email_hash, p_contact_phone_hash,
    p_booking_access_token_hash, p_booking_access_expires_at, p_booking_data,
    'pending_payment', 'unpaid', v_quote.total_amount
  ) returning * into v_booking;

  update public.asriva_quotes set consumed_at = now() where id = v_quote.id;

  return jsonb_build_object('booking', v_booking.booking_data ||
    jsonb_build_object('bookingReference', v_booking.booking_reference,
      'bookingStatus', v_booking.booking_status, 'paymentStatus', v_booking.payment_status,
      'totalAmount', v_booking.total_amount, 'currency', v_booking.currency));
end;
$$;

-- One invoice per booking. The first channel is permanently locked.
-- Concurrent retries receive the same invoice; only an expired processing lease can be reclaimed.
create or replace function public.asriva_claim_payment_invoice(
  p_booking_id uuid,
  p_order_id text,
  p_idempotency_key_hash bytea,
  p_payment_channel text,
  p_gateway_request jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice public.asriva_payment_invoices%rowtype;
  v_claimed boolean := false;
begin
  insert into public.asriva_payment_invoices (
    booking_id, order_id, idempotency_key_hash, payment_channel, gateway_request, lease_until
  ) values (
    p_booking_id, p_order_id, p_idempotency_key_hash, p_payment_channel, p_gateway_request, now() + interval '60 seconds'
  ) on conflict (booking_id) do nothing returning * into v_invoice;

  if found then
    return jsonb_build_object('invoice', to_jsonb(v_invoice), 'claimed', true, 'channelLocked', true);
  end if;

  select * into v_invoice
  from public.asriva_payment_invoices
  where booking_id = p_booking_id
  for update;

  if v_invoice.gateway_response is null and
     (v_invoice.lease_until is null or v_invoice.lease_until <= now()) then
    update public.asriva_payment_invoices
      set lease_until = now() + interval '60 seconds',
          updated_at = now()
      where id = v_invoice.id
      returning * into v_invoice;
    v_claimed := true;
  end if;

  return jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'claimed', v_claimed,
    'channelLocked', true
  );
end;
$$;

revoke all on public.asriva_products, public.asriva_product_reviews,
  public.asriva_inventory_slots, public.asriva_quotes, public.asriva_bookings,
  public.asriva_payment_invoices, public.asriva_payment_events,
  public.asriva_booking_lookup_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.asriva_products,
  public.asriva_product_reviews, public.asriva_inventory_slots,
  public.asriva_quotes, public.asriva_bookings,
  public.asriva_payment_invoices, public.asriva_payment_events,
  public.asriva_booking_lookup_rate_limits to service_role;

alter table public.asriva_products enable row level security;
alter table public.asriva_product_reviews enable row level security;
alter table public.asriva_inventory_slots enable row level security;
alter table public.asriva_quotes enable row level security;
alter table public.asriva_bookings enable row level security;
alter table public.asriva_payment_invoices enable row level security;
alter table public.asriva_payment_events enable row level security;
alter table public.asriva_booking_lookup_rate_limits enable row level security;

revoke all on function public.asriva_create_booking_atomic(bytea,text,uuid,bytea,jsonb,jsonb,bytea,bytea,bytea,timestamptz) from public, anon, authenticated;
grant execute on function public.asriva_create_booking_atomic(bytea,text,uuid,bytea,jsonb,jsonb,bytea,bytea,bytea,timestamptz) to service_role;
revoke all on function public.asriva_claim_payment_invoice(uuid,text,bytea,text,jsonb) from public, anon, authenticated;
grant execute on function public.asriva_claim_payment_invoice(uuid,text,bytea,text,jsonb) to service_role;

revoke all on function public.asriva_consume_booking_lookup_attempt(bytea,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.asriva_consume_booking_lookup_attempt(bytea,timestamptz,integer) to service_role;
