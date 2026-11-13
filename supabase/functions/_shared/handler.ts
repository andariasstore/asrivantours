import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const fail = (status: number, code: string, message: string) =>
  json({ success: false, error: code, message }, status);

const env = (name: string, fallback = "") => Deno.env.get(name) ?? fallback;
const parseJson = (value: string, fallback: unknown = {}) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

function adminClient() {
  const url = env("SUPABASE_URL");
  let secret = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) {
    const keys = parseJson(env("SUPABASE_SECRET_KEYS", "{}"), {}) as Record<string, string>;
    secret = keys.default ?? "";
  }
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY atau SUPABASE_SECRET_KEYS.default belum dikonfigurasi.");
  if (!url) throw new Error("SUPABASE_URL belum dikonfigurasi.");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function currentUser(req: Request, admin: ReturnType<typeof adminClient>) {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const anon = env("SUPABASE_ANON_KEY");
  const publishable = parseJson(env("SUPABASE_PUBLISHABLE_KEYS", "{}"), {}) as Record<string, string>;
  if (token === anon || Object.values(publishable).includes(token)) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const asBytea = (bytes: Uint8Array) => `\\x${bytesToHex(bytes)}`;
async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function hashContact(value: string, kind: "email" | "phone") {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.replace(/[^0-9]/g, "");
  return sha256(normalized);
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function sameBytes(a: Uint8Array | string | null, b: Uint8Array) {
  if (!a) return false;
  const left = typeof a === "string"
    ? (a.startsWith("\\x")
      ? new Uint8Array((a.slice(2).match(/.{1,2}/g) ?? []).map((part) => parseInt(part, 16)))
      : new TextEncoder().encode(a))
    : a;
  if (left.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ b[i];
  return diff === 0;
}
function productView(row: any) {
  return {
    ...(row.product_data ?? {}),
    id: row.id,
    category: row.category,
    title: row.title,
    destination: row.destination,
    basePrice: Number(row.base_price),
    taxesAndFees: Number(row.taxes_and_fees),
  };
}
function bookingView(row: any) {
  return {
    ...(row.booking_data ?? {}),
    bookingReference: row.booking_reference,
    bookingStatus: row.booking_status,
    paymentStatus: row.payment_status,
    productTitle: row.booking_data?.productTitle ?? row.booking_data?.product?.title ?? "",
    startDate: row.booking_data?.startDate ?? row.booking_data?.schedule?.startDate ?? "",
    totalAmount: Number(row.total_amount),
    currency: row.currency,
  };
}
function requireText(value: unknown, name: string, max = 300) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw Object.assign(new Error(`Field ${name} tidak valid.`), { status: 400, code: "INVALID_INPUT" });
  }
  return value.trim();
}
function requireNumber(value: unknown, name: string, min = 1, max = 50) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw Object.assign(new Error(`Field ${name} tidak valid.`), { status: 400, code: "INVALID_INPUT" });
  }
  return n;
}
function normalizeMidtransStatus(raw: any) {
  const status = String(raw?.transaction_status ?? "").toLowerCase();
  const statusCode = String(raw?.status_code ?? "");
  const fraudStatus = String(raw?.fraud_status ?? "").toLowerCase();
  const fraudAccepted = !fraudStatus || fraudStatus === "accept";
  if (status === "settlement" && statusCode === "200" && fraudAccepted) return "settlement";
  if (status === "capture" && statusCode === "200" && fraudAccepted) return "capture";
  if (status === "expire") return "expired";
  if (["deny", "cancel", "failure"].includes(status)) return "failed";
  if (status === "refund" || status === "partial_refund") return "refunded";
  if (status === "pending" || status === "authorize" || status === "capture" || status === "settlement") return "pending";
  return "pending";
}
async function midtransRequest(path: string, init: RequestInit = {}) {
  const serverKey = env("MIDTRANS_SERVER_KEY");
  if (!serverKey) throw Object.assign(new Error("MIDTRANS_SERVER_KEY belum dikonfigurasi."), { status: 503, code: "PAYMENT_NOT_CONFIGURED" });
  const production = env("MIDTRANS_ENVIRONMENT", "sandbox").toLowerCase() === "production";
  const base = production ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${serverKey}:`)}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.status_message ?? body?.message ?? `Midtrans HTTP ${response.status}`), {
      status: response.status >= 500 ? 502 : response.status,
      code: "MIDTRANS_ERROR",
      details: body,
    });
  }
  return body;
}
async function fetchMidtransStatus(orderId: string) {
  return await midtransRequest(`/v2/${encodeURIComponent(orderId)}/status`, { method: "GET" });
}
async function persistPaymentStatus(admin: ReturnType<typeof adminClient>, invoice: any, raw: any) {
  const paymentStatus = normalizeMidtransStatus(raw);
  const bookingStatus = ["settlement", "capture"].includes(paymentStatus)
    ? "paid"
    : paymentStatus === "expired" ? "expired" : "pending_payment";
  const { error: invoiceError } = await admin.from("asriva_payment_invoices").update({
    gateway_response: raw,
    gateway_transaction_id: raw.transaction_id ?? null,
    transaction_status: paymentStatus,
    lease_until: null,
    updated_at: new Date().toISOString(),
  }).eq("id", invoice.id);
  if (invoiceError) throw invoiceError;
  const { error: bookingError } = await admin.from("asriva_bookings").update({
    payment_status: paymentStatus,
    booking_status: bookingStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", invoice.booking_id);
  if (bookingError) throw bookingError;
  const { data: bookingRow, error: bookingReadError } = await admin.from("asriva_bookings")
    .select("*").eq("id", invoice.booking_id).single();
  if (bookingReadError) throw bookingReadError;
  return { paymentStatus, bookingStatus, booking: bookingView(bookingRow), transaction: raw };
}
async function authorizeBooking(req: Request, admin: ReturnType<typeof adminClient>, booking: any, accessToken?: string) {
  const user = await currentUser(req, admin);
  if (user && booking.user_id === user.id) return true;
  if (!accessToken) return false;
  const tokenHash = await sha256(accessToken);
  return new Date(booking.booking_access_expires_at).getTime() > Date.now() &&
    sameBytes(booking.booking_access_token_hash, tokenHash);
}

async function handleContract(contract: string, req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Gunakan POST.");
  let body: any;
  try { body = await req.json(); } catch { return fail(400, "INVALID_JSON", "Body harus berupa JSON valid."); }

  const admin = adminClient();
  try {
    const user = await currentUser(req, admin);

    if (contract === "products.list") {
      const page = Math.max(1, Number(body.page) || 1);
      const pageSize = 24;
      let query = admin.from("asriva_products").select("*", { count: "exact" }).eq("is_published", true);
      if (body.category) query = query.eq("category", String(body.category));
      if (body.destination) query = query.ilike("destination", `%${String(body.destination).slice(0, 80)}%`);
      if (body.minPrice !== undefined && body.minPrice !== "") query = query.gte("base_price", Number(body.minPrice));
      if (body.maxPrice !== undefined && body.maxPrice !== "") query = query.lte("base_price", Number(body.maxPrice));
      if (body.date) {
        let inventoryQuery = admin.from("asriva_inventory_slots").select("product_id,capacity_total,reserved_count")
          .eq("start_date", String(body.date)).eq("is_active", true).limit(1000);
        if (body.returnDate) inventoryQuery = inventoryQuery.eq("end_date", String(body.returnDate));
        const { data: slots, error: inventoryError } = await inventoryQuery;
        if (inventoryError) throw inventoryError;
        const minTravelers = Math.max(1, Number(body.travelers) || 1);
        const eligibleIds = [...new Set((slots ?? [])
          .filter((slot: any) => Number(slot.capacity_total) - Number(slot.reserved_count) >= minTravelers)
          .map((slot: any) => slot.product_id))];
        if (!eligibleIds.length) return json({ success: true, items: [], total: 0, page, pageSize: 24 });
        query = query.in("id", eligibleIds);
      }
      const sort = String(body.sort ?? "recommended");
      if (sort === "price_asc") query = query.order("base_price", { ascending: true });
      else if (sort === "price_desc") query = query.order("base_price", { ascending: false });
      else if (sort === "newest") query = query.order("created_at", { ascending: false });
      else query = query.order("created_at", { ascending: false });
      const from = (page - 1) * pageSize;
      const { data, count, error } = await query.range(from, from + pageSize - 1);
      if (error) throw error;
      const productRows = data ?? [];
      const productIds = productRows.map((row: any) => row.id);
      let availabilityByProduct: Record<string, number> = {};
      if (productIds.length) {
        const { data: slots, error: slotsError } = await admin.from("asriva_inventory_slots")
          .select("product_id,capacity_total,reserved_count")
          .in("product_id", productIds).eq("is_active", true).limit(1000);
        if (slotsError) throw slotsError;
        availabilityByProduct = (slots ?? []).reduce((acc: Record<string, number>, slot: any) => {
          acc[slot.product_id] = (acc[slot.product_id] ?? 0) +
            Math.max(0, Number(slot.capacity_total) - Number(slot.reserved_count));
          return acc;
        }, {});
      }
      const items = productRows.map((row: any) => ({
        ...productView(row),
        availableQuota: availabilityByProduct[row.id] ?? 0,
      }));
      return json({ success: true, items, total: count ?? 0, page, pageSize });
    }

    if (contract === "products.detail") {
      const productId = requireText(body.productId, "productId");
      const { data: row, error } = await admin.from("asriva_products").select("*")
        .eq("id", productId).eq("is_published", true).maybeSingle();
      if (error) throw error;
      if (!row) return fail(404, "PRODUCT_NOT_FOUND", "Produk tidak ditemukan atau tidak dipublikasikan.");
      const [{ data: reviews, error: reviewError }, { data: related, error: relatedError }, { data: slots, error: slotsError }] = await Promise.all([
        admin.from("asriva_product_reviews").select("*").eq("product_id", productId)
          .eq("is_verified", true).eq("is_published", true).order("created_at", { ascending: false }).limit(20),
        admin.from("asriva_products").select("*").eq("is_published", true)
          .eq("category", row.category).neq("id", productId).limit(6),
        admin.from("asriva_inventory_slots").select("capacity_total,reserved_count")
          .eq("product_id", productId).eq("is_active", true).limit(1000),
      ]);
      if (reviewError) throw reviewError;
      if (relatedError) throw relatedError;
      if (slotsError) throw slotsError;
      const availableQuota = (slots ?? []).reduce((sum: number, slot: any) =>
        sum + Math.max(0, Number(slot.capacity_total) - Number(slot.reserved_count)), 0);
      return json({
        success: true,
        product: { ...productView(row), availableQuota },
        verifiedReviews: (reviews ?? []).map((r: any) => ({
          id: r.id, reviewerName: r.reviewer_name, rating: Number(r.rating),
          review: r.review_text, createdAt: r.created_at, verified: true,
        })),
        relatedProducts: (related ?? []).map(productView),
      });
    }

    if (contract === "availability.validate") {
      const productId = requireText(body.productId, "productId");
      const category = requireText(body.category, "category");
      const startDate = requireText(body.startDate, "startDate", 10);
      const endDate = body.endDate ? requireText(body.endDate, "endDate", 10) : null;
      const travelers = requireNumber(body.travelers, "travelers", 1, 50);
      const optionId = body.optionId ? String(body.optionId) : null;
      const pickupLocation = body.pickupLocation ? String(body.pickupLocation) : null;
      const timeSlot = body.timeSlot ? String(body.timeSlot) : null;

      let slotQuery = admin.from("asriva_inventory_slots").select("*")
        .eq("product_id", productId).eq("start_date", startDate).eq("is_active", true);
      slotQuery = endDate ? slotQuery.eq("end_date", endDate) : slotQuery.is("end_date", null);
      slotQuery = optionId ? slotQuery.eq("option_id", optionId) : slotQuery.is("option_id", null);
      slotQuery = pickupLocation ? slotQuery.eq("pickup_location", pickupLocation) : slotQuery.is("pickup_location", null);
      slotQuery = timeSlot ? slotQuery.eq("time_slot", timeSlot) : slotQuery.is("time_slot", null);
      const [{ data: slot, error: slotError }, { data: product, error: productError }] = await Promise.all([
        slotQuery.maybeSingle(),
        admin.from("asriva_products").select("*").eq("id", productId).eq("category", category).eq("is_published", true).maybeSingle(),
      ]);
      if (slotError) throw slotError;
      if (productError) throw productError;
      const remaining = slot ? slot.capacity_total - slot.reserved_count : 0;
      if (!product || !slot || remaining < travelers) {
        return json({ success: true, available: false, remainingCapacity: Math.max(0, remaining), message: "Jadwal atau kapasitas tidak tersedia." });
      }
      const unitPrice = Number(slot.unit_price ?? product.base_price);
      const subtotal = unitPrice * travelers;
      const taxesAndFees = Number(slot.taxes_and_fees ?? product.taxes_and_fees);
      const totalAmount = subtotal + taxesAndFees;
      const token = randomToken();
      const expiresAt = new Date(Date.now() + Number(env("ASRIVA_QUOTE_TTL_SECONDS", "600")) * 1000).toISOString();
      const { error: quoteError } = await admin.from("asriva_quotes").insert({
        token_hash: asBytea(await sha256(token)), inventory_slot_id: slot.id, product_id: productId,
        schedule: { startDate, endDate, travelers, optionId, pickupLocation, timeSlot },
        travelers, unit_price: unitPrice, subtotal, taxes_and_fees: taxesAndFees,
        total_amount: totalAmount, expires_at: expiresAt,
      });
      if (quoteError) throw quoteError;
      return json({ success: true, available: true, remainingCapacity: remaining, unitPrice, subtotal, taxesAndFees, totalAmount, currency: "IDR", quoteToken: token, expiresAt });
    }

    if (contract === "bookings.create") {
      const idempotencyKey = requireText(body.idempotencyKey, "idempotencyKey", 128);
      const productId = requireText(body.productId, "productId");
      const quoteToken = requireText(body.quoteToken, "quoteToken", 256);
      if (!body.schedule || !body.contact || !Array.isArray(body.travelers) || body.travelers.length < 1) {
        return fail(400, "INVALID_BOOKING", "schedule, contact, dan travelers wajib diisi.");
      }
      const scheduleTravelerCount = requireNumber(body.schedule.travelers, "schedule.travelers", 1, 50);
      if (body.travelers.length !== scheduleTravelerCount) {
        return fail(400, "TRAVELER_COUNT_MISMATCH", "Jumlah data peserta harus sama dengan jumlah traveler pada jadwal yang dikutip.");
      }
      if (body.specialRequests !== undefined && (typeof body.specialRequests !== "string" || body.specialRequests.length > 2000)) {
        return fail(400, "INVALID_SPECIAL_REQUESTS", "Permintaan khusus maksimal 2.000 karakter.");
      }
      const contact = body.contact;
      const email = requireText(contact.email, "contact.email", 254);
      const phone = requireText(contact.phone, "contact.phone", 40);
      const accessToken = randomToken();
      const ref = `ASR-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
      const { data: product, error: productError } = await admin.from("asriva_products").select("*").eq("id", productId).single();
      if (productError) throw productError;
      const quoteHash = await sha256(quoteToken);
      const { data: quote } = await admin.from("asriva_quotes").select("*").eq("token_hash", asBytea(quoteHash)).maybeSingle();
      if (!quote) return fail(409, "QUOTE_INVALID", "Quote tidak valid atau sudah kedaluwarsa.");
      const bookingData = {
        product: productView(product), productId, productTitle: product.title,
        startDate: body.schedule.startDate, schedule: body.schedule, contact,
        travelers: body.travelers, specialRequests: body.specialRequests ?? "",
        totalAmount: Number(quote.total_amount), currency: "IDR",
        bookingStatus: "pending_payment", paymentStatus: "unpaid",
      };
      const { data: result, error } = await admin.rpc("asriva_create_booking_atomic", {
        p_idempotency_key_hash: asBytea(await sha256(idempotencyKey)),
        p_booking_reference: ref,
        p_user_id: user?.id ?? null,
        p_quote_token_hash: asBytea(quoteHash),
        p_booking_data: bookingData,
        p_contact_data: contact,
        p_contact_email_hash: asBytea(await hashContact(email, "email")),
        p_contact_phone_hash: asBytea(await hashContact(phone, "phone")),
        p_booking_access_token_hash: asBytea(await sha256(accessToken)),
        p_booking_access_expires_at: new Date(Date.now() + Number(env("ASRIVA_BOOKING_ACCESS_TTL_SECONDS", "86400")) * 1000).toISOString(),
      });
      if (error) throw error;
      return json({
        success: true, booking: result.booking, bookingAccessToken: accessToken,
        accessExpiresAt: new Date(Date.now() + Number(env("ASRIVA_BOOKING_ACCESS_TTL_SECONDS", "86400")) * 1000).toISOString(),
      });
    }

    if (contract === "bookings.lookup") {
      const bookingReference = requireText(body.bookingReference, "bookingReference", 80);
      const forwardedIp = req.headers.get("cf-connecting-ip") ??
        req.headers.get("x-real-ip") ??
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown";
      const windowStartedAt = new Date(Math.floor(Date.now() / 900000) * 900000).toISOString();
      const { data: allowed, error: rateError } = await admin.rpc("asriva_consume_booking_lookup_attempt", {
        p_ip_hash: asBytea(await sha256(forwardedIp)),
        p_window_started_at: windowStartedAt,
        p_max_attempts: 30,
      });
      if (rateError) throw rateError;
      if (allowed !== true) return fail(429, "BOOKING_LOOKUP_RATE_LIMITED", "Terlalu banyak percobaan verifikasi. Coba kembali setelah 15 menit.");
      const { data: row, error } = await admin.from("asriva_bookings").select("*")
        .eq("booking_reference", bookingReference).maybeSingle();
      if (error) throw error;
      if (!row) return fail(404, "BOOKING_NOT_FOUND", "Pesanan tidak ditemukan atau verifikasi tidak sesuai.");
      let verified = Boolean(user && row.user_id === user.id);
      let verifiedByAccessToken = false;
      if (!verified && typeof body.bookingAccessToken === "string" && body.bookingAccessToken.trim()) {
        const tokenHash = await sha256(body.bookingAccessToken.trim());
        verifiedByAccessToken = new Date(row.booking_access_expires_at).getTime() > Date.now() &&
          sameBytes(row.booking_access_token_hash, tokenHash);
        verified = verifiedByAccessToken;
      }
      if (!verified && typeof body.contactVerification === "string" && body.contactVerification.trim()) {
        const candidate = body.contactVerification.trim();
        const emailHash = await hashContact(candidate, "email");
        const phoneHash = await hashContact(candidate, "phone");
        verified = sameBytes(row.contact_email_hash, emailHash) || sameBytes(row.contact_phone_hash, phoneHash);
      }
      if (!verified) return fail(403, "BOOKING_VERIFICATION_FAILED", "Nomor booking atau kontak verifikasi tidak sesuai.");
      const accessToken = verifiedByAccessToken ? body.bookingAccessToken.trim() : randomToken();
      const expiresAt = new Date(Date.now() + Number(env("ASRIVA_BOOKING_ACCESS_TTL_SECONDS", "86400")) * 1000).toISOString();
      const { error: updateError } = await admin.from("asriva_bookings").update({
        booking_access_token_hash: asBytea(await sha256(accessToken)),
        booking_access_expires_at: expiresAt,
      }).eq("id", row.id);
      if (updateError) throw updateError;
      return json({ success: true, booking: bookingView(row), bookingAccessToken: accessToken, accessExpiresAt: expiresAt });
    }

    if (contract === "payments.initiate" || contract === "payments.verifyStatus") {
      const bookingReference = requireText(body.bookingReference, "bookingReference", 80);
      const { data: booking, error: bookingError } = await admin.from("asriva_bookings").select("*")
        .eq("booking_reference", bookingReference).maybeSingle();
      if (bookingError) throw bookingError;
      if (!booking) return fail(404, "BOOKING_NOT_FOUND", "Pesanan tidak ditemukan.");
      if (!(await authorizeBooking(req, admin, booking, body.bookingAccessToken))) {
        return fail(403, "BOOKING_ACCESS_REQUIRED", "Verifikasi booking diperlukan sebelum mengakses pembayaran.");
      }
      const { data: existingInvoice, error: invoiceError } = await admin.from("asriva_payment_invoices")
        .select("*").eq("booking_id", booking.id).maybeSingle();
      if (invoiceError) throw invoiceError;

      if (contract === "payments.initiate") {
        if (["paid", "cancelled", "expired"].includes(booking.booking_status)) {
          return fail(409, "BOOKING_NOT_PAYABLE", "Status booking tidak mengizinkan pembayaran baru.");
        }
        if (existingInvoice?.gateway_response) {
          return json({
            success: true, mode: "CORE_API", orderId: existingInvoice.order_id,
            coreApiInstructions: existingInvoice.gateway_response,
            paymentChannel: existingInvoice.payment_channel,
            channelLocked: true,
          });
        }
        const requestedChannel = existingInvoice?.payment_channel ?? String(body.preferredChannel ?? env("MIDTRANS_DEFAULT_PAYMENT_TYPE")).trim();
        if (!requestedChannel) return fail(503, "PAYMENT_CHANNEL_NOT_CONFIGURED", "Pilih dan konfigurasi payment channel Midtrans yang aktif pada merchant.");
        const channelConfig = parseJson(env("MIDTRANS_CHANNEL_CONFIG_JSON", "{}"), {}) as Record<string, unknown>;
        const orderId = existingInvoice?.order_id ?? booking.booking_reference;
        const chargeRequest = {
          payment_type: existingInvoice?.payment_channel ?? requestedChannel,
          transaction_details: { order_id: orderId, gross_amount: Number(booking.total_amount) },
          customer_details: {
            first_name: booking.contact_data?.fullName ?? "Pelanggan ASRIVA",
            email: booking.contact_data?.email,
            phone: booking.contact_data?.phone,
          },
          ...(channelConfig[existingInvoice?.payment_channel ?? requestedChannel] as Record<string, unknown> ?? {}),
        };
        const claim = await admin.rpc("asriva_claim_payment_invoice", {
          p_booking_id: booking.id,
          p_order_id: orderId,
          p_idempotency_key_hash: asBytea(await sha256(requireText(body.idempotencyKey, "idempotencyKey", 128))),
          p_payment_channel: requestedChannel,
          p_gateway_request: chargeRequest,
        });
        if (claim.error) throw claim.error;
        const invoice = claim.data.invoice;
        if (invoice.gateway_response) {
          return json({ success: true, mode: "CORE_API", orderId: invoice.order_id, coreApiInstructions: invoice.gateway_response, paymentChannel: invoice.payment_channel, channelLocked: true });
        }
        if (!claim.data.claimed) return fail(409, "PAYMENT_INITIALIZATION_IN_PROGRESS", "Invoice sedang diproses. Ulangi permintaan menggunakan invoice dan kanal yang sama.");
        let gatewayResponse: any;
        try {
          gatewayResponse = await midtransRequest("/v2/charge", { method: "POST", body: JSON.stringify(chargeRequest) });
        } catch (chargeError: any) {
          // A timeout can happen after Midtrans accepted the charge. Reconcile by the same order_id before retrying.
          try { gatewayResponse = await fetchMidtransStatus(orderId); }
          catch { throw chargeError; }
        }
        const { error: saveError } = await admin.from("asriva_payment_invoices").update({
          gateway_response: gatewayResponse,
          gateway_transaction_id: gatewayResponse.transaction_id ?? null,
          transaction_status: normalizeMidtransStatus(gatewayResponse),
          lease_until: null,
          updated_at: new Date().toISOString(),
        }).eq("id", invoice.id);
        if (saveError) throw saveError;
        await admin.from("asriva_bookings").update({ payment_status: "pending", booking_status: "pending_payment" }).eq("id", booking.id);
        const redirect = Array.isArray(gatewayResponse.actions)
          ? gatewayResponse.actions.find((a: any) => a.name === "redirect")?.url
          : undefined;
        return json({ success: true, mode: "CORE_API", orderId, redirectUrl: redirect, coreApiInstructions: gatewayResponse, paymentChannel: invoice.payment_channel, channelLocked: true });
      }

      if (!existingInvoice) return fail(404, "INVOICE_NOT_FOUND", "Invoice pembayaran belum dibuat.");
      if (body.orderId && body.orderId !== existingInvoice.order_id) return fail(403, "ORDER_ID_MISMATCH", "Order ID tidak cocok dengan invoice booking.");
      const raw = await fetchMidtransStatus(existingInvoice.order_id);
      const status = await persistPaymentStatus(admin, existingInvoice, raw);
      return json({ success: true, ...status });
    }

    return fail(404, "CONTRACT_NOT_FOUND", "Kontrak backend tidak dikenal.");
  } catch (error: any) {
    console.error("[ASRIVA_BACKEND]", contract, error?.code ?? error?.message ?? error);
    return fail(error?.status ?? 500, error?.code ?? "INTERNAL_ERROR", error?.status ? error.message : "Permintaan backend gagal diproses.");
  }
}

export async function serveContract(contract: string) {
  Deno.serve((req) => handleContract(contract, req));
}

export async function serveMidtransNotification() {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Gunakan POST.");
    const admin = adminClient();
    try {
      const body = await req.json();
      const serverKey = env("MIDTRANS_SERVER_KEY");
      if (!serverKey) return fail(503, "PAYMENT_NOT_CONFIGURED", "MIDTRANS_SERVER_KEY belum dikonfigurasi.");
      const raw = `${body.order_id ?? ""}${body.status_code ?? ""}${body.gross_amount ?? ""}${serverKey}`;
      const expected = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-512", new TextEncoder().encode(raw))));
      const received = String(body.signature_key ?? "").toLowerCase();
      if (!received || received.length !== expected.length || !sameBytes(new TextEncoder().encode(received), new TextEncoder().encode(expected))) {
        return fail(401, "INVALID_NOTIFICATION_SIGNATURE", "Signature notifikasi Midtrans tidak valid.");
      }
      const { data: invoice, error } = await admin.from("asriva_payment_invoices").select("*")
        .eq("order_id", String(body.order_id)).maybeSingle();
      if (error) throw error;
      if (!invoice) return fail(404, "INVOICE_NOT_FOUND", "Invoice tidak ditemukan.");
      await admin.from("asriva_payment_events").insert({
        invoice_id: invoice.id, order_id: String(body.order_id),
        event_type: String(body.transaction_status ?? "notification"), payload: body,
      });
      // Never use the webhook body alone as the source of truth; reconcile with Midtrans GET Status.
      const verified = await fetchMidtransStatus(invoice.order_id);
      const result = await persistPaymentStatus(admin, invoice, verified);
      return json({ success: true, received: true, paymentStatus: result.paymentStatus });
    } catch (error: any) {
      console.error("[ASRIVA_MIDTRANS_NOTIFICATION]", error?.message ?? error);
      return fail(error?.status ?? 500, error?.code ?? "NOTIFICATION_PROCESSING_FAILED", error?.status ? error.message : "Notifikasi gagal diverifikasi.");
    }
  });
}
