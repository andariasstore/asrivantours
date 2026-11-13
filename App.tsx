import React, { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react';
import {
  Search, Compass, Calendar, User, MapPin, Users, Plane, Hotel, Car,
  Sparkles, ShieldCheck, CreditCard, Clock, CheckCircle2, AlertCircle,
  XCircle, ChevronRight, ChevronLeft, ArrowRight, Filter, SlidersHorizontal,
  Phone, Mail, MessageCircle, FileText, Info, Lock, RefreshCw, ExternalLink,
  Menu, X, Building2, Briefcase, Award, HelpCircle, LogOut, Receipt,
  CalendarCheck, AlertTriangle, Database, Server, KeyRound, Eye, Check
} from 'lucide-react';

/**
 * ============================================================================
 * ASRIVA AN TOURS — OTA E-COMMERCE STOREFRONT (https://asricollection.online)
 * ============================================================================
 * Architectural Principles Enforced:
 * 1. Zero Fake Data: No fabricated tours, flights, prices, reviews, or bookings.
 * 2. Strict Contract-First Integration: All Supabase & Midtrans calls route
 *    through explicit service contracts with runtime environment binding.
 * 3. Separation of Booking & Payment States: Frontend callbacks never mark
 *    a booking as paid; backend transaction verification is required.
 * 4. Language & Locale: 100% Bahasa Indonesia, Currency IDR, Asia/Jakarta.
 * ============================================================================
 */

// ============================================================================
// 1. DOMAIN TYPES & STATE DEFINITIONS (Documented via JSDoc for JSX runtime)
// ============================================================================

/**
 * @typedef {'tour_packages' | 'hotels' | 'flights' | 'transportation' | 'activities'} ProductCategory
 * @typedef {'draft' | 'pending_confirmation' | 'confirmed' | 'pending_payment' | 'paid' | 'cancelled' | 'expired'} BookingStatusType
 * @typedef {'unpaid' | 'pending' | 'settlement' | 'capture' | 'failed' | 'expired' | 'refund_pending' | 'refunded'} PaymentStatusType
 * @typedef {'UNCONFIGURED' | 'CORE_API'} MidtransIntegrationMethod
 */

const CATEGORIES = [
  { id: 'tour_packages', route: '/tours', label: 'Paket Tur', shortLabel: 'Paket Tur', icon: Compass, desc: 'Rencana perjalanan terkurasi lengkap' },
  { id: 'hotels', route: '/hotels', label: 'Hotel & Akomodasi', shortLabel: 'Hotel', icon: Hotel, desc: 'Penginapan pilihan terverifikasi' },
  { id: 'flights', route: '/flights', label: 'Penerbangan', shortLabel: 'Pesawat', icon: Plane, desc: 'Layanan tiket penerbangan resmi ASRIVA' },
  { id: 'transportation', route: '/transport', label: 'Transportasi', shortLabel: 'Transport', icon: Car, desc: 'Sewa kendaraan & antar-jemput' },
  { id: 'activities', route: '/activities', label: 'Aktivitas & Wisata', shortLabel: 'Aktivitas', icon: Sparkles, desc: 'Pengalaman lokal & tiket atraksi' },
];

const BOOKING_STATUS_META = {
  draft: { label: 'Draf Pemesanan', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  pending_confirmation: { label: 'Menunggu Konfirmasi', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  confirmed: { label: 'Terkonfirmasi', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  pending_payment: { label: 'Menunggu Pembayaran', color: 'bg-orange-50 text-orange-800 border-orange-200' },
  paid: { label: 'Lunas / Selesai', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  cancelled: { label: 'Dibatalkan', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  expired: { label: 'Kedaluwarsa', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
};

const PAYMENT_STATUS_META = {
  unpaid: { label: 'Belum Dibayar', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  pending: { label: 'Menunggu Pembayaran', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  settlement: { label: 'Pembayaran Terverifikasi', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  capture: { label: 'Pembayaran Terotorisasi', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  failed: { label: 'Pembayaran Gagal', color: 'bg-rose-50 text-rose-800 border-rose-200' },
  expired: { label: 'Waktu Pembayaran Habis', color: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
  refund_pending: { label: 'Proses Pengembalian Dana', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  refunded: { label: 'Dana Dikembalikan', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
};

// ============================================================================
// 2. FORMATTING & LOCALE UTILITIES (IDR & Asia/Jakarta)
// ============================================================================

const formatIDR = (amount) => {
  if (typeof amount !== 'number' || isNaN(amount)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDateID = (isoString, includeTime = false) => {
  if (!isoString) return '-';
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}),
    }).format(date);
  } catch {
    return isoString;
  }
};

const getSupabaseAuthStorageKey = (supabaseUrl) => {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : '';
  } catch {
    return '';
  }
};

const readStoredAuthSession = (storageKey) => {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const bookingAccessStorageKey = (bookingReference) =>
  `asriva:booking-access:${bookingReference}`;

const readBookingAccessToken = (bookingReference) => {
  if (!bookingReference || typeof window === 'undefined') return '';
  try {
    const key = bookingAccessStorageKey(bookingReference);
    const stored = JSON.parse(window.sessionStorage.getItem(key) || 'null');
    if (!stored?.token || !stored?.expiresAt || stored.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return '';
    }
    return stored.token;
  } catch {
    return '';
  }
};

// ============================================================================
// 3. API CONTRACTS & RUNTIME CONFIGURATION STORE
// ============================================================================
// NOTE: Because existing Supabase table names, Edge Function slugs, and Midtrans
// integration mode (Snap vs Core API) must not be silently invented, this
// contract registry explicitly documents every required endpoint and allows
// binding real environment credentials without exposing secret keys.

const REQUIRED_BACKEND_CONTRACTS = [
  {
    id: 'products.list',
    service: 'productService',
    description: 'Mengambil daftar produk perjalanan terpublikasi milik ASRIVA',
    method: 'POST / GET',
    envKey: 'VITE_EDGE_PRODUCTS_LIST',
    expectedRequest: '{ category?: string, destination?: string, date?: string, travelers?: number, minPrice?: number, maxPrice?: number, sort?: string, page?: number }',
    expectedResponse: '{ items: Product[], total: number }',
  },
  {
    id: 'products.detail',
    service: 'productService',
    description: 'Mengambil detail lengkap produk, jadwal, fasilitas, dan ulasan terverifikasi',
    method: 'POST / GET',
    envKey: 'VITE_EDGE_PRODUCT_DETAIL',
    expectedRequest: '{ productId: string }',
    expectedResponse: '{ product: Product, verifiedReviews: Review[], relatedProducts: Product[] }',
  },
  {
    id: 'availability.validate',
    service: 'availabilityService',
    description: 'Validasi ketersediaan kapasitas & kalkulasi harga resmi sisi server',
    method: 'POST',
    envKey: 'VITE_EDGE_VALIDATE_AVAILABILITY',
    expectedRequest: '{ productId: string, category: string, startDate: string, endDate?: string, travelers: number, optionId?: string, pickupLocation?: string, timeSlot?: string }',
    expectedResponse: '{ available: boolean, remainingCapacity?: number, unitPrice: number, subtotal: number, taxesAndFees: number, totalAmount: number, currency: "IDR", quoteToken: string when available }',
  },
  {
    id: 'bookings.create',
    service: 'bookingService',
    description: 'Membuat reservasi terkonfirmasi setelah validasi ulang ketersediaan & harga',
    method: 'POST',
    envKey: 'VITE_EDGE_CREATE_BOOKING',
    expectedRequest: '{ idempotencyKey: string, productId: string, schedule: object, contact: object, travelers: array, specialRequests?: string, quoteToken: string }',
    expectedResponse: '{ booking: BookingRecord }',
  },
  {
    id: 'bookings.lookup',
    service: 'bookingService',
    description: 'Pencarian pesanan tamu (kode booking + kontak terverifikasi) atau riwayat akun',
    method: 'POST',
    envKey: 'VITE_EDGE_GET_BOOKING',
    expectedRequest: '{ bookingReference: string, contactVerification?: string }',
    expectedResponse: '{ booking: BookingRecord }',
  },
  {
    id: 'payments.initiate',
    service: 'paymentService',
    description: 'Inisiasi transaksi pembayaran Midtrans Core API (instruksi kanal pembayaran)',
    method: 'POST',
    envKey: 'VITE_EDGE_INITIATE_PAYMENT',
    expectedRequest: '{ bookingReference: string, idempotencyKey: string, preferredChannel?: string }',
    expectedResponse: '{ mode: "CORE_API", orderId: string, redirectUrl?: string, coreApiInstructions: object }',
  },
  {
    id: 'payments.verifyStatus',
    service: 'paymentService',
    description: 'Verifikasi status transaksi otoritatif dari backend (bukan callback frontend)',
    method: 'POST',
    envKey: 'VITE_EDGE_VERIFY_PAYMENT',
    expectedRequest: '{ bookingReference: string, orderId?: string }',
    expectedResponse: '{ bookingStatus: BookingStatusType, paymentStatus: PaymentStatusType, transaction: TransactionRecord }',
  },
];

class ApiIntegrationError extends Error {
  constructor(code, message, contractId = null, details = null) {
    super(message);
    this.name = 'ApiIntegrationError';
    this.code = code; // 'CONTRACT_UNCONFIGURED' | 'NETWORK_ERROR' | 'VALIDATION_ERROR' | 'BACKEND_ERROR'
    this.contractId = contractId;
    this.details = details;
  }
}

const isPlainRecord = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertContractResponse = (contractId, data) => {
  const invalid = (message) => {
    throw new ApiIntegrationError('VALIDATION_ERROR', message, contractId, data);
  };
  if (!isPlainRecord(data)) invalid('Backend mengembalikan format respons yang tidak valid.');

  switch (contractId) {
    case 'products.list':
      if (!Array.isArray(data.items) || typeof data.total !== 'number' || !Number.isFinite(data.total)) {
        invalid('Respons daftar produk harus memiliki items berupa array dan total berupa angka.');
      }
      break;
    case 'products.detail':
      if (!isPlainRecord(data.product) || !Array.isArray(data.verifiedReviews) || !Array.isArray(data.relatedProducts)) {
        invalid('Respons detail produk tidak memenuhi kontrak product, verifiedReviews, dan relatedProducts.');
      }
      break;
    case 'availability.validate':
      if (typeof data.available !== 'boolean') {
        invalid('Respons validasi ketersediaan harus menyertakan available bertipe boolean.');
      }
      if (data.available) {
        const amounts = ['unitPrice', 'subtotal', 'taxesAndFees', 'totalAmount'];
        if (
          amounts.some((key) => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) ||
          data.currency !== 'IDR' ||
          typeof data.quoteToken !== 'string' ||
          !data.quoteToken.trim()
        ) {
          invalid('Quote tersedia harus menyertakan nilai harga IDR yang valid dan quoteToken.');
        }
      }
      break;
    case 'bookings.create':
    case 'bookings.lookup':
      if (!isPlainRecord(data.booking) || typeof data.booking.bookingReference !== 'string' || !data.booking.bookingReference.trim()) {
        invalid('Respons booking harus menyertakan objek booking dengan bookingReference yang valid.');
      }
      break;
    case 'payments.initiate':
      if (
        data.mode !== 'CORE_API' ||
        typeof data.orderId !== 'string' ||
        !data.orderId.trim() ||
        ((!isPlainRecord(data.coreApiInstructions)) && typeof data.redirectUrl !== 'string')
      ) {
        invalid('Respons pembayaran harus berupa sesi CORE_API dengan orderId dan instruksi atau redirect URL.');
      }
      break;
    case 'payments.verifyStatus':
      if (
        !Object.prototype.hasOwnProperty.call(BOOKING_STATUS_META, data.bookingStatus) ||
        !Object.prototype.hasOwnProperty.call(PAYMENT_STATUS_META, data.paymentStatus) ||
        !isPlainRecord(data.transaction)
      ) {
        invalid('Respons verifikasi pembayaran memiliki status booking, status pembayaran, atau transaction yang tidak valid.');
      }
      break;
    default:
      break;
  }
  return data;
};

/**
 * Centralized Service Layer Factory
 * Connects strictly to user-supplied Supabase URL, Anon Key, and Edge Function paths.
 * Never fabricates response payloads.
 */
function createAsrivaServices(runtimeConfig, addAuditLog, authSession) {
  const {
    supabaseUrl,
    supabaseAnonKey,
    endpoints,
    midtransEnvironment,
    midtransClientKey,
    midtransMethod,
  } = runtimeConfig;

  const invokeEdgeContract = async (contractId, payload = {}) => {
    const endpointPath = endpoints[contractId];

    if (!supabaseUrl || !supabaseAnonKey || !endpointPath) {
      const missingParts = [
        !supabaseUrl && 'Supabase Project URL',
        !supabaseAnonKey && 'Supabase Anon Key',
        !endpointPath && `Endpoint Contract (${contractId})`,
      ].filter(Boolean);

      addAuditLog({
        timestamp: new Date().toISOString(),
        contractId,
        status: 'BLOCKED_UNCONFIGURED',
        message: `Konfigurasi belum lengkap: ${missingParts.join(', ')}`,
      });

      throw new ApiIntegrationError(
        'CONTRACT_UNCONFIGURED',
        `Integrasi backend untuk "${contractId}" belum dikonfigurasi (${missingParts.join(', ')}).`,
        contractId
      );
    }

    const normalizedBase = supabaseUrl.replace(/\/$/, '');
    const normalizedPath = endpointPath.startsWith('http')
      ? endpointPath
      : `${normalizedBase}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

    try {
      const response = await fetch(normalizedPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${authSession?.access_token || supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : { message: await response.text() };

      if (!response.ok) {
        addAuditLog({
          timestamp: new Date().toISOString(),
          contractId,
          status: `HTTP_${response.status}`,
          message: data?.message || data?.error || 'Respons gagal dari Supabase Edge Function',
        });
        throw new ApiIntegrationError(
          'BACKEND_ERROR',
          data?.message || data?.error || `Terjadi kesalahan pada server (${response.status}).`,
          contractId,
          data
        );
      }

      const validatedData = assertContractResponse(contractId, data);

      addAuditLog({
        timestamp: new Date().toISOString(),
        contractId,
        status: 'SUCCESS',
        message: 'Permintaan berhasil diproses dan lolos validasi kontrak.',
      });

      return validatedData;
    } catch (err) {
      if (err instanceof ApiIntegrationError) throw err;
      addAuditLog({
        timestamp: new Date().toISOString(),
        contractId,
        status: 'NETWORK_ERROR',
        message: err.message || 'Gagal terhubung ke server Supabase.',
      });
      throw new ApiIntegrationError(
        'NETWORK_ERROR',
        'Tidak dapat terhubung ke layanan backend ASRIVA. Periksa koneksi internet atau konfigurasi endpoint Anda.',
        contractId
      );
    }
  };

  return {
    productService: {
      listProducts: (filters) => invokeEdgeContract('products.list', filters),
      getProductDetail: (productId) => invokeEdgeContract('products.detail', { productId }),
    },
    availabilityService: {
      validateAvailabilityAndPrice: (params) => invokeEdgeContract('availability.validate', params),
    },
    bookingService: {
      createConfirmedBooking: (bookingPayload) => invokeEdgeContract('bookings.create', bookingPayload),
      lookupBooking: (lookupPayload) => invokeEdgeContract('bookings.lookup', lookupPayload),
    },
    paymentService: {
      getIntegrationStatus: () => ({
        environment: midtransEnvironment,
        hasClientKey: Boolean(midtransClientKey),
        method: midtransMethod,
      }),
      initiatePayment: (paymentPayload) => {
        if (midtransMethod !== 'CORE_API') {
          throw new ApiIntegrationError(
            'CONTRACT_UNCONFIGURED',
            'Integrasi pembayaran ASRIVA ditetapkan menggunakan Midtrans CORE_API. Konfigurasikan metode tersebut sebelum melanjutkan.',
            'payments.initiate'
          );
        }
        return invokeEdgeContract('payments.initiate', {
          ...paymentPayload,
          expectedIntegrationMethod: midtransMethod,
        });
      },
      verifyPaymentStatus: (verifyPayload) => invokeEdgeContract('payments.verifyStatus', verifyPayload),
    },
    customerService: {
      signInWithSupabase: async (email, password) => {
        if (!supabaseUrl || !supabaseAnonKey) {
          throw new ApiIntegrationError(
            'CONTRACT_UNCONFIGURED',
            'Supabase URL dan Anon Key diperlukan untuk autentikasi akun pelanggan.',
            'auth.signIn'
          );
        }
        const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
          },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new ApiIntegrationError(
            'BACKEND_ERROR',
            data?.error_description || data?.msg || 'Email atau kata sandi tidak valid.',
            'auth.signIn'
          );
        }
        return data;
      },
      signUpWithSupabase: async (email, password, fullName, phone) => {
        if (!supabaseUrl || !supabaseAnonKey) {
          throw new ApiIntegrationError(
            'CONTRACT_UNCONFIGURED',
            'Supabase URL dan Anon Key diperlukan untuk pendaftaran akun pelanggan.',
            'auth.signUp'
          );
        }
        const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/signup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
          },
          body: JSON.stringify({
            email,
            password,
            data: { full_name: fullName, phone },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new ApiIntegrationError(
            'BACKEND_ERROR',
            data?.error_description || data?.msg || 'Pendaftaran akun gagal diproses.',
            'auth.signUp'
          );
        }
        return data;
      },
      refreshSession: async (refreshToken) => {
        const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new ApiIntegrationError('BACKEND_ERROR', data?.error_description || data?.msg || 'Sesi akun kedaluwarsa. Silakan masuk kembali.', 'auth.refresh');
        }
        return data;
      },
      getUser: async (accessToken) => {
        const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
          method: 'GET',
          headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!res.ok) {
          throw new ApiIntegrationError('BACKEND_ERROR', data?.message || 'Sesi akun tidak lagi valid.', 'auth.getUser');
        }
        return data;
      },
      signOut: async (accessToken) => {
        if (!accessToken) return;
        const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok && res.status !== 401) {
          const data = await res.json().catch(() => ({}));
          throw new ApiIntegrationError('BACKEND_ERROR', data?.message || 'Gagal mengakhiri sesi Supabase Auth.', 'auth.signOut');
        }
      },
    },
  };
}

// ============================================================================
// 4. APPLICATION CONTEXT (Routing, Runtime Config, Booking Draft, Auth, Toast)
// ============================================================================

const AppContext = createContext(null);

const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};

// ============================================================================
// 5. REUSABLE UI COMPONENTS (Design System)
// ============================================================================

const AsrivaBrandMark = ({ compact = false }) => (
  <div className="flex items-center gap-2.5 select-none">
    {/* Minimalist geometric monogram - strictly typographic/monogram without inventing a mascot */}
    <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-semibold tracking-tight text-base shadow-sm border border-slate-800">
      A
    </div>
    <div className="flex flex-col leading-none">
      <span className="font-bold tracking-tight text-slate-900 text-base sm:text-lg">
        ASRIVA <span className="font-medium text-teal-700">An Tours</span>
      </span>
      {!compact && (
        <span className="text-[11px] text-slate-500 tracking-wide mt-0.5">
          asricollection.online
        </span>
      )}
    </div>
  </div>
);

const ToastNotification = ({ toasts, removeToast }) => {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl shadow-lg border backdrop-blur-md transition-all ${
            t.type === 'error'
              ? 'bg-rose-50/95 border-rose-200 text-rose-900'
              : t.type === 'success'
              ? 'bg-emerald-50/95 border-emerald-200 text-emerald-900'
              : 'bg-white/95 border-slate-200 text-slate-800'
          }`}
        >
          {t.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          ) : t.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <Info className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 text-sm leading-snug">
            {t.title && <p className="font-semibold mb-0.5">{t.title}</p>}
            <p className="text-xs opacity-90">{t.message}</p>
          </div>
          <button
            onClick={() => removeToast(t.id)}
            className="text-slate-400 hover:text-slate-700 p-1"
            aria-label="Tutup notifikasi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

const ConfirmationDialog = ({ open, title, message, confirmLabel = 'Lanjutkan', cancelLabel = 'Batal', onConfirm, onCancel, danger = false }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-700 hover:bg-teal-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const LoadingSkeleton = ({ count = 3 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
    {Array.from({ length: count }).map((_, idx) => (
      <div key={idx} className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden animate-pulse">
        <div className="h-44 bg-slate-200" />
        <div className="p-4 space-y-3">
          <div className="h-3 w-24 bg-slate-200 rounded" />
          <div className="h-5 w-3/4 bg-slate-200 rounded" />
          <div className="h-3 w-1/2 bg-slate-200 rounded" />
          <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
            <div className="h-5 w-28 bg-slate-200 rounded" />
            <div className="h-8 w-20 bg-slate-200 rounded-lg" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ icon: Icon = Compass, title, description, actionLabel, onAction, secondaryLabel, onSecondary }) => (
  <div className="bg-white rounded-2xl border border-slate-200/90 p-8 sm:p-10 text-center max-w-xl mx-auto my-4 shadow-2xs">
    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-4">
      <Icon className="w-6 h-6" />
    </div>
    <h3 className="text-base sm:text-lg font-bold text-slate-900">{title}</h3>
    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{description}</p>
    {(actionLabel || secondaryLabel) && (
      <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
        {actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
          >
            {actionLabel}
          </button>
        )}
        {secondaryLabel && (
          <button
            type="button"
            onClick={onSecondary}
            className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium transition-colors"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    )}
  </div>
);

const ErrorState = ({ error, onRetry }) => {
  const { openIntegrationModal } = useApp();
  const isUnconfigured = error?.code === 'CONTRACT_UNCONFIGURED';

  return (
    <div className="bg-white rounded-2xl border border-amber-200 p-6 sm:p-8 max-w-2xl mx-auto my-4 shadow-2xs">
      <div className="flex items-start gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
          isUnconfigured ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'
        }`}>
          {isUnconfigured ? <Database className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900">
              {isUnconfigured ? 'Kontrak Backend Belum Terhubung' : 'Kendala Koneksi Layanan'}
            </span>
            {error?.contractId && (
              <span className="text-xs font-mono text-slate-500">[{error.contractId}]</span>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900 mt-2">
            {isUnconfigured
              ? 'Data Produk & Layanan Menunggu Koneksi Supabase'
              : 'Gagal Memuat Data dari Server ASRIVA'}
          </h3>
          <p className="text-sm text-slate-600 mt-1 leading-relaxed">
            {error?.message || 'Terjadi gangguan saat menghubungi layanan backend.'}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            Sesuai kebijakan integritas ASRIVA An Tours, aplikasi tidak menampilkan data inventaris atau harga tiruan.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <button
              type="button"
              onClick={openIntegrationModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              <Server className="w-4 h-4" />
              Konfigurasi Koneksi Supabase & Kontrak API
            </button>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Coba Muat Ulang
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const BookingStatusBadge = ({ status }) => {
  const meta = BOOKING_STATUS_META[status] || {
    label: status || 'Status Tidak Diketahui',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.color}`}>
      {meta.label}
    </span>
  );
};

const PaymentStatusBadge = ({ status }) => {
  const meta = PAYMENT_STATUS_META[status] || {
    label: status || 'Status Pembayaran',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.color}`}>
      {meta.label}
    </span>
  );
};

const PriceDisplay = ({ amount, unitLabel = '', size = 'md' }) => {
  const sizeClass =
    size === 'lg'
      ? 'text-xl sm:text-2xl font-bold text-slate-900'
      : size === 'sm'
      ? 'text-sm font-bold text-slate-900'
      : 'text-base sm:text-lg font-bold text-slate-900';

  return (
    <div className="flex items-baseline gap-1 flex-wrap">
      <span className={sizeClass}>{formatIDR(amount)}</span>
      {unitLabel && <span className="text-xs text-slate-500 font-normal">/ {unitLabel}</span>}
    </div>
  );
};

const ProductCard = ({ product }) => {
  const { navigate } = useApp();
  const catMeta = CATEGORIES.find((c) => c.id === product.category);

  return (
    <article
      onClick={() => navigate(`/product/${encodeURIComponent(product.id)}`)}
      className="group bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-2xs hover:shadow-md hover:border-teal-600/40 transition-all cursor-pointer flex flex-col"
    >
      <div className="relative aspect-[16/10] bg-slate-100 overflow-hidden">
        {product.coverImage ? (
          <img
            src={product.coverImage}
            alt={product.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
            <Compass className="w-8 h-8 mb-1.5 opacity-60" />
            <span className="text-xs">Foto Produk ASRIVA</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/95 text-slate-800 shadow-xs backdrop-blur-xs">
            {catMeta?.shortLabel || product.category}
          </span>
        </div>
        {typeof product.availableQuota === 'number' && (
          <div className="absolute bottom-3 right-3">
            <span
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shadow-xs ${
                product.availableQuota > 0
                  ? 'bg-emerald-900/90 text-white'
                  : 'bg-rose-900/90 text-white'
              }`}
            >
              {product.availableQuota > 0 ? `Tersedia (${product.availableQuota})` : 'Penuh'}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <MapPin className="w-3.5 h-3.5 text-teal-700 shrink-0" />
            <span className="truncate">{product.destination || 'Destinasi Indonesia'}</span>
          </div>
          <h3 className="font-bold text-slate-900 text-base leading-snug line-clamp-2 group-hover:text-teal-800 transition-colors">
            {product.title}
          </h3>
          {product.duration && (
            <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{product.duration}</span>
            </p>
          )}
        </div>

        <div className="pt-3.5 mt-4 border-t border-slate-100 flex items-end justify-between gap-2">
          <div>
            <span className="text-[11px] text-slate-400 block">Mulai dari</span>
            <PriceDisplay amount={product.basePrice} unitLabel={product.priceUnit || 'pax'} size="sm" />
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 group-hover:translate-x-0.5 transition-transform">
            Detail <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </article>
  );
};

// ============================================================================
// 6. GLOBAL SEARCH BAR COMPONENT
// ============================================================================

const SearchBar = ({ initialValues = {}, onSearch, compact = false }) => {
  const [destination, setDestination] = useState(initialValues.destination || '');
  const [category, setCategory] = useState(initialValues.category || '');
  const [departureDate, setDepartureDate] = useState(initialValues.departureDate || '');
  const [returnDate, setReturnDate] = useState(initialValues.returnDate || '');
  const [travelers, setTravelers] = useState(initialValues.travelers || 1);

  const requiresReturnDate = category === 'hotels' || category === 'flights';

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch({
      destination: destination.trim(),
      category,
      departureDate,
      returnDate: requiresReturnDate ? returnDate : '',
      travelers: Math.max(1, Number(travelers) || 1),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${
        compact ? 'p-3.5' : 'p-4 sm:p-6'
      }`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
        {/* Category */}
        <div className="lg:col-span-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Kategori Layanan
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="">Semua Kategori</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Destination */}
        <div className="lg:col-span-3">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Destinasi / Kata Kunci
          </label>
          <div className="relative">
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Contoh: Bali, Labuan Bajo, Makassar"
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {/* Departure / Check-in Date */}
        <div className={requiresReturnDate ? 'lg:col-span-2' : 'lg:col-span-2'}>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {category === 'hotels' ? 'Check-in' : 'Tanggal Berangkat'}
          </label>
          <input
            type="date"
            value={departureDate}
            onChange={(e) => setDepartureDate(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        {/* Return / Check-out Date (Conditional) */}
        {requiresReturnDate && (
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {category === 'hotels' ? 'Check-out' : 'Tanggal Pulang'}
            </label>
            <input
              type="date"
              value={returnDate}
              min={departureDate || undefined}
              onChange={(e) => setReturnDate(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        )}

        {/* Travelers */}
        <div className={requiresReturnDate ? 'lg:col-span-2' : 'lg:col-span-2'}>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {category === 'hotels' ? 'Jumlah Tamu' : 'Peserta'}
          </label>
          <div className="relative">
            <Users className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="number"
              min={1}
              max={50}
              value={travelers}
              onChange={(e) => setTravelers(e.target.value)}
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
        </div>

        {/* Submit */}
        <div className={`${requiresReturnDate ? 'lg:col-span-12' : 'lg:col-span-2'} flex items-end`}>
          <button
            type="submit"
            className="w-full h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 shadow-xs transition-colors"
          >
            <Search className="w-4 h-4" />
            <span>Cari Perjalanan</span>
          </button>
        </div>
      </div>
    </form>
  );
};

// ============================================================================
// 7. SUPABASE & MIDTRANS CONTRACT CONFIGURATION MODAL
// ============================================================================
// Allows technical operators/evaluators to bind real Supabase Edge Function
// contracts and Midtrans Sandbox/Production Client Keys without hardcoding
// credentials or fabricating backend endpoints.

const BackendIntegrationModal = ({ open, onClose }) => {
  const { runtimeConfig, updateRuntimeConfig, auditLogs, addToast } = useApp();
  const [formState, setFormState] = useState(runtimeConfig);
  const [activeTab, setActiveTab] = useState('connection');

  useEffect(() => {
    setFormState(runtimeConfig);
  }, [runtimeConfig, open]);

  if (!open) return null;

  const handleSave = (e) => {
    e.preventDefault();
    updateRuntimeConfig(formState);
    addToast({
      type: 'success',
      title: 'Konfigurasi Integrasi Disimpan',
      message: 'Parameter koneksi Supabase dan Midtrans telah diperbarui untuk sesi ini.',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
              <Server className="w-5 h-5 text-teal-700" />
              Konfigurasi Kontrak Backend & Midtrans
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Hanya gunakan kunci publik (Anon Key / Midtrans Client Key). Jangan pernah memasukkan Service Role Key atau Server Key di frontend.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-200/70"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 px-5 bg-white gap-4">
          {[
            { id: 'connection', label: 'Koneksi Supabase & Midtrans' },
            { id: 'contracts', label: 'Kontrak Edge Functions (7)' },
            { id: 'logs', label: `Log Audit API (${auditLogs.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-teal-700 text-teal-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === 'connection' && (
            <>
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-4 h-4 text-teal-700" />
                  Kredensial Publik Supabase
                </h3>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supabase Project URL
                  </label>
                  <input
                    type="url"
                    value={formState.supabaseUrl}
                    onChange={(e) => setFormState({ ...formState, supabaseUrl: e.target.value })}
                    placeholder="https://xxxxxxxxxxxx.supabase.co"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Supabase Anon / Publishable Key
                  </label>
                  <input
                    type="text"
                    value={formState.supabaseAnonKey}
                    onChange={(e) => setFormState({ ...formState, supabaseAnonKey: e.target.value })}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-teal-700" />
                  Konfigurasi Gateway Pembayaran Midtrans
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Lingkungan (Environment)
                    </label>
                    <select
                      value={formState.midtransEnvironment}
                      onChange={(e) => setFormState({ ...formState, midtransEnvironment: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
                    >
                      <option value="SANDBOX">SANDBOX (Pengujian)</option>
                      <option value="PRODUCTION">PRODUCTION (Langsung)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Metode Integrasi Terkonfirmasi
                    </label>
                    <select
                      value={formState.midtransMethod}
                      onChange={(e) => setFormState({ ...formState, midtransMethod: e.target.value })}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
                    >
                      <option value="UNCONFIGURED">Belum Dikonfirmasi</option>
                      <option value="CORE_API">Midtrans Core API (VA / QRIS / kanal tersedia)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Midtrans Client Key (Bukan Server Key)
                  </label>
                  <input
                    type="text"
                    value={formState.midtransClientKey}
                    onChange={(e) => setFormState({ ...formState, midtransClientKey: e.target.value })}
                    placeholder="SB-Mid-client-xxxxxxxxxxxx"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>
            </>
          )}

          {activeTab === 'contracts' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Masukkan path Edge Function aktual Anda (misalnya <code className="bg-slate-100 px-1.5 py-0.5 rounded">/functions/v1/nama-fungsi</code>) untuk setiap kontrak layanan di bawah ini:
              </p>
              {REQUIRED_BACKEND_CONTRACTS.map((contract) => (
                <div key={contract.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 font-mono">{contract.id}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                      {contract.service}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">{contract.description}</p>
                  <input
                    type="text"
                    value={formState.endpoints[contract.id] || ''}
                    onChange={(e) =>
                      setFormState({
                        ...formState,
                        endpoints: { ...formState.endpoints, [contract.id]: e.target.value },
                      })
                    }
                    placeholder="/functions/v1/..."
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-mono"
                  />
                  <div className="text-[11px] text-slate-500 font-mono bg-white p-2 rounded border border-slate-200/80 overflow-x-auto">
                    <div>Req: {contract.expectedRequest}</div>
                    <div>Res: {contract.expectedResponse}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">
                  Belum ada aktivitas panggilan API pada sesi ini.
                </p>
              ) : (
                auditLogs.map((log, idx) => (
                  <div key={idx} className="p-3 rounded-xl border border-slate-200 text-xs font-mono bg-slate-50">
                    <div className="flex justify-between text-slate-500 mb-1">
                      <span>{log.contractId}</span>
                      <span>{formatDateID(log.timestamp, true)}</span>
                    </div>
                    <div className="font-semibold text-slate-800">[{log.status}] {log.message}</div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200"
            >
              Tutup
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800"
            >
              Simpan Konfigurasi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 8. PAGE 01 — HOME (/)
// ============================================================================

const HomePage = () => {
  const { navigate, services, openIntegrationModal } = useApp();
  const [featuredProducts, setFeaturedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const loadFeatured = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await services.productService.listProducts({ sort: 'recommended', page: 1 });
      if (requestId !== requestIdRef.current) return;
      setFeaturedProducts(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    loadFeatured();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadFeatured]);

  const handleHeroSearch = (params) => {
    const query = new URLSearchParams();
    if (params.destination) query.set('destination', params.destination);
    if (params.category) query.set('category', params.category);
    if (params.departureDate) query.set('date', params.departureDate);
    if (params.returnDate) query.set('returnDate', params.returnDate);
    if (params.travelers) query.set('travelers', String(params.travelers));
    navigate(`/explore?${query.toString()}`);
  };

  return (
    <div className="space-y-12 pb-12">
      {/* Hero Section */}
      <section className="relative bg-slate-900 text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-35 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=1600&q=80')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/75 via-slate-900/75 to-slate-900" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-14 sm:pt-16 sm:pb-20">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-200 text-xs font-semibold mb-4">
              <ShieldCheck className="w-3.5 h-3.5" />
              Platform Pemesanan Perjalanan Resmi ASRIVA An Tours
            </span>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight">
              Rencanakan Perjalanan Terorganisir Bersama ASRIVA An Tours
            </h1>
            <p className="text-sm sm:text-base text-slate-200 mt-4 leading-relaxed">
              Pemesanan instan untuk paket tur, akomodasi hotel, tiket penerbangan, transportasi, dan aktivitas wisata dengan harga transparan dalam Rupiah serta verifikasi ketersediaan waktu nyata.
            </p>
          </div>

          <div className="mt-8">
            <SearchBar onSearch={handleHeroSearch} />
          </div>
        </div>
      </section>

      {/* Travel Categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Kategori Layanan Perjalanan</h2>
            <p className="text-sm text-slate-600 mt-1">Pilih layanan perjalanan yang dikelola langsung oleh ASRIVA An Tours</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => navigate(cat.route)}
                className="group text-left bg-white p-4 rounded-2xl border border-slate-200/90 hover:border-teal-600 hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 group-hover:bg-teal-700 group-hover:text-white flex items-center justify-center transition-colors mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">{cat.label}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{cat.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recommended & Popular Products from Supabase */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Katalog Perjalanan ASRIVA</h2>
            <p className="text-sm text-slate-600 mt-1">
              Seluruh jadwal, kapasitas, dan tarif diambil langsung dari sistem inventaris ASRIVA
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/explore')}
            className="text-sm font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1"
          >
            Lihat Semua <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <LoadingSkeleton count={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={loadFeatured} />
        ) : featuredProducts.length === 0 ? (
          <EmptyState
            icon={Compass}
            title="Belum Ada Produk Perjalanan Terpublikasi"
            description="Saat ini belum ada produk aktif yang dikembalikan oleh database ASRIVA. Silakan periksa kembali nanti atau hubungi tim layanan pelanggan kami."
            actionLabel="Jelajahi Halaman Pencarian"
            onAction={() => navigate('/explore')}
            secondaryLabel="Cek Koneksi Backend"
            onSecondary={openIntegrationModal}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featuredProducts.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        )}
      </section>

      {/* Why Choose ASRIVA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10">
          <div className="max-w-2xl mb-8">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Mengapa Memilih ASRIVA An Tours</h2>
            <p className="text-sm text-slate-600 mt-1.5">
              Standar layanan perjalanan profesional dengan kepastian konfirmasi dan keamanan pembayaran.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Award,
                title: 'Layanan Perjalanan Profesional',
                desc: 'Produk perjalanan dikelola dan dikurasi langsung oleh tim ASRIVA An Tours.',
              },
              {
                icon: Receipt,
                title: 'Harga Transparan (IDR)',
                desc: 'Rincian biaya jelas sejak awal tanpa biaya tersembunyi saat proses checkout.',
              },
              {
                icon: CalendarCheck,
                title: 'Pemesanan Terorganisir',
                desc: 'Validasi ketersediaan jadwal instan dan akses invoice digital kapan saja.',
              },
              {
                icon: Lock,
                title: 'Pembayaran Terverifikasi',
                desc: 'Transaksi diproses melalui gateway pembayaran resmi Midtrans dengan verifikasi server.',
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// 9. PAGES 02–07 — EXPLORE & CATEGORY LISTINGS
// (/explore, /tours, /hotels, /flights, /transport, /activities)
// ============================================================================

const ProductListingPage = ({ fixedCategory = null, pageTitle, pageSubtitle }) => {
  const { services, currentSearch, navigate } = useApp();
  const params = useMemo(() => new URLSearchParams(currentSearch), [currentSearch]);

  const [filters, setFilters] = useState({
    destination: params.get('destination') || '',
    category: fixedCategory || params.get('category') || '',
    date: params.get('date') || '',
    returnDate: params.get('returnDate') || '',
    travelers: Number(params.get('travelers')) || 1,
    minPrice: '',
    maxPrice: '',
    sort: 'recommended',
    page: 1,
  });

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showMobileFilter, setShowMobileFilter] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      category: fixedCategory || params.get('category') || prev.category,
      destination: params.get('destination') ?? prev.destination,
      date: params.get('date') ?? prev.date,
      returnDate: params.get('returnDate') ?? prev.returnDate,
      travelers: Number(params.get('travelers')) || prev.travelers,
    }));
  }, [fixedCategory, params]);

  const fetchProducts = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await services.productService.listProducts({
        destination: filters.destination || undefined,
        category: fixedCategory || filters.category || undefined,
        date: filters.date || undefined,
        returnDate: filters.returnDate || undefined,
        travelers: filters.travelers || 1,
        minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
        maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
        sort: filters.sort,
        page: filters.page,
      });
      if (requestId !== requestIdRef.current) return;
      setProducts(Array.isArray(res?.items) ? res.items : []);
      setTotal(typeof res?.total === 'number' ? res.total : 0);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [services, filters, fixedCategory]);

  useEffect(() => {
    fetchProducts();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchProducts]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{pageTitle}</h1>
          <p className="text-sm text-slate-600 mt-1">{pageSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowMobileFilter(!showMobileFilter)}
          className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filter & Urutkan
        </button>
      </div>

      {/* Category Pills (when on /explore) */}
      {!fixedCategory && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setFilters({ ...filters, category: '', page: 1 })}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap border transition-colors ${
              !filters.category
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            Semua Kategori
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilters({ ...filters, category: cat.id, page: 1 })}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap border transition-colors ${
                filters.category === cat.id
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Filter Sidebar */}
        <aside
          className={`lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-5 space-y-4 ${
            showMobileFilter ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Filter className="w-4 h-4 text-teal-700" />
              Filter Pencarian
            </h2>
            <button
              type="button"
              onClick={() =>
                setFilters({
                  destination: '',
                  category: fixedCategory || '',
                  date: '',
                  returnDate: '',
                  travelers: 1,
                  minPrice: '',
                  maxPrice: '',
                  sort: 'recommended',
                  page: 1,
                })
              }
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              Reset
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {fixedCategory === 'flights' ? 'Rute / Kota Tujuan' : 'Destinasi'}
            </label>
            <input
              type="text"
              value={filters.destination}
              onChange={(e) => setFilters({ ...filters, destination: e.target.value, page: 1 })}
              placeholder="Cari kota atau nama produk..."
              className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {fixedCategory === 'hotels' ? 'Tanggal Check-in' : 'Tanggal Perjalanan'}
            </label>
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value, page: 1 })}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          {(fixedCategory === 'hotels' || fixedCategory === 'flights') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {fixedCategory === 'hotels' ? 'Tanggal Check-out' : 'Tanggal Pulang'}
              </label>
              <input
                type="date"
                value={filters.returnDate}
                min={filters.date || undefined}
                onChange={(e) => setFilters({ ...filters, returnDate: e.target.value, page: 1 })}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Jumlah Peserta / Tamu
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={filters.travelers}
              onChange={(e) =>
                setFilters({ ...filters, travelers: Math.max(1, Number(e.target.value) || 1), page: 1 })
              }
              className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Harga Min (IDR)</label>
              <input
                type="number"
                min={0}
                step={50000}
                value={filters.minPrice}
                onChange={(e) => setFilters({ ...filters, minPrice: e.target.value, page: 1 })}
                placeholder="0"
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Harga Maks (IDR)</label>
              <input
                type="number"
                min={0}
                step={50000}
                value={filters.maxPrice}
                onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value, page: 1 })}
                placeholder="Tanpa batas"
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Urutkan</label>
            <select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value, page: 1 })}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
            >
              <option value="recommended">Rekomendasi ASRIVA</option>
              <option value="price_asc">Harga Terendah</option>
              <option value="price_desc">Harga Tertinggi</option>
              <option value="newest">Terbaru</option>
            </select>
          </div>
        </aside>

        {/* Results */}
        <div className="lg:col-span-9">
          {fixedCategory === 'flights' && (
            <div className="mb-4 p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <span>
                Halaman ini hanya menampilkan produk layanan penerbangan resmi yang disediakan dan dikelola oleh ASRIVA An Tours dari inventaris Supabase.
              </span>
            </div>
          )}

          {loading ? (
            <LoadingSkeleton count={6} />
          ) : error ? (
            <ErrorState error={error} onRetry={fetchProducts} />
          ) : products.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Tidak Ada Produk yang Sesuai"
              description="Tidak ditemukan produk perjalanan ASRIVA yang cocok dengan kriteria filter Anda. Ubah tanggal, destinasi, atau atur ulang filter."
              actionLabel="Atur Ulang Filter"
              onAction={() =>
                setFilters({
                  destination: '',
                  category: fixedCategory || '',
                  date: '',
                  returnDate: '',
                  travelers: 1,
                  minPrice: '',
                  maxPrice: '',
                  sort: 'recommended',
                  page: 1,
                })
              }
              secondaryLabel="Kembali ke Beranda"
              onSecondary={() => navigate('/')}
            />
          ) : (
            <>
              <div className="text-xs text-slate-500 mb-3">
                Menampilkan <strong className="text-slate-800">{products.length}</strong> dari{' '}
                <strong className="text-slate-800">{total || products.length}</strong> produk tersedia
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 10. PAGE 08 — PRODUCT DETAIL (/product/:id)
// ============================================================================

const ProductDetailPage = ({ productId }) => {
  const { services, navigate, setBookingDraft, addToast } = useApp();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Booking Widget State (Category-Aware)
  const [travelDate, setTravelDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [travelers, setTravelers] = useState(1);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [timeSlot, setTimeSlot] = useState('');

  // Server-Validated Availability & Quote
  const [validating, setValidating] = useState(false);
  const [quote, setQuote] = useState(null);
  const [validationError, setValidationError] = useState('');
  const requestIdRef = useRef(0);

  const loadDetail = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await services.productService.getProductDetail(productId);
      if (requestId !== requestIdRef.current) return;
      if (!res?.product) {
        throw new ApiIntegrationError('BACKEND_ERROR', 'Produk perjalanan tidak ditemukan di database ASRIVA.', 'products.detail');
      }
      setProduct(res.product);
      setReviews(Array.isArray(res.verifiedReviews) ? res.verifiedReviews : []);
      setRelated(Array.isArray(res.relatedProducts) ? res.relatedProducts : []);
      if (Array.isArray(res.product.options) && res.product.options.length > 0) {
        setSelectedOptionId(res.product.options[0].id);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [services, productId]);

  useEffect(() => {
    loadDetail();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadDetail]);

  const handleValidateAvailability = async () => {
    if (!travelDate) {
      setValidationError('Silakan pilih tanggal perjalanan terlebih dahulu.');
      return;
    }
    if ((product.category === 'hotels' || product.category === 'flights') && !returnDate) {
      setValidationError(
        product.category === 'hotels'
          ? 'Silakan pilih tanggal check-out.'
          : 'Silakan pilih tanggal kepulangan (jika pulang-pergi) atau isi tanggal perjalanan.'
      );
      return;
    }
    if (product.category === 'transportation' && !pickupLocation.trim()) {
      setValidationError('Silakan isi lokasi penjemputan.');
      return;
    }

    setValidating(true);
    setValidationError('');
    setQuote(null);

    try {
      const res = await services.availabilityService.validateAvailabilityAndPrice({
        productId: product.id,
        category: product.category,
        startDate: travelDate,
        endDate: returnDate || undefined,
        travelers: Number(travelers),
        optionId: selectedOptionId || undefined,
        pickupLocation: pickupLocation || undefined,
        timeSlot: timeSlot || undefined,
      });

      if (!res?.available) {
        setValidationError(res?.message || 'Jadwal atau kapasitas yang dipilih tidak tersedia.');
      } else {
        setQuote(res);
        addToast({
          type: 'success',
          title: 'Ketersediaan Terverifikasi',
          message: 'Jadwal dan tarif resmi telah diverifikasi oleh sistem ASRIVA.',
        });
      }
    } catch (err) {
      setValidationError(err.message);
    } finally {
      setValidating(false);
    }
  };

  const handleProceedToBooking = () => {
    if (!quote || !quote.available) {
      setValidationError('Harap lakukan pengecekan ketersediaan terlebih dahulu sebelum melanjutkan.');
      return;
    }
    const chosenOption = product.options?.find((o) => o.id === selectedOptionId);
    setBookingDraft({
      product,
      schedule: {
        startDate: travelDate,
        endDate: returnDate || null,
        travelers: Number(travelers),
        optionId: selectedOptionId || null,
        optionName: chosenOption?.name || null,
        pickupLocation: pickupLocation || null,
        timeSlot: timeSlot || null,
      },
      quote,
      contact: null,
      travelersList: [],
      specialRequests: '',
    });
    navigate('/booking/information');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <LoadingSkeleton count={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorState error={error} onRetry={loadDetail} />
      </div>
    );
  }

  if (!product) return null;

  const catMeta = CATEGORIES.find((c) => c.id === product.category);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
        <button type="button" onClick={() => navigate('/')} className="hover:text-slate-900">
          Beranda
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <button
          type="button"
          onClick={() => navigate(catMeta?.route || '/explore')}
          className="hover:text-slate-900"
        >
          {catMeta?.label || 'Produk'}
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-slate-900 font-medium truncate max-w-xs">{product.title}</span>
      </nav>

      {/* Gallery & Header */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="aspect-[16/9] rounded-2xl bg-slate-100 overflow-hidden border border-slate-200">
            {product.coverImage ? (
              <img src={product.coverImage} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                <span>Gambar Produk ASRIVA</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-semibold">
                {catMeta?.label || product.category}
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                <MapPin className="w-3.5 h-3.5 text-teal-700" />
                {product.destination}
              </span>
              {product.duration && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-teal-700" />
                  {product.duration}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{product.title}</h1>
          </div>

          {/* Description */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Deskripsi Layanan</h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {product.description || 'Deskripsi detail tersedia sesuai paket perjalanan ASRIVA.'}
            </p>
          </div>

          {/* Highlights, Included, Excluded */}
          {(product.highlights?.length > 0 || product.included?.length > 0 || product.excluded?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {product.included?.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900 text-sm mb-3">Termasuk dalam Layanan</h3>
                  <ul className="space-y-2">
                    {product.included.map((inc, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{inc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {product.excluded?.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900 text-sm mb-3">Tidak Termasuk</h3>
                  <ul className="space-y-2">
                    {product.excluded.map((exc, i) => (
                      <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{exc}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Itinerary */}
          {Array.isArray(product.itinerary) && product.itinerary.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900">Rencana Perjalanan (Itinerary)</h2>
              <div className="space-y-4">
                {product.itinerary.map((day, idx) => (
                  <div key={idx} className="border-l-2 border-teal-700 pl-4 py-1">
                    <h4 className="font-bold text-slate-900 text-sm">{day.title}</h4>
                    <p className="text-sm text-slate-600 mt-1">{day.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Policies */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-900">Ketentuan Pemesanan & Pembatalan</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {product.cancellationPolicy ||
                'Pemesanan bersifat instan setelah validasi ketersediaan sistem ASRIVA. Pembatalan dan pengembalian dana mengikuti kebijakan produk yang berlaku pada saat pemesanan.'}
            </p>
          </div>

          {/* Verified Reviews Only */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Ulasan Pelanggan Terverifikasi</h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-slate-500">
                Belum ada ulasan terverifikasi dari pelanggan untuk produk ini.
              </p>
            ) : (
              <div className="space-y-3">
                {reviews.map((rev, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-900">{rev.customerName}</span>
                      <span className="text-xs text-slate-500">{formatDateID(rev.createdAt)}</span>
                    </div>
                    <p className="text-sm text-slate-700 mt-1.5">{rev.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sticky Category-Aware Booking Widget */}
        <aside className="lg:col-span-4 lg:sticky lg:top-20 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
          <div className="pb-4 border-b border-slate-100">
            <span className="text-xs text-slate-500">Tarif Dasar Publikasi</span>
            <PriceDisplay amount={product.basePrice} unitLabel={product.priceUnit || 'pax'} size="lg" />
          </div>

          {/* Category-Specific Option Selector (Rooms, Vehicle Type, Class, etc.) */}
          {Array.isArray(product.options) && product.options.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {product.category === 'hotels'
                  ? 'Pilihan Tipe Kamar'
                  : product.category === 'transportation'
                  ? 'Pilihan Armada / Kendaraan'
                  : 'Pilihan Paket / Kelas'}
              </label>
              <select
                value={selectedOptionId}
                onChange={(e) => {
                  setSelectedOptionId(e.target.value);
                  setQuote(null);
                }}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm bg-white"
              >
                {product.options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name} ({formatIDR(opt.price)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {product.category === 'hotels' ? 'Tanggal Check-in *' : 'Tanggal Perjalanan *'}
            </label>
            <input
              type="date"
              value={travelDate}
              onChange={(e) => {
                setTravelDate(e.target.value);
                setQuote(null);
              }}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          {(product.category === 'hotels' || product.category === 'flights') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {product.category === 'hotels' ? 'Tanggal Check-out *' : 'Tanggal Pulang'}
              </label>
              <input
                type="date"
                value={returnDate}
                min={travelDate || undefined}
                onChange={(e) => {
                  setReturnDate(e.target.value);
                  setQuote(null);
                }}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          )}

          {product.category === 'transportation' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Lokasi Penjemputan *
              </label>
              <input
                type="text"
                value={pickupLocation}
                onChange={(e) => {
                  setPickupLocation(e.target.value);
                  setQuote(null);
                }}
                placeholder="Bandara / Alamat Hotel"
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          )}

          {product.category === 'activities' && Array.isArray(product.timeSlots) && product.timeSlots.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Slot Waktu</label>
              <select
                value={timeSlot}
                onChange={(e) => {
                  setTimeSlot(e.target.value);
                  setQuote(null);
                }}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="">Pilih Jam Aktivitas</option>
                {product.timeSlots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot} WITA/WIB
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {product.category === 'hotels' ? 'Jumlah Tamu / Kamar *' : 'Jumlah Peserta *'}
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={travelers}
              onChange={(e) => {
                setTravelers(Math.max(1, Number(e.target.value) || 1));
                setQuote(null);
              }}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          {validationError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{validationError}</span>
            </div>
          )}

          {quote && quote.available && (
            <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 space-y-2 text-xs">
              <div className="flex items-center justify-between text-emerald-900 font-semibold">
                <span>Status Jadwal</span>
                <span>Tersedia</span>
              </div>
              <div className="flex items-center justify-between text-slate-700">
                <span>Subtotal ({travelers} unit)</span>
                <span>{formatIDR(quote.subtotal)}</span>
              </div>
              {typeof quote.taxesAndFees === 'number' && (
                <div className="flex items-center justify-between text-slate-700">
                  <span>Pajak & Biaya Layanan</span>
                  <span>{formatIDR(quote.taxesAndFees)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-emerald-200 flex items-center justify-between text-sm font-bold text-slate-900">
                <span>Total Terverifikasi</span>
                <span>{formatIDR(quote.totalAmount)}</span>
              </div>
            </div>
          )}

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              disabled={validating}
              onClick={handleValidateAvailability}
              className="w-full h-11 px-4 rounded-xl border border-teal-700 text-teal-800 hover:bg-teal-50 font-semibold text-sm transition-colors disabled:opacity-50"
            >
              {validating ? 'Memeriksa Ketersediaan...' : 'Cek Ketersediaan & Harga Resmi'}
            </button>

            <button
              type="button"
              disabled={!quote || !quote.available}
              onClick={handleProceedToBooking}
              className="w-full h-12 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span>Lanjutkan Pemesanan</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

// ============================================================================
// 11. PAGE 09 — BOOKING INFORMATION (/booking/information)
// ============================================================================

const BookingInformationPage = () => {
  const { bookingDraft, navigate } = useApp();

  if (!bookingDraft?.product || !bookingDraft?.quote) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={Calendar}
          title="Belum Ada Produk yang Dipilih"
          description="Silakan pilih produk perjalanan dan verifikasi ketersediaan jadwal terlebih dahulu sebelum mengisi data pemesan."
          actionLabel="Jelajahi Produk Perjalanan"
          onAction={() => navigate('/explore')}
        />
      </div>
    );
  }

  return <BookingInformationForm />;
};

const BookingInformationForm = () => {
  const { bookingDraft, setBookingDraft, navigate, user } = useApp();
  const { product, schedule, quote } = bookingDraft;
  const requiresIdentification =
    product.category === 'flights' || product.requiresIdNumber === true;

  const [contact, setContact] = useState(
    bookingDraft.contact || {
      fullName: user?.user_metadata?.full_name || '',
      email: user?.email || '',
      phone: user?.user_metadata?.phone || '',
      whatsapp: user?.user_metadata?.phone || '',
    }
  );

  const [travelersList, setTravelersList] = useState(() => {
    if (bookingDraft.travelersList?.length === schedule.travelers) {
      return bookingDraft.travelersList;
    }
    return Array.from({ length: schedule.travelers }, (_, idx) => ({
      fullName: idx === 0 && user?.user_metadata?.full_name ? user.user_metadata.full_name : '',
      travelerType: 'Dewasa',
      dateOfBirth: '',
      idNumber: '',
    }));
  });

  const [specialRequests, setSpecialRequests] = useState(bookingDraft.specialRequests || '');
  const [formErrors, setFormErrors] = useState({});

  const updateTraveler = (index, field, value) => {
    setTravelersList((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  };

  const validateForm = () => {
    const errs = {};
    if (!contact.fullName.trim()) errs.contactName = 'Nama lengkap pemesan wajib diisi.';
    if (!contact.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      errs.contactEmail = 'Alamat email aktif wajib diisi dengan format yang benar.';
    }
    if (!contact.phone.trim() || contact.phone.replace(/\D/g, '').length < 9) {
      errs.contactPhone = 'Nomor telepon aktif wajib diisi (minimal 9 digit).';
    }
    if (!contact.whatsapp.trim() || contact.whatsapp.replace(/\D/g, '').length < 9) {
      errs.contactWhatsapp = 'Nomor WhatsApp aktif wajib diisi untuk pengiriman e-tiket & konfirmasi.';
    }

    travelersList.forEach((trav, idx) => {
      if (!trav.fullName.trim()) {
        errs[`trav_name_${idx}`] = `Nama lengkap peserta #${idx + 1} wajib diisi.`;
      }
      if (requiresIdentification && !trav.idNumber.trim()) {
        errs[`trav_id_${idx}`] = `Nomor identitas (KTP/Paspor) peserta #${idx + 1} wajib diisi untuk layanan ini.`;
      }
    });

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setBookingDraft({
      ...bookingDraft,
      contact,
      travelersList,
      specialRequests,
    });
    navigate('/booking/review');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => navigate(`/product/${encodeURIComponent(product.id)}`)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-2"
        >
          <ChevronLeft className="w-4 h-4" /> Kembali ke Detail Produk
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Informasi Pemesan & Peserta</h1>
        <p className="text-sm text-slate-600 mt-1">
          {user
            ? `Masuk sebagai ${user.email}`
            : 'Anda melakukan pemesanan sebagai Tamu (Guest Checkout). Akun pelanggan bersifat opsional.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          {/* Contact Information */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Data Kontak Pemesan</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Lengkap Pemesan *
                </label>
                <input
                  type="text"
                  value={contact.fullName}
                  onChange={(e) => setContact({ ...contact, fullName: e.target.value })}
                  placeholder="Sesuai kartu identitas"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {formErrors.contactName && (
                  <p className="text-xs text-rose-600 mt-1">{formErrors.contactName}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Alamat Email *
                </label>
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                  placeholder="nama@email.com"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {formErrors.contactEmail && (
                  <p className="text-xs text-rose-600 mt-1">{formErrors.contactEmail}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nomor Telepon *
                </label>
                <input
                  type="tel"
                  value={contact.phone}
                  onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  placeholder="08xxxxxxxxxx"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {formErrors.contactPhone && (
                  <p className="text-xs text-rose-600 mt-1">{formErrors.contactPhone}</p>
                )}
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nomor WhatsApp Aktif *
                </label>
                <input
                  type="tel"
                  value={contact.whatsapp}
                  onChange={(e) => setContact({ ...contact, whatsapp: e.target.value })}
                  placeholder="08xxxxxxxxxx"
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {formErrors.contactWhatsapp && (
                  <p className="text-xs text-rose-600 mt-1">{formErrors.contactWhatsapp}</p>
                )}
              </div>
            </div>
          </section>

          {/* Traveler Information */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
            <h2 className="text-base font-bold text-slate-900">
              Data Peserta Perjalanan ({travelersList.length} Orang)
            </h2>
            {travelersList.map((trav, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Peserta #{idx + 1}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nama Lengkap Peserta *
                    </label>
                    <input
                      type="text"
                      value={trav.fullName}
                      onChange={(e) => updateTraveler(idx, 'fullName', e.target.value)}
                      placeholder="Nama sesuai KTP / Paspor"
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm"
                    />
                    {formErrors[`trav_name_${idx}`] && (
                      <p className="text-xs text-rose-600 mt-1">{formErrors[`trav_name_${idx}`]}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kategori Peserta
                    </label>
                    <select
                      value={trav.travelerType}
                      onChange={(e) => updateTraveler(idx, 'travelerType', e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm"
                    >
                      <option value="Dewasa">Dewasa</option>
                      <option value="Anak">Anak</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tanggal Lahir {requiresIdentification ? '*' : '(Opsional)'}
                    </label>
                    <input
                      type="date"
                      value={trav.dateOfBirth}
                      onChange={(e) => updateTraveler(idx, 'dateOfBirth', e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm"
                    />
                  </div>

                  {requiresIdentification && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nomor Identitas (NIK KTP / Nomor Paspor) *
                      </label>
                      <input
                        type="text"
                        value={trav.idNumber}
                        onChange={(e) => updateTraveler(idx, 'idNumber', e.target.value)}
                        placeholder="Masukkan nomor identitas resmi"
                        className="w-full h-10 px-3 rounded-xl border border-slate-300 bg-white text-sm"
                      />
                      {formErrors[`trav_id_${idx}`] && (
                        <p className="text-xs text-rose-600 mt-1">{formErrors[`trav_id_${idx}`]}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>

          {/* Special Requests */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-3">
            <label className="block text-base font-bold text-slate-900">
              Permintaan Khusus (Opsional)
            </label>
            <textarea
              rows={3}
              value={specialRequests}
              onChange={(e) => setSpecialRequests(e.target.value)}
              placeholder="Contoh: Kebutuhan diet khusus, permintaan kamar bebas asap rokok, informasi nomor penerbangan..."
              className="w-full p-3 rounded-xl border border-slate-300 text-sm"
            />
          </section>
        </div>

        {/* Summary Sidebar */}
        <aside className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-bold text-slate-900 text-base">Ringkasan Pesanan</h2>
          <div className="space-y-2 text-xs text-slate-600 pb-4 border-b border-slate-100">
            <p className="font-bold text-sm text-slate-900">{product.title}</p>
            <p>Destinasi: {product.destination}</p>
            <p>Tanggal: {formatDateID(schedule.startDate)}</p>
            {schedule.endDate && <p>Selesai / Check-out: {formatDateID(schedule.endDate)}</p>}
            {schedule.optionName && <p>Pilihan: {schedule.optionName}</p>}
            <p>Jumlah Peserta: {schedule.travelers} orang</p>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatIDR(quote.subtotal)}</span>
            </div>
            {typeof quote.taxesAndFees === 'number' && (
              <div className="flex justify-between text-slate-600">
                <span>Pajak & Biaya Layanan</span>
                <span>{formatIDR(quote.taxesAndFees)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 flex justify-between font-bold text-sm text-slate-900">
              <span>Total Tagihan</span>
              <span>{formatIDR(quote.totalAmount)}</span>
            </div>
          </div>

          <button
            type="submit"
            className="w-full h-12 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors"
          >
            Tinjau Pemesanan
          </button>
        </aside>
      </form>
    </div>
  );
};

// ============================================================================
// 12. PAGE 10 — BOOKING REVIEW (/booking/review)
// ============================================================================

const BookingReviewPage = () => {
  const { bookingDraft, services, navigate, saveBookingRecord, addToast } = useApp();
  const [submitting, setSubmitting] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  if (!bookingDraft?.product || !bookingDraft?.contact) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={FileText}
          title="Data Pemesanan Belum Lengkap"
          description="Silakan lengkapi informasi pemesan dan peserta perjalanan terlebih dahulu."
          actionLabel="Kembali ke Form Pemesanan"
          onAction={() => navigate('/booking/information')}
        />
      </div>
    );
  }

  const { product, schedule, quote, contact, travelersList, specialRequests } = bookingDraft;

  const handleConfirmBooking = async () => {
    if (!agreedTerms) {
      addToast({
        type: 'error',
        title: 'Persetujuan Diperlukan',
        message: 'Harap setujui Syarat & Ketentuan serta Kebijakan Pemesanan ASRIVA An Tours.',
      });
      return;
    }

    if (submitting) return; // Duplicate submission guard
    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Revalidate availability & authoritative server price right before confirmation
      const freshQuote = await services.availabilityService.validateAvailabilityAndPrice({
        productId: product.id,
        category: product.category,
        startDate: schedule.startDate,
        endDate: schedule.endDate || undefined,
        travelers: schedule.travelers,
        optionId: schedule.optionId || undefined,
        pickupLocation: schedule.pickupLocation || undefined,
        timeSlot: schedule.timeSlot || undefined,
      });

      if (!freshQuote?.available) {
        throw new ApiIntegrationError(
          'VALIDATION_ERROR',
          'Maaf, ketersediaan kapasitas untuk jadwal ini baru saja penuh. Silakan pilih jadwal lain.',
          'availability.validate'
        );
      }

      // 2. Create confirmed booking on backend
      const createdRes = await services.bookingService.createConfirmedBooking({
        idempotencyKey,
        productId: product.id,
        schedule,
        contact,
        travelers: travelersList,
        specialRequests,
        quoteToken: freshQuote.quoteToken,
      });

      if (!createdRes?.booking?.bookingReference) {
        throw new ApiIntegrationError(
          'BACKEND_ERROR',
          'Respons pembuatan pesanan dari backend tidak menyertakan nomor referensi booking yang valid.',
          'bookings.create'
        );
      }

      saveBookingRecord(createdRes.booking, createdRes.bookingAccessToken, createdRes.accessExpiresAt);
      addToast({
        type: 'success',
        title: 'Pemesanan Terkonfirmasi',
        message: `Nomor Booking ${createdRes.booking.bookingReference} berhasil dibuat. Silakan lanjutkan ke pembayaran.`,
      });
      navigate(`/booking/confirmation/${encodeURIComponent(createdRes.booking.bookingReference)}`);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate('/booking/information')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mb-2"
        >
          <ChevronLeft className="w-4 h-4" /> Ubah Informasi Pemesan
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Tinjauan Akhir Pemesanan</h1>
        <p className="text-sm text-slate-600 mt-1">
          Periksa kembali seluruh rincian sebelum sistem mengunci ketersediaan dan menerbitkan kode pemesanan.
        </p>
      </div>

      {submitError && <ErrorState error={submitError} onRetry={handleConfirmBooking} />}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div className="pb-4 border-b border-slate-100">
          <span className="text-xs font-semibold text-teal-700 uppercase">Produk Perjalanan</span>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">{product.title}</h2>
          <p className="text-sm text-slate-600 mt-1">
            {product.destination} • {formatDateID(schedule.startDate)}
            {schedule.endDate ? ` s/d ${formatDateID(schedule.endDate)}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-100 text-sm">
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">Kontak Pemesan</h3>
            <p className="font-semibold text-slate-900">{contact.fullName}</p>
            <p className="text-slate-600">{contact.email}</p>
            <p className="text-slate-600">Telp: {contact.phone} / WA: {contact.whatsapp}</p>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-500 mb-1.5">Daftar Peserta</h3>
            <ul className="space-y-1 text-slate-700">
              {travelersList.map((t, i) => (
                <li key={i}>
                  {i + 1}. {t.fullName} ({t.travelerType})
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal ({schedule.travelers} peserta)</span>
            <span>{formatIDR(quote.subtotal)}</span>
          </div>
          {typeof quote.taxesAndFees === 'number' && (
            <div className="flex justify-between text-slate-600">
              <span>Pajak & Biaya Layanan</span>
              <span>{formatIDR(quote.taxesAndFees)}</span>
            </div>
          )}
          <div className="pt-3 border-t border-slate-200 flex justify-between font-bold text-base text-slate-900">
            <span>Total Akhir</span>
            <span>{formatIDR(quote.totalAmount)}</span>
          </div>
        </div>

        <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedTerms}
            onChange={(e) => setAgreedTerms(e.target.checked)}
            className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
          />
          <span className="text-xs text-slate-700 leading-relaxed">
            Saya menyatakan data pemesan dan peserta sudah benar serta menyetujui Syarat & Ketentuan, Kebijakan Pemesanan, dan Kebijakan Pembatalan ASRIVA An Tours.
          </span>
        </label>

        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirmBooking}
          className="w-full h-12 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {submitting ? 'Memvalidasi & Mengonfirmasi Pesanan...' : 'Konfirmasi Pemesanan Sekarang'}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 13. PAGE 11 — BOOKING CONFIRMATION (/booking/confirmation/:ref)
// ============================================================================

const BookingConfirmationPage = ({ bookingRef }) => {
  const { activeBookings, navigate } = useApp();
  // A booking reference is an identifier, not an authorization credential.
  // Only show data returned by booking creation or by the verified lookup flow.
  const booking = activeBookings[bookingRef] || null;

  if (!booking) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <EmptyState
          icon={Receipt}
          title="Verifikasi Pesanan Diperlukan"
          description="Untuk melindungi data pemesan, detail pesanan tidak dapat dimuat hanya dengan nomor referensi. Verifikasi nomor booking dan kontak pemesan melalui halaman Pesanan Saya."
          actionLabel="Verifikasi Pesanan Saya"
          onAction={() => navigate('/my-bookings')}
        />
      </div>
    );
  }

  const canPay =
    ['confirmed', 'pending_payment'].includes(booking.bookingStatus) &&
    !['settlement', 'capture'].includes(booking.paymentStatus);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap pb-5 border-b border-slate-100">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase">Nomor Referensi Booking</span>
            <h1 className="text-2xl font-bold font-mono text-slate-900 mt-0.5">
              {booking.bookingReference}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <BookingStatusBadge status={booking.bookingStatus} />
            <PaymentStatusBadge status={booking.paymentStatus || 'unpaid'} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-slate-500 block">Produk Perjalanan</span>
            <span className="font-bold text-slate-900">{booking.productTitle}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Tanggal Perjalanan</span>
            <span className="font-semibold text-slate-900">{formatDateID(booking.startDate)}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Nama Pemesan</span>
            <span className="font-semibold text-slate-900">{booking.contact?.fullName}</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 block">Batas Waktu Pembayaran</span>
            <span className="font-semibold text-amber-800">
              {booking.paymentDeadline ? formatDateID(booking.paymentDeadline, true) : 'Sesuai instruksi checkout'}
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Total Pembayaran</span>
          <PriceDisplay amount={booking.totalAmount} size="lg" />
        </div>

        {canPay ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => navigate(`/checkout/${encodeURIComponent(booking.bookingReference)}`)}
              className="w-full h-12 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              <span>Lanjutkan ke Pembayaran Midtrans</span>
            </button>
            <p className="text-xs text-center text-slate-500">
              Pembayaran hanya diaktifkan setelah pemesanan berstatus Terkonfirmasi.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate(`/my-bookings/${encodeURIComponent(booking.bookingReference)}`)}
            className="w-full h-11 rounded-xl bg-slate-900 text-white font-semibold text-sm"
          >
            Lihat Detail & Invoice Pesanan
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 14. PAGE 12 — MIDTRANS CHECKOUT (/checkout/:ref)
// ============================================================================

const CheckoutPage = ({ bookingRef }) => {
  const { activeBookings, services, navigate, openIntegrationModal, addToast } = useApp();
  const booking = activeBookings[bookingRef] || null;
  const integrationStatus = services.paymentService.getIntegrationStatus();

  const [initiating, setInitiating] = useState(false);
  const [paymentSession, setPaymentSession] = useState(null);
  const [error, setError] = useState(null);
  const [idempotencyKey] = useState(() => {
    const storageKey = `asriva:payment:${bookingRef}:idempotency`;
    try {
      const existingKey = window.localStorage.getItem(storageKey);
      if (existingKey) return existingKey;
      const newKey = crypto.randomUUID();
      window.localStorage.setItem(storageKey, newKey);
      return newKey;
    } catch {
      // Keep checkout usable when browser storage is unavailable.
      return crypto.randomUUID();
    }
  });

  const handleInitiateMidtrans = async () => {
    if (!booking?.bookingReference || booking.bookingReference !== bookingRef) {
      setError(new ApiIntegrationError(
        'AUTHORIZATION_REQUIRED',
        'Verifikasi nomor booking dan kontak pemesan melalui halaman Pesanan Saya sebelum melanjutkan pembayaran.',
        'bookings.lookup'
      ));
      return;
    }
    setInitiating(true);
    setError(null);
    try {
      const res = await services.paymentService.initiatePayment({
        bookingReference: bookingRef,
        idempotencyKey,
        bookingAccessToken: booking.bookingAccessToken || readBookingAccessToken(bookingRef),
      });
      if (res?.mode !== 'CORE_API' || !res?.orderId) {
        throw new ApiIntegrationError(
          'VALIDATION_ERROR',
          'Backend tidak mengembalikan sesi Midtrans CORE_API dengan order ID yang valid.',
          'payments.initiate',
          res
        );
      }
      if (
        (!res.coreApiInstructions || typeof res.coreApiInstructions !== 'object') &&
        !res.redirectUrl
      ) {
        throw new ApiIntegrationError(
          'VALIDATION_ERROR',
          'Sesi pembayaran dibuat, tetapi backend belum mengirim instruksi pembayaran atau URL pengalihan.',
          'payments.initiate',
          res
        );
      }
      setPaymentSession(res);
    } catch (err) {
      setError(err);
    } finally {
      setInitiating(false);
    }
  };

  if (!booking || booking.bookingReference !== bookingRef) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <EmptyState
          icon={ShieldCheck}
          title="Verifikasi Pesanan Diperlukan"
          description="Checkout tidak dapat dibuka hanya dengan nomor referensi. Verifikasi nomor booking dan kontak pemesan melalui halaman Pesanan Saya terlebih dahulu."
          actionLabel="Verifikasi Pesanan Saya"
          onAction={() => navigate('/my-bookings')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Checkout Pembayaran Midtrans</h1>
            <p className="text-xs text-slate-500 font-mono mt-1">Booking Ref: {bookingRef}</p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            Mode: {integrationStatus.environment} • Midtrans CORE_API
          </span>
        </div>

        {/* Unresolved Midtrans Method Guard */}
        {integrationStatus.method !== 'CORE_API' && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 leading-relaxed">
                <p className="font-bold text-sm mb-1">
                  Metode Integrasi Midtrans Belum Dikonfirmasi
                </p>
                <p>
                  ASRIVA menggunakan <strong>Midtrans Core API</strong>. Konfigurasikan metode CORE_API pada pengaturan integrasi sebelum membuat transaksi. Aplikasi tidak menjalankan simulasi pembayaran.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openIntegrationModal}
              className="px-4 py-2 rounded-xl bg-amber-900 text-white text-xs font-semibold hover:bg-amber-950"
            >
              Konfigurasi Midtrans CORE_API
            </button>
          </div>
        )}

        {booking && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Layanan</span>
              <span className="font-semibold text-slate-900">{booking.productTitle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Pemesan</span>
              <span className="font-semibold text-slate-900">{booking.contact?.fullName}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
              <span className="font-bold text-slate-900">Total Tagihan</span>
              <PriceDisplay amount={booking.totalAmount} size="lg" />
            </div>
          </div>
        )}

        {error && <ErrorState error={error} onRetry={handleInitiateMidtrans} />}

        {paymentSession && (
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-3 text-xs text-blue-950">
            <p className="font-bold text-sm">Instruksi Pembayaran Midtrans CORE_API</p>
            <p className="font-mono">Order ID: {paymentSession.orderId}</p>
            {paymentSession.coreApiInstructions && typeof paymentSession.coreApiInstructions === 'object' && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries(paymentSession.coreApiInstructions).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-blue-200 bg-white/70 p-3 min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">{key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ')}</dt>
                    <dd className="mt-1 break-words font-semibold text-sm text-slate-900">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {paymentSession.redirectUrl && (
              <a
                href={paymentSession.redirectUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-700 text-white font-semibold"
              >
                Buka Halaman Pembayaran Midtrans <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <div className="pt-2 border-t border-blue-200">
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/payment/pending?ref=${encodeURIComponent(bookingRef)}&order_id=${encodeURIComponent(
                      paymentSession.orderId || ''
                    )}`
                  )
                }
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold"
              >
                Verifikasi Status Pembayaran dari Server
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={initiating || integrationStatus.method !== 'CORE_API'}
          onClick={handleInitiateMidtrans}
          className="w-full h-12 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors disabled:opacity-40"
        >
          {initiating ? 'Membuat Transaksi Midtrans...' : 'Buat Instruksi Pembayaran Midtrans'}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 15. PAGE 13 — PAYMENT RESULT (/payment/success|pending|failed|expired)
// ============================================================================

const PaymentResultPage = ({ routeSegment }) => {
  const { currentSearch, services, navigate, saveBookingRecord } = useApp();
  const params = useMemo(() => new URLSearchParams(currentSearch), [currentSearch]);
  const bookingRef = params.get('ref') || '';
  const orderId = params.get('order_id') || '';

  const [verifying, setVerifying] = useState(Boolean(bookingRef));
  const [verifiedData, setVerifiedData] = useState(null);
  const [error, setError] = useState(null);

  const verifyWithBackend = useCallback(async () => {
    if (!bookingRef) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await services.paymentService.verifyPaymentStatus({
        bookingReference: bookingRef,
        orderId: orderId || undefined,
        bookingAccessToken: readBookingAccessToken(bookingRef),
      });
      setVerifiedData(res);
      if (res?.booking) {
        saveBookingRecord(res.booking);
      }
    } catch (err) {
      setError(err);
    } finally {
      setVerifying(false);
    }
  }, [services, bookingRef, orderId, saveBookingRecord]);

  useEffect(() => {
    verifyWithBackend();
  }, [verifyWithBackend]);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-800 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-teal-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Status Transaksi Pembayaran</h1>
            <p className="text-xs text-slate-500">
              Status akhir ditentukan secara otoritatif oleh verifikasi server ASRIVA & notifikasi Midtrans.
            </p>
          </div>
        </div>

        {verifying ? (
          <div className="p-6 text-center text-sm text-slate-600 flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-teal-700" />
            <span>Memverifikasi status transaksi dari backend ASRIVA...</span>
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={verifyWithBackend} />
        ) : verifiedData ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Referensi Booking</span>
                <span className="font-mono font-bold text-slate-900">{bookingRef}</span>
              </div>
              {orderId && (
                <div className="flex justify-between">
                  <span className="text-slate-600">ID Transaksi Midtrans</span>
                  <span className="font-mono text-slate-900">{orderId}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Status Pembayaran (Server)</span>
                <PaymentStatusBadge status={verifiedData.paymentStatus} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Status Pemesanan</span>
                <BookingStatusBadge status={verifiedData.bookingStatus} />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={verifyWithBackend}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Perbarui Status
              </button>
              {bookingRef && (
                <button
                  type="button"
                  onClick={() => navigate(`/my-bookings/${encodeURIComponent(bookingRef)}`)}
                  className="px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800"
                >
                  Lihat Detail Pesanan
                </button>
              )}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Receipt}
            title="Parameter Referensi Transaksi Kosong"
            description={`Halaman hasil pembayaran (${routeSegment}) memerlukan parameter referensi booking yang valid untuk verifikasi server.`}
            actionLabel="Cek Pesanan Saya"
            onAction={() => navigate('/my-bookings')}
          />
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 16. PAGES 14 & 15 — MY BOOKING & BOOKING DETAIL
// (/my-bookings, /my-bookings/:ref)
// ============================================================================

const MyBookingsPage = () => {
  const { activeBookings, services, navigate, saveBookingRecord } = useApp();
  const [bookingRef, setBookingRef] = useState('');
  const [contactVerification, setContactVerification] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const savedList = Object.values(activeBookings);

  const handleLookup = async (e) => {
    e.preventDefault();
    if (!bookingRef.trim() || !contactVerification.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await services.bookingService.lookupBooking({
        bookingReference: bookingRef.trim(),
        contactVerification: contactVerification.trim(),
      });
      if (!res?.booking) {
        throw new ApiIntegrationError(
          'BACKEND_ERROR',
          'Pesanan tidak ditemukan atau kontak verifikasi tidak sesuai.',
          'bookings.lookup'
        );
      }
      saveBookingRecord(res.booking, res.bookingAccessToken, res.accessExpiresAt);
      navigate(`/my-bookings/${encodeURIComponent(res.booking.bookingReference)}`);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Pesanan Saya</h1>
        <p className="text-sm text-slate-600 mt-1">
          Lacak status reservasi, pembayaran, dan akses invoice menggunakan kode booking Anda.
        </p>
      </div>

      {/* Guest Booking Lookup */}
      <form onSubmit={handleLookup} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-900">Pencarian Pesanan Tamu (Guest Lookup)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nomor Referensi Booking *
            </label>
            <input
              type="text"
              required
              value={bookingRef}
              onChange={(e) => setBookingRef(e.target.value)}
              placeholder="Contoh: ASR-2026-XXXX"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email atau Nomor WhatsApp Pemesan *
            </label>
            <input
              type="text"
              required
              value={contactVerification}
              onChange={(e) => setContactVerification(e.target.value)}
              placeholder="nama@email.com / 08xxxxxxxx"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {loading ? 'Mencari Pesanan...' : 'Cari & Verifikasi Pesanan'}
        </button>
      </form>

      {error && <ErrorState error={error} />}

      {/* Session Bookings */}
      {savedList.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-slate-900">Riwayat Pesanan Sesi Ini</h2>
          {savedList.map((b) => (
            <div
              key={b.bookingReference}
              onClick={() => navigate(`/my-bookings/${encodeURIComponent(b.bookingReference)}`)}
              className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer hover:border-teal-600 transition-colors"
            >
              <div>
                <span className="text-xs font-mono text-slate-500">{b.bookingReference}</span>
                <h3 className="font-bold text-slate-900">{b.productTitle}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{formatDateID(b.startDate)}</p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <BookingStatusBadge status={b.bookingStatus} />
                <PaymentStatusBadge status={b.paymentStatus || 'unpaid'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const BookingDetailPage = ({ bookingRef }) => {
  const { activeBookings, navigate } = useApp();
  const booking = activeBookings[bookingRef] || null;

  if (!booking) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <EmptyState
          icon={Receipt}
          title="Detail Pesanan Belum Dimuat"
          description="Silakan verifikasi nomor booking dan kontak pemesan melalui halaman Pesanan Saya."
          actionLabel="Ke Halaman Pesanan Saya"
          onAction={() => navigate('/my-bookings')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <button
        type="button"
        onClick={() => navigate('/my-bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        <ChevronLeft className="w-4 h-4" /> Kembali ke Pesanan Saya
      </button>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs text-slate-500">Invoice & Rincian Reservasi</span>
            <h1 className="text-xl sm:text-2xl font-bold font-mono text-slate-900">
              {booking.bookingReference}
            </h1>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <BookingStatusBadge status={booking.bookingStatus} />
            <PaymentStatusBadge status={booking.paymentStatus || 'unpaid'} />
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Layanan</span>
            <span className="font-bold text-slate-900">{booking.productTitle}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Jadwal Perjalanan</span>
            <span className="font-semibold text-slate-900">{formatDateID(booking.startDate)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pemesan</span>
            <span className="font-semibold text-slate-900">{booking.contact?.fullName}</span>
          </div>
          <div className="pt-3 border-t border-slate-200 flex justify-between items-center">
            <span className="font-bold text-slate-900">Total Pembayaran</span>
            <PriceDisplay amount={booking.totalAmount} size="lg" />
          </div>
        </div>

        {['confirmed', 'pending_payment'].includes(booking.bookingStatus) &&
          !['settlement', 'capture'].includes(booking.paymentStatus) && (
            <button
              type="button"
              onClick={() => navigate(`/checkout/${encodeURIComponent(booking.bookingReference)}`)}
              className="w-full h-12 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm"
            >
              Lanjutkan Pembayaran Midtrans
            </button>
          )}
      </div>
    </div>
  );
};

// ============================================================================
// 17. PAGE 16 — CUSTOMER ACCOUNT (/account)
// ============================================================================

const AccountPage = () => {
  const { user, authSession, updateAuthSession, services, addToast, navigate } = useApp();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'login') {
        const res = await services.customerService.signInWithSupabase(email, password);
        if (!res.access_token || !res.refresh_token || !res.user) {
          throw new ApiIntegrationError('AUTH_SESSION_MISSING', 'Supabase tidak mengembalikan sesi autentikasi yang lengkap.', 'auth.signIn');
        }
        updateAuthSession(res);
        addToast({ type: 'success', title: 'Berhasil Masuk', message: `Selamat datang kembali, ${email}` });
      } else {
        const res = await services.customerService.signUpWithSupabase(email, password, fullName, phone);
        if (res.access_token && res.refresh_token && res.user) updateAuthSession(res);
        addToast({
          type: 'success',
          title: 'Pendaftaran Berhasil',
          message: 'Akun pelanggan ASRIVA telah dibuat. Periksa email Anda jika verifikasi diperlukan.',
        });
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <span className="text-xs font-semibold text-teal-700 uppercase">Akun Pelanggan Terdaftar</span>
            <h1 className="text-xl font-bold text-slate-900 mt-1">
              {user.user_metadata?.full_name || user.email}
            </h1>
            <p className="text-sm text-slate-600">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await services.customerService.signOut(authSession?.access_token);
                updateAuthSession(null);
                addToast({ type: 'info', title: 'Keluar Akun', message: 'Sesi Supabase Auth telah diakhiri.' });
              } catch (err) {
                addToast({ type: 'error', title: 'Gagal Keluar', message: err.message || 'Sesi belum dapat diakhiri.' });
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" /> Keluar
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-slate-900 text-base">Riwayat Pemesanan & Invoice</h2>
            <p className="text-xs text-slate-500 mt-0.5">Kelola seluruh reservasi perjalanan Anda</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/my-bookings')}
            className="px-4 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold"
          >
            Buka Pesanan Saya
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {mode === 'login' ? 'Masuk ke Akun Pelanggan' : 'Daftar Akun ASRIVA'}
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Akun pelanggan bersifat opsional. Anda tetap dapat memesan layanan perjalanan sebagai tamu tanpa mendaftar.
          </p>
        </div>

        {error && <ErrorState error={error} />}

        <form onSubmit={handleAuth} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap *</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nomor WhatsApp *</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Alamat Email *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Kata Sandi *</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Memproses...' : mode === 'login' ? 'Masuk' : 'Daftar Sekarang'}
          </button>
        </form>

        <div className="pt-3 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            className="text-xs font-semibold text-teal-700 hover:underline"
          >
            {mode === 'login'
              ? 'Belum memiliki akun? Daftar sekarang'
              : 'Sudah memiliki akun? Masuk di sini'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 18. PAGES 17 & 18 — CONTACT & LEGAL INFORMATION
// (/contact, /about, /terms, /privacy, /booking-policy, /cancellation-policy, /refund-policy)
// ============================================================================

const ContactPage = () => {
  const { addToast } = useApp();
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });

  const handleSubmit = (e) => {
    e.preventDefault();
    addToast({
      type: 'info',
      title: 'Formulir Kontak Siap Dikirim',
      message: 'Hubungkan endpoint layanan pesan pelanggan ASRIVA untuk pengiriman otomatis, atau gunakan saluran resmi https://asricollection.online.',
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Hubungi ASRIVA An Tours</h1>
          <p className="text-sm text-slate-600 mt-1">
            Layanan bantuan pelanggan untuk informasi produk perjalanan, reservasi, dan verifikasi pembayaran.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs text-slate-500 block">Situs Web Resmi</span>
            <a
              href="https://asricollection.online"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-teal-700 hover:underline mt-0.5 inline-block"
            >
              https://asricollection.online
            </a>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs text-slate-500 block">Zona Waktu Operasional</span>
            <span className="font-semibold text-slate-900 mt-0.5 block">Asia/Jakarta (WIB)</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nama Lengkap *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Subjek *</label>
            <input
              type="text"
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="w-full h-11 px-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Pesan *</label>
            <textarea
              rows={4}
              required
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              className="w-full p-3 rounded-xl border border-slate-300 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-6 h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm"
          >
            Kirim Pesan
          </button>
        </form>
      </div>
    </div>
  );
};

const LegalInfoPage = ({ slug }) => {
  const { navigate } = useApp();

  const contentMap = {
    about: {
      title: 'Tentang ASRIVA An Tours',
      sections: [
        'ASRIVA An Tours (https://asricollection.online) adalah penyedia layanan perjalanan dan wisata yang mengelola secara langsung katalog paket tur, akomodasi hotel, tiket penerbangan, layanan transportasi, dan aktivitas wisata.',
        'Seluruh inventaris produk, jadwal perjalanan, harga resmi dalam mata uang Rupiah (IDR), serta konfirmasi reservasi dikelola langsung oleh tim operasional ASRIVA tanpa perantara pihak ketiga yang tidak terverifikasi.',
      ],
    },
    terms: {
      title: 'Syarat & Ketentuan Layanan',
      sections: [
        '1. Pemesanan layanan perjalanan melalui platform ASRIVA An Tours tunduk pada ketersediaan kapasitas aktual yang tervalidasi pada sistem saat transaksi berlangsung.',
        '2. Pelanggan bertanggung jawab memastikan keakuratan data identitas, jadwal keberangkatan, dan kontak aktif (email serta WhatsApp) pada saat pengisian formulir pemesanan.',
        '3. Dokumen legalitas badan usaha, nomor registrasi resmi, dan alamat operasional lengkap mengacu pada dokumen resmi perusahaan ASRIVA An Tours.',
      ],
    },
    privacy: {
      title: 'Kebijakan Privasi Pelanggan',
      sections: [
        '1. ASRIVA An Tours mengumpulkan data pribadi pelanggan (nama lengkap, email, nomor telepon/WhatsApp, serta data identitas peserta bila diwajibkan oleh produk perjalanan) semata-mata untuk keperluan pemrosesan reservasi, penerbitan tiket/voucher, dan verifikasi pembayaran.',
        '2. Informasi pembayaran diproses secara aman melalui gateway pembayaran resmi Midtrans. ASRIVA tidak menyimpan data sensitif kartu pembayaran pelanggan pada server aplikasi.',
      ],
    },
    'booking-policy': {
      title: 'Kebijakan Pemesanan (Booking Policy)',
      sections: [
        '1. Model Pemesanan: Pemesanan dilakukan secara instan setelah validasi ketersediaan dan perhitungan tarif resmi oleh server ASRIVA.',
        '2. Pembayaran hanya dapat dilakukan setelah reservasi berstatus Terkonfirmasi (Confirmed) dan wajib diselesaikan sebelum batas waktu pembayaran berakhir.',
      ],
    },
    'cancellation-policy': {
      title: 'Kebijakan Pembatalan (Cancellation Policy)',
      sections: [
        '1. Permohonan pembatalan reservasi yang telah terkonfirmasi atau lunas mengikuti ketentuan spesifik masing-masing produk perjalanan (Paket Tur, Hotel, Penerbangan, Transportasi, atau Aktivitas) yang tercantum pada halaman detail produk.',
        '2. Pesanan yang melewati batas waktu pembayaran akan otomatis berubah status menjadi Kedaluwarsa (Expired).',
      ],
    },
    'refund-policy': {
      title: 'Kebijakan Pengembalian Dana (Refund Policy)',
      sections: [
        '1. Pengembalian dana hanya berlaku untuk transaksi dengan status pembayaran terverifikasi (Settlement/Capture) yang memenuhi syarat pembatalan produk terkait.',
        '2. Proses pengembalian dana dicatat secara terpisah pada status pembayaran (Refund Pending hingga Refunded) dan dikembalikan melalui metode pembayaran yang terverifikasi.',
      ],
    },
  };

  const doc = contentMap[slug] || contentMap.about;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'about', label: 'Tentang Kami' },
          { key: 'terms', label: 'Syarat & Ketentuan' },
          { key: 'privacy', label: 'Privasi' },
          { key: 'booking-policy', label: 'Kebijakan Pemesanan' },
          { key: 'cancellation-policy', label: 'Pembatalan' },
          { key: 'refund-policy', label: 'Pengembalian Dana' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => navigate(`/${item.key}`)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
              slug === item.key
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
        {doc.sections.map((paragraph, index) => (
          <p key={index} className="text-sm text-slate-700 leading-relaxed">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// 19. APP SHELL (Header, Desktop Nav, Mobile Bottom Nav, Footer)
// ============================================================================

const AppShell = ({ children }) => {
  const { currentPath, navigate, user, openIntegrationModal, runtimeConfig } = useApp();
  const isBackendConfigured = Boolean(runtimeConfig.supabaseUrl && runtimeConfig.supabaseAnonKey);

  const primaryNav = [
    { path: '/', label: 'Beranda', icon: Compass },
    { path: '/explore', label: 'Jelajahi', icon: Search },
    { path: '/my-bookings', label: 'Pesanan Saya', icon: Calendar },
    { path: '/account', label: user ? 'Akun' : 'Masuk', icon: User },
  ];

  const isNavActive = (path) => {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 pb-16 md:pb-0">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-left focus:outline-none"
          >
            <AsrivaBrandMark />
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(item.path);
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-colors ${
                    active
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Backend Contract Status Pill */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openIntegrationModal}
              title="Konfigurasi Kontrak Supabase & Midtrans"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                isBackendConfigured
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span className="hidden sm:inline">
                {isBackendConfigured ? 'Backend Terhubung' : 'Koneksi API'}
              </span>
              <Server className="w-3.5 h-3.5 sm:hidden" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-5 space-y-3">
              <AsrivaBrandMark />
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-sm">
                Platform resmi pemesanan perjalanan ASRIVA An Tours. Seluruh produk, jadwal, dan harga dikelola langsung untuk kenyamanan perjalanan Anda.
              </p>
              <p className="text-xs text-slate-500">
                Mata Uang: IDR (Rupiah) • Zona Waktu: Asia/Jakarta
              </p>
            </div>

            <div className="md:col-span-3 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Kategori Layanan
              </h3>
              <ul className="space-y-2 text-sm text-slate-600">
                {CATEGORIES.map((cat) => (
                  <li key={cat.id}>
                    <button
                      type="button"
                      onClick={() => navigate(cat.route)}
                      className="hover:text-teal-700 transition-colors"
                    >
                      {cat.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-4 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Informasi & Kebijakan
              </h3>
              <ul className="space-y-2 text-sm text-slate-600">
                <li>
                  <button type="button" onClick={() => navigate('/about')} className="hover:text-teal-700">
                    Tentang ASRIVA An Tours
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => navigate('/contact')} className="hover:text-teal-700">
                    Hubungi Kami
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => navigate('/terms')} className="hover:text-teal-700">
                    Syarat & Ketentuan
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => navigate('/privacy')} className="hover:text-teal-700">
                    Kebijakan Privasi
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => navigate('/booking-policy')} className="hover:text-teal-700">
                    Kebijakan Pemesanan & Pembatalan
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => navigate('/refund-policy')} className="hover:text-teal-700">
                    Kebijakan Pengembalian Dana
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 mt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <p>© {new Date().getFullYear()} ASRIVA An Tours (asricollection.online). Hak Cipta Dilindungi.</p>
            <p>Pembayaran Aman didukung oleh Midtrans</p>
          </div>
        </div>
      </footer>

      {/* Mobile-First Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 h-16 grid grid-cols-4 px-1">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(item.path);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                active ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

// ============================================================================
// 20. MAIN APPLICATION ENTRY & ROUTER CONTROLLER
// ============================================================================

export default function App() {
  // SPA Route Management (Hash/State synchronized for safe iframe & standalone execution)
  const [routeState, setRouteState] = useState(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash) {
      const [p, s] = hash.split('?');
      return { path: p || '/', search: s ? `?${s}` : '' };
    }
    return { path: '/', search: '' };
  });

  const navigate = useCallback((to) => {
    const [p, s] = to.split('?');
    const nextPath = p || '/';
    const nextSearch = s ? `?${s}` : '';
    window.location.hash = `${nextPath}${nextSearch}`;
    setRouteState({ path: nextPath, search: nextSearch });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      const [p, s] = hash.split('?');
      setRouteState({ path: p || '/', search: s ? `?${s}` : '' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  // Runtime Integration Config (Reads global runtime env if present, zero hardcoded secrets)
  const [runtimeConfig, setRuntimeConfig] = useState(() => {
    const globalObj = typeof window !== 'undefined' ? window : {};
    const env = globalObj.__ASRIVA_ENV__ || (typeof process !== 'undefined' && process.env ? process.env : {});
    return {
      supabaseUrl: env.VITE_SUPABASE_URL || '',
      supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
      midtransEnvironment: env.VITE_MIDTRANS_ENV || 'SANDBOX',
      midtransClientKey: env.VITE_MIDTRANS_CLIENT_KEY || '',
      midtransMethod: env.VITE_MIDTRANS_METHOD || 'UNCONFIGURED',
      endpoints: {
        'products.list': env.VITE_EDGE_PRODUCTS_LIST || '',
        'products.detail': env.VITE_EDGE_PRODUCT_DETAIL || '',
        'availability.validate': env.VITE_EDGE_VALIDATE_AVAILABILITY || '',
        'bookings.create': env.VITE_EDGE_CREATE_BOOKING || '',
        'bookings.lookup': env.VITE_EDGE_GET_BOOKING || '',
        'payments.initiate': env.VITE_EDGE_INITIATE_PAYMENT || '',
        'payments.verifyStatus': env.VITE_EDGE_VERIFY_PAYMENT || '',
      },
    };
  });

  const authStorageKey = getSupabaseAuthStorageKey(runtimeConfig.supabaseUrl);
  const [authSession, setAuthSession] = useState(() => readStoredAuthSession(authStorageKey));
  const [auditLogs, setAuditLogs] = useState([]);
  const addAuditLog = useCallback((entry) => {
    setAuditLogs((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  const services = useMemo(
    () => createAsrivaServices(runtimeConfig, addAuditLog, authSession),
    [runtimeConfig, addAuditLog, authSession]
  );

   // Application State
  const [user, setUser] = useState(() => authSession?.user ?? null);
  const updateAuthSession = useCallback((session) => {
    if (authStorageKey && typeof window !== 'undefined') {
      try {
        if (session?.access_token && session?.refresh_token) {
          const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
          const normalized = { ...session, expires_at: expiresAt };
          window.localStorage.setItem(authStorageKey, JSON.stringify(normalized));
          setAuthSession(normalized);
          setUser(normalized.user ?? null);
          return;
        }
        window.localStorage.removeItem(authStorageKey);
      } catch (error) {
        console.warn('[ASRIVA_AUTH_STORAGE]', error);
      }
    }
    setAuthSession(null);
    setUser(null);
  }, [authStorageKey]);

  useEffect(() => {
    if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey || !authStorageKey) return;
    let active = true;
    const restoreSession = async () => {
      const stored = readStoredAuthSession(authStorageKey);
      if (!stored?.refresh_token) {
        if (active) updateAuthSession(null);
        return;
      }
      try {
        let session = stored;
        const expiresAt = Number(session.expires_at || 0);
        if (!session.access_token || expiresAt * 1000 <= Date.now() + 60000) {
          session = await services.customerService.refreshSession(session.refresh_token);
        }
        const verifiedUser = await services.customerService.getUser(session.access_token);
        const normalized = {
          ...session,
          user: verifiedUser,
          expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
        };
        if (active) updateAuthSession(normalized);
      } catch (error) {
        if (active) updateAuthSession(null);
      }
    };
    restoreSession();
    return () => { active = false; };
  }, [runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey]);

  const [bookingDraft, setBookingDraft] = useState(null);
  const [activeBookings, setActiveBookings] = useState({});
  const [integrationModalOpen, setIntegrationModalOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((toast) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const saveBookingRecord = useCallback((booking, accessToken = null, accessExpiresAt = null) => {
    if (!booking?.bookingReference) return;
    const token = accessToken || booking.bookingAccessToken || readBookingAccessToken(booking.bookingReference);
    if (token && typeof window !== 'undefined') {
      try {
        const expiry = accessExpiresAt ? new Date(accessExpiresAt).getTime() : Date.now() + 86400000;
        window.sessionStorage.setItem(bookingAccessStorageKey(booking.bookingReference), JSON.stringify({
          token,
          expiresAt: expiry,
        }));
      } catch (error) {
        console.warn('[ASRIVA_BOOKING_ACCESS_STORAGE]', error);
      }
    }
    const bookingWithAccess = token ? { ...booking, bookingAccessToken: token } : booking;
    setActiveBookings((prev) => ({
      ...prev,
      [booking.bookingReference]: bookingWithAccess,
    }));
  }, []);

  // Route Dispatcher covering all 18 required application pages
  const renderCurrentPage = () => {
    const p = routeState.path;

    if (p === '/' || p === '') return <HomePage />;
    if (p === '/explore') {
      return (
        <ProductListingPage
          pageTitle="Jelajahi Semua Layanan Perjalanan"
          pageSubtitle="Temukan paket tur, hotel, penerbangan, transportasi, dan aktivitas wisata resmi ASRIVA An Tours."
        />
      );
    }
    if (p === '/tours') {
      return (
        <ProductListingPage
          fixedCategory="tour_packages"
          pageTitle="Paket Tur ASRIVA"
          pageSubtitle="Rencana perjalanan terorganisir dengan jadwal keberangkatan dan fasilitas terkurasi."
        />
      );
    }
    if (p === '/hotels') {
      return (
        <ProductListingPage
          fixedCategory="hotels"
          pageTitle="Hotel & Akomodasi"
          pageSubtitle="Pilihan akomodasi terverifikasi dengan ketersediaan kamar dan tarif transparan per malam."
        />
      );
    }
    if (p === '/flights') {
      return (
        <ProductListingPage
          fixedCategory="flights"
          pageTitle="Layanan Penerbangan"
          pageSubtitle="Produk layanan penerbangan resmi yang disediakan oleh ASRIVA An Tours."
        />
      );
    }
    if (p === '/transport') {
      return (
        <ProductListingPage
          fixedCategory="transportation"
          pageTitle="Transportasi & Antar-Jemput"
          pageSubtitle="Layanan sewa kendaraan, antar-jemput bandara, dan transportasi perjalanan."
        />
      );
    }
    if (p === '/activities') {
      return (
        <ProductListingPage
          fixedCategory="activities"
          pageTitle="Aktivitas & Wisata"
          pageSubtitle="Tiket atraksi dan pengalaman wisata lokal pilihan ASRIVA."
        />
      );
    }

    if (p.startsWith('/product/')) {
      const id = decodeURIComponent(p.replace('/product/', ''));
      return <ProductDetailPage productId={id} />;
    }

    if (p === '/booking/information') return <BookingInformationPage />;
    if (p === '/booking/review') return <BookingReviewPage />;

    if (p.startsWith('/booking/confirmation/')) {
      const ref = decodeURIComponent(p.replace('/booking/confirmation/', ''));
      return <BookingConfirmationPage bookingRef={ref} />;
    }

    if (p.startsWith('/checkout/')) {
      const ref = decodeURIComponent(p.replace('/checkout/', ''));
      return <CheckoutPage bookingRef={ref} />;
    }

    if (
      p === '/payment/success' ||
      p === '/payment/pending' ||
      p === '/payment/failed' ||
      p === '/payment/expired'
    ) {
      return <PaymentResultPage routeSegment={p} />;
    }

    if (p === '/my-bookings') return <MyBookingsPage />;
    if (p.startsWith('/my-bookings/')) {
      const ref = decodeURIComponent(p.replace('/my-bookings/', ''));
      return <BookingDetailPage bookingRef={ref} />;
    }

    if (p === '/account') return <AccountPage />;
    if (p === '/contact') return <ContactPage />;

    if (
      ['/about', '/terms', '/privacy', '/booking-policy', '/cancellation-policy', '/refund-policy'].includes(p)
    ) {
      return <LegalInfoPage slug={p.replace('/', '')} />;
    }

    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={Compass}
          title="Halaman Tidak Ditemukan (404)"
          description={`Rute "${p}" tidak tersedia pada storefront ASRIVA An Tours.`}
          actionLabel="Kembali ke Beranda"
          onAction={() => navigate('/')}
        />
      </div>
    );
  };

  const contextValue = {
    currentPath: routeState.path,
    currentSearch: routeState.search,
    navigate,
    runtimeConfig,
    updateRuntimeConfig: setRuntimeConfig,
    services,
    auditLogs,
    user,
    setUser,
    authSession,
    updateAuthSession,
    bookingDraft,
    setBookingDraft,
    activeBookings,
    saveBookingRecord,
    openIntegrationModal: () => setIntegrationModalOpen(true),
    addToast,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <AppShell>{renderCurrentPage()}</AppShell>
      <BackendIntegrationModal
        open={integrationModalOpen}
        onClose={() => setIntegrationModalOpen(false)}
      />
      <ToastNotification toasts={toasts} removeToast={removeToast} />
    </AppContext.Provider>
  );
}
