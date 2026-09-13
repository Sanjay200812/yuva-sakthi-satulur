import React, { useState, useEffect } from 'react';
import {
  Download,
  Search,
  RefreshCw,
  LogOut,
  FileSpreadsheet,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  Clock,
  Ticket,
  Users,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Smartphone,
  Info,
  X,
  Check,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';

interface AdminDashboardProps {
  adminUser: any;
  onLogout: () => void;
  onBackToSite: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ adminUser, onLogout, onBackToSite }) => {
  const [activeTab, setActiveTab] = useState<'applied_coupons' | 'payment_reviews'>('applied_coupons');
  const [metrics, setMetrics] = useState<any>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewFilter, setReviewFilter] = useState<string>('awaiting_admin_review');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  // Screenshot preview modal
  const [screenshotModal, setScreenshotModal] = useState<{ open: boolean; submissionId: string | null }>({
    open: false,
    submissionId: null,
  });

  // Confirm from Bank Record Modal
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    submission: any | null;
    bankTxnId: string;
    receivedAmountInr: string;
    recipientAccount: string;
    matchNote: string;
    auditNote: string;
    attested: boolean;
    isSubmitting: boolean;
    error: string | null;
  }>({
    open: false,
    submission: null,
    bankTxnId: '',
    receivedAmountInr: '',
    recipientAccount: '',
    matchNote: '',
    auditNote: '',
    attested: false,
    isSubmitting: false,
    error: null,
  });

  // Reject Modal
  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    submission: any | null;
    reviewNote: string;
    isSubmitting: boolean;
    error: string | null;
  }>({
    open: false,
    submission: null,
    reviewNote: '',
    isSubmitting: false,
    error: null,
  });

  // Resubmission Modal
  const [resubmitModal, setResubmitModal] = useState<{
    open: boolean;
    submission: any | null;
    guidanceNote: string;
    isSubmitting: boolean;
    error: string | null;
  }>({
    open: false,
    submission: null,
    guidanceNote: '',
    isSubmitting: false,
    error: null,
  });

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/admin/dashboard');
      const json = await res.json();
      if (json.success) setMetrics(json.data);
    } catch (err) {
      console.error('Error fetching metrics', err);
    }
  };

  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        search: searchTerm,
        page: String(page),
        limit: '20',
      });
      const res = await fetch(`/api/admin/coupons?${query.toString()}`);
      const json = await res.json();
      if (json.success) {
        setCoupons(json.data.coupons || []);
        setPagination(json.data.pagination);
      }
    } catch (err) {
      console.error('Error fetching coupons', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReviews = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (reviewFilter && reviewFilter !== 'all') {
        query.append('status', reviewFilter);
      }
      if (searchTerm) {
        query.append('search', searchTerm);
      }
      const res = await fetch(`/api/admin/payment-reviews?${query.toString()}`);
      const json = await res.json();
      if (json.success) {
        setReviews(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching payment reviews', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (activeTab === 'applied_coupons') {
      fetchCoupons();
    } else {
      fetchReviews();
    }
  }, [activeTab, page, reviewFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    if (activeTab === 'applied_coupons') {
      fetchCoupons();
    } else {
      fetchReviews();
    }
  };

  const handleExportCsv = () => {
    window.location.href = '/api/admin/coupons/export.csv';
  };

  // Open Confirm Modal with defaults
  const openConfirmModal = (sub: any) => {
    setConfirmModal({
      open: true,
      submission: sub,
      bankTxnId: sub.utrMasked?.replace('UTR-', '') || '',
      receivedAmountInr: String(sub.amountInr || 50),
      recipientAccount: sub.expectedPayeeUpiId || '9574876369@ybl',
      matchNote: `Matched in official merchant UPI / bank statement (UTR: ${sub.payerUtr || sub.utrMasked})`,
      auditNote: `Verified by ${adminUser?.email || 'admin'} against live bank credit record.`,
      attested: false,
      isSubmitting: false,
      error: null,
    });
  };

  // Execute Bank Confirmation
  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmModal.submission || !confirmModal.attested) return;

    setConfirmModal((prev) => ({ ...prev, isSubmitting: true, error: null }));
    try {
      const res = await fetch(`/api/admin/payment-reviews/${confirmModal.submission.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankTxnId: confirmModal.bankTxnId.trim() || 'BANK-MATCH',
          receivedAmountPaise: Math.round(parseFloat(confirmModal.receivedAmountInr) * 100),
          recipientAccount: confirmModal.recipientAccount.trim(),
          matchNote: confirmModal.matchNote.trim(),
          auditNote: confirmModal.auditNote.trim(),
          idempotencyKey: `adm_rec_${confirmModal.submission.id}_${Date.now()}`,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to confirm payment from bank record.');
      }

      setConfirmModal({
        open: false,
        submission: null,
        bankTxnId: '',
        receivedAmountInr: '',
        recipientAccount: '',
        matchNote: '',
        auditNote: '',
        attested: false,
        isSubmitting: false,
        error: null,
      });

      fetchMetrics();
      fetchReviews();
      fetchCoupons();
    } catch (err: any) {
      setConfirmModal((prev) => ({ ...prev, isSubmitting: false, error: err.message }));
    }
  };

  // Open Reject Modal
  const openRejectModal = (sub: any) => {
    setRejectModal({
      open: true,
      submission: sub,
      reviewNote: 'Payment record not found in bank or merchant account.',
      isSubmitting: false,
      error: null,
    });
  };

  // Execute Rejection
  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModal.submission) return;

    setRejectModal((prev) => ({ ...prev, isSubmitting: true, error: null }));
    try {
      const res = await fetch(`/api/admin/payment-reviews/${rejectModal.submission.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewNote: rejectModal.reviewNote.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to reject payment.');
      }

      setRejectModal({ open: false, submission: null, reviewNote: '', isSubmitting: false, error: null });
      fetchMetrics();
      fetchReviews();
    } catch (err: any) {
      setRejectModal((prev) => ({ ...prev, isSubmitting: false, error: err.message }));
    }
  };

  // Open Resubmit Modal
  const openResubmitModal = (sub: any) => {
    setResubmitModal({
      open: true,
      submission: sub,
      guidanceNote: 'The submitted screenshot was incomplete or unclear. Please upload a full screenshot showing the UTR and successful status.',
      isSubmitting: false,
      error: null,
    });
  };

  // Execute Request Resubmission
  const handleResubmitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resubmitModal.submission) return;

    setResubmitModal((prev) => ({ ...prev, isSubmitting: true, error: null }));
    try {
      const res = await fetch(`/api/admin/payment-reviews/${resubmitModal.submission.id}/request-resubmission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guidanceNote: resubmitModal.guidanceNote.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to request resubmission.');
      }

      setResubmitModal({ open: false, submission: null, guidanceNote: '', isSubmitting: false, error: null });
      fetchMetrics();
      fetchReviews();
    } catch (err: any) {
      setResubmitModal((prev) => ({ ...prev, isSubmitting: false, error: err.message }));
    }
  };

  const pendingReviewsCount = reviews.filter((r) => r.status === 'awaiting_admin_review').length;

  return (
    <div className="min-h-screen bg-[#070B19] text-slate-100 font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-[#0A0E24]/90 backdrop-blur-md border-b border-amber-400/20 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 to-yellow-600 p-[1px] shadow-sm">
            <div className="w-full h-full bg-[#070B19] rounded-[10px] overflow-hidden flex items-center justify-center">
              <img src="/logo.jpeg" alt="Yuva Shakti" className="w-full h-full object-cover" />
            </div>
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-black text-white font-display">
              YUVA SHAKTI YOUTH <span className="text-amber-400">ADMIN</span>
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">Satulur Lucky Draw 2026 • Bank Reconciliation &amp; Registry</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-block text-xs font-mono text-purple-300">
            {adminUser?.email}
          </span>

          <button
            onClick={onBackToSite}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition cursor-pointer flex items-center gap-1.5"
          >
            <span>Live Site</span>
            <ExternalLink className="w-3 h-3" />
          </button>

          <button
            onClick={onLogout}
            className="px-3 py-1.5 rounded-lg bg-red-950/60 border border-red-500/30 hover:bg-red-900/60 text-xs font-semibold text-red-300 transition cursor-pointer flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8 space-y-6">
        {/* KPI Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Confirmed Bank Revenue</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-display">
              ₹{(metrics?.totalRevenueInr || 0).toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 font-medium">
              <ShieldCheck className="w-3 h-3" />
              <span>Admin Bank Reconciled</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Valid Coupons Issued</span>
              <Ticket className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-400 font-display">
              {metrics?.validCouponsCount || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              Today: +{metrics?.couponsToday || 0}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Confirmed Bookings</span>
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-display">
              {metrics?.confirmedBookingsCount || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              Today: +{metrics?.bookingsToday || 0}
            </div>
          </div>

          <div
            onClick={() => {
              setActiveTab('payment_reviews');
              setReviewFilter('awaiting_admin_review');
            }}
            className="p-4 rounded-2xl bg-[#0D132D] border border-amber-500/30 hover:border-amber-400 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Awaiting Bank Confirmation</span>
              <Clock className="w-4 h-4 text-amber-400 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-300 font-display">
              {metrics?.failedOrPendingAttempts || pendingReviewsCount || 0}
            </div>
            <div className="text-[10px] text-amber-400 mt-1 font-semibold flex items-center gap-1">
              <span>Click to Reconcile Queue</span>
              <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('applied_coupons');
                setPage(1);
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'applied_coupons'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <Ticket className="w-4 h-4" />
              <span>Applied Coupons ({metrics?.validCouponsCount || 0})</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('payment_reviews');
                setPage(1);
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'payment_reviews'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-amber-300" />
              <span>Payment Reviews &amp; Bank Reconciliation</span>
              {pendingReviewsCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-400 text-slate-950 font-black">
                  {pendingReviewsCount}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'applied_coupons' && (
            <button
              onClick={handleExportCsv}
              className="px-3.5 py-2 rounded-xl font-bold text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-500/40 hover:bg-emerald-900/50 transition cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          )}
        </div>

        {/* 1. Applied Coupons View (STRICTLY Confirmed by Bank Record ONLY) */}
        {activeTab === 'applied_coupons' && (
          <div className="space-y-4">
            {/* Search Bar */}
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by Coupon #, Name, Mobile, Village, or Booking Ref..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#0D132D] border border-purple-500/30 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:border-amber-400 transition"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs sm:text-sm transition cursor-pointer"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setPage(1);
                  fetchCoupons();
                }}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </form>

            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>
                <strong>Verified Coupons Registry:</strong> Showing ONLY applications whose payment proof passed automated consistency checks and has been confirmed against the organizer's actual bank/merchant UPI transaction record by an authorized admin. No dummy data, pending submissions, or unconfirmed records are shown here.
              </span>
            </div>

            {/* Coupons Table */}
            <div className="bg-[#0D132D] border border-purple-500/20 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-purple-500/20 bg-slate-950/60 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="p-3 sm:p-4">Coupon #</th>
                      <th className="p-3 sm:p-4">Applicant</th>
                      <th className="p-3 sm:p-4">Mobile</th>
                      <th className="p-3 sm:p-4">Village</th>
                      <th className="p-3 sm:p-4">Booking Ref</th>
                      <th className="p-3 sm:p-4">Index</th>
                      <th className="p-3 sm:p-4">Amount</th>
                      <th className="p-3 sm:p-4">Confirmed Date</th>
                      <th className="p-3 sm:p-4 text-right">Download Pass</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-500/10">
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
                          Loading confirmed coupons...
                        </td>
                      </tr>
                    ) : coupons.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-12 text-center text-slate-400">
                          <Ticket className="w-8 h-8 mx-auto mb-2 opacity-30 text-amber-400" />
                          <p className="font-semibold text-white">No confirmed coupons found</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Coupons appear here only after explicit admin confirmation against the real merchant bank/UPI record.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      coupons.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-900/60 transition">
                          <td className="p-3 sm:p-4 font-mono font-bold text-amber-400">
                            {c.coupon_number}
                          </td>
                          <td className="p-3 sm:p-4 font-semibold text-white">
                            {c.holder_name}
                          </td>
                          <td className="p-3 sm:p-4 font-mono text-slate-300">
                            {c.maskedPhone}
                          </td>
                          <td className="p-3 sm:p-4 text-slate-300">
                            {c.village}
                          </td>
                          <td className="p-3 sm:p-4 font-mono text-purple-300">
                            {c.booking_public_id}
                          </td>
                          <td className="p-3 sm:p-4 text-slate-400 font-mono">
                            {c.ticket_index} of {c.total_quantity}
                          </td>
                          <td className="p-3 sm:p-4 font-bold text-emerald-400">
                            ₹{c.amountInr}
                          </td>
                          <td className="p-3 sm:p-4 text-slate-400 text-[11px]">
                            {c.formattedPaidAt}
                          </td>
                          <td className="p-3 sm:p-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <a
                                href={`/api/admin/coupons/${c.coupon_number}/download?format=pdf`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30 hover:bg-amber-500/30 text-[10px] font-bold transition cursor-pointer"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download PDF"
                              >
                                <FileText className="w-3 h-3" />
                                <span>PDF</span>
                              </a>
                              <a
                                href={`/api/admin/coupons/${c.coupon_number}/download?format=png`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-[10px] font-bold transition cursor-pointer"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download PNG"
                              >
                                <ImageIcon className="w-3 h-3" />
                                <span>PNG</span>
                              </a>
                              <a
                                href={`/api/admin/coupons/${c.coupon_number}/download?format=jpeg`}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-[10px] font-bold transition cursor-pointer"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download JPG"
                              >
                                <ImageIcon className="w-3 h-3" />
                                <span>JPG</span>
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="p-4 border-t border-purple-500/20 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Showing {coupons.length} of {pagination.total} verified coupons
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-mono">
                      {page} / {pagination.totalPages}
                    </span>
                    <button
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Payment Reviews & Bank Reconciliation Screen */}
        {activeTab === 'payment_reviews' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 space-y-1">
                <p className="font-bold text-white">Payment Reviews &amp; Bank Reconciliation Queue</p>
                <p>
                  Every proof submission passes Gemini OCR text extraction and automated deterministic checks. Final coupon allocation is strictly gated until an authorized admin verifies the matching credit in the organizer's actual bank or merchant UPI statement and confirms it below.
                </p>
              </div>
            </div>

            {/* Filter Tabs & Search */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'awaiting_admin_review', label: 'Awaiting Bank Review' },
                  { key: 'all', label: 'All Submissions' },
                  { key: 'ai_check_failed', label: 'AI Check Failed' },
                  { key: 'admin_confirmed', label: 'Bank Confirmed' },
                  { key: 'admin_rejected', label: 'Rejected' },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setReviewFilter(f.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      reviewFilter === f.key
                        ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => fetchReviews()}
                className="self-end sm:self-auto p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Refresh</span>
              </button>
            </div>

            {/* Reviews List */}
            <div className="bg-[#0D132D] border border-purple-500/20 rounded-2xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-purple-500/20 bg-slate-950/60 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="p-3 sm:p-4">Submission &amp; Time</th>
                      <th className="p-3 sm:p-4">Applicant</th>
                      <th className="p-3 sm:p-4">Expected ₹ / App</th>
                      <th className="p-3 sm:p-4">Payer UTR</th>
                      <th className="p-3 sm:p-4">Gemini OCR &amp; Signals</th>
                      <th className="p-3 sm:p-4">Review Status</th>
                      <th className="p-3 sm:p-4 text-right">Bank Reconciliation Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-purple-500/10">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
                          Loading submissions for review...
                        </td>
                      </tr>
                    ) : reviews.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-12 text-center text-slate-400">
                          <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-30 text-emerald-400" />
                          <p className="font-semibold text-white">No submissions found in this filter</p>
                          <p className="text-xs text-slate-500 mt-1">
                            Pending proof submissions awaiting bank verification will appear here.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      reviews.map((r) => {
                        const isAwaiting = r.status === 'awaiting_admin_review';
                        const isConfirmed = r.status === 'admin_confirmed';
                        const isFailed = r.status === 'ai_check_failed';
                        const isRejected = r.status === 'admin_rejected';

                        return (
                          <tr key={r.id} className="hover:bg-slate-900/60 transition">
                            <td className="p-3 sm:p-4">
                              <div className="font-mono text-purple-300 font-bold">{r.bookingPublicId}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">{r.submittedAt}</div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5">Ref: {r.paymentReference}</div>
                            </td>

                            <td className="p-3 sm:p-4">
                              <div className="font-bold text-white">{r.participantName}</div>
                              <div className="text-slate-400 text-[11px] font-mono">{r.phone}</div>
                              <div className="text-slate-500 text-[11px]">{r.village}</div>
                            </td>

                            <td className="p-3 sm:p-4">
                              <div className="font-bold text-emerald-400 font-display text-sm">₹{r.amountInr}</div>
                              <div className="text-slate-400 text-[11px]">{r.quantity} Coupon{r.quantity > 1 ? 's' : ''}</div>
                              <div className="inline-flex items-center gap-1 mt-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                                <Smartphone className="w-2.5 h-2.5" />
                                <span>{r.selectedApp}</span>
                              </div>
                            </td>

                            <td className="p-3 sm:p-4 font-mono">
                              <span className="font-bold text-amber-300 bg-slate-900 px-2 py-1 rounded border border-purple-500/20 inline-block text-[11px]">
                                {r.utrMasked}
                              </span>
                              {r.hasScreenshot && (
                                <button
                                  type="button"
                                  onClick={() => setScreenshotModal({ open: true, submissionId: r.id })}
                                  className="mt-1.5 flex items-center gap-1 text-[10px] text-purple-300 hover:text-amber-300 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>View Screenshot</span>
                                </button>
                              )}
                            </td>

                            <td className="p-3 sm:p-4 max-w-xs">
                              {r.geminiExtraction ? (
                                <div className="space-y-1 text-[11px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400">OCR Amount:</span>
                                    <span className="font-mono text-white font-bold">{r.geminiExtraction.amount || 'N/A'}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400">OCR UTR:</span>
                                    <span className="font-mono text-white">{r.geminiExtraction.utr_or_rrn || 'N/A'}</span>
                                  </div>
                                  {r.reasonCodes && r.reasonCodes.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {r.reasonCodes.map((code: string) => (
                                        <span key={code} className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-500/30 text-[9px] font-mono">
                                          {code}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-500 italic">No OCR extraction recorded</span>
                              )}
                            </td>

                            <td className="p-3 sm:p-4">
                              <span
                                className={`px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold border inline-block ${
                                  isConfirmed
                                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                                    : isAwaiting
                                    ? 'bg-amber-950/80 text-amber-300 border-amber-500/40 animate-pulse'
                                    : isFailed
                                    ? 'bg-rose-950/80 text-rose-400 border-rose-500/40'
                                    : isRejected
                                    ? 'bg-slate-900 text-slate-400 border-slate-700'
                                    : 'bg-purple-950 text-purple-300 border-purple-500/30'
                                }`}
                              >
                                {r.status.replace(/_/g, ' ')}
                              </span>
                              {r.reviewedAt && (
                                <div className="text-[10px] text-slate-500 mt-1">
                                  {r.reviewedAt}
                                </div>
                              )}
                            </td>

                            <td className="p-3 sm:p-4 text-right">
                              {isConfirmed ? (
                                <div className="text-right">
                                  <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-[11px]">
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>Bank Confirmed</span>
                                  </span>
                                  {r.bankRecordMatch?.bankTxnId && (
                                    <div className="text-[10px] text-slate-400 font-mono">
                                      Txn: {r.bankRecordMatch.bankTxnId}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openConfirmModal(r)}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1 shadow"
                                    title="Confirm against official bank/merchant record"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Confirm Bank</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openRejectModal(r)}
                                    className="px-2 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-500/30 font-semibold text-xs transition cursor-pointer"
                                    title="Reject invalid submission"
                                  >
                                    Reject
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openResubmitModal(r)}
                                    className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition cursor-pointer"
                                    title="Request customer to resubmit screenshot"
                                  >
                                    Resubmit
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 1. Modal: Confirm from Bank Record */}
      {confirmModal.open && confirmModal.submission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-lg w-full bg-[#0D132D] border border-emerald-500/40 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
                <ShieldCheck className="w-5 h-5" />
                <span>Confirm Payment from Bank Record</span>
              </div>
              <button
                onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/20 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Booking Reference:</span>
                <span className="font-mono text-white font-bold">{confirmModal.submission.bookingPublicId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Applicant:</span>
                <span className="text-white font-semibold">{confirmModal.submission.participantName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Expected Total:</span>
                <span className="text-emerald-400 font-bold">₹{confirmModal.submission.amountInr} ({confirmModal.submission.quantity} Coupons)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Selected UPI App:</span>
                <span className="text-purple-300 font-mono">{confirmModal.submission.selectedApp}</span>
              </div>
            </div>

            <form onSubmit={handleConfirmSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Bank / UPI Transaction Reference (From Organizer Bank Statement) <span className="text-emerald-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={confirmModal.bankTxnId}
                  onChange={(e) => setConfirmModal((prev) => ({ ...prev, bankTxnId: e.target.value }))}
                  placeholder="e.g. 425612345678 or BANK-REF-987654"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white font-mono focus:border-emerald-400 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Received Amount (₹) <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={confirmModal.receivedAmountInr}
                    onChange={(e) => setConfirmModal((prev) => ({ ...prev, receivedAmountInr: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white font-mono focus:border-emerald-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Credited Account / UPI ID <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={confirmModal.recipientAccount}
                    onChange={(e) => setConfirmModal((prev) => ({ ...prev, recipientAccount: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white font-mono focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Admin Reconciliation Audit Note
                </label>
                <input
                  type="text"
                  value={confirmModal.auditNote}
                  onChange={(e) => setConfirmModal((prev) => ({ ...prev, auditNote: e.target.value }))}
                  placeholder="e.g. Verified credit in HDFC merchant portal."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white focus:border-emerald-400 focus:outline-none"
                />
              </div>

              {/* Mandatory Admin Attestation Checkbox */}
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="attestCheck"
                  checked={confirmModal.attested}
                  onChange={(e) => setConfirmModal((prev) => ({ ...prev, attested: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 rounded border-emerald-400 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="attestCheck" className="text-[11px] text-emerald-200 leading-snug cursor-pointer">
                  <strong>Admin Attestation:</strong> I attest that I have verified the organizer's actual bank or merchant UPI credit statement and verified that ₹{confirmModal.receivedAmountInr} was received under this transaction reference.
                </label>
              </div>

              {confirmModal.error && (
                <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{confirmModal.error}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!confirmModal.attested || confirmModal.isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                >
                  {confirmModal.isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Confirming &amp; Allocating Coupons...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Confirm from Bank Record &amp; Issue Coupons</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal: Reject Payment */}
      {rejectModal.open && rejectModal.submission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-md w-full bg-[#0D132D] border border-rose-500/40 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-base">
                <AlertCircle className="w-5 h-5" />
                <span>Reject Payment Submission</span>
              </div>
              <button
                onClick={() => setRejectModal((prev) => ({ ...prev, open: false }))}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRejectSubmit} className="space-y-3 text-xs">
              <p className="text-slate-300">
                Are you sure you want to reject payment submission for <strong>{rejectModal.submission.participantName}</strong> ({rejectModal.submission.bookingPublicId})?
              </p>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Reason for Rejection <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={rejectModal.reviewNote}
                  onChange={(e) => setRejectModal((prev) => ({ ...prev, reviewNote: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white focus:border-rose-400 focus:outline-none"
                />
              </div>

              {rejectModal.error && (
                <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-500/40 text-rose-300 text-xs">
                  {rejectModal.error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectModal((prev) => ({ ...prev, open: false }))}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejectModal.isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50"
                >
                  {rejectModal.isSubmitting ? 'Rejecting...' : 'Reject Submission'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal: Request Resubmission */}
      {resubmitModal.open && resubmitModal.submission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-md w-full bg-[#0D132D] border border-amber-500/40 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-base">
                <AlertTriangle className="w-5 h-5" />
                <span>Request Proof Resubmission</span>
              </div>
              <button
                onClick={() => setResubmitModal((prev) => ({ ...prev, open: false }))}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResubmitSubmit} className="space-y-3 text-xs">
              <p className="text-slate-300">
                Ask <strong>{resubmitModal.submission.participantName}</strong> to re-upload clear proof for booking <strong>{resubmitModal.submission.bookingPublicId}</strong>.
              </p>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Guidance Note for Customer <span className="text-amber-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={resubmitModal.guidanceNote}
                  onChange={(e) => setResubmitModal((prev) => ({ ...prev, guidanceNote: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-purple-500/30 text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              {resubmitModal.error && (
                <div className="p-2.5 rounded-xl bg-rose-950 border border-rose-500/40 text-rose-300 text-xs">
                  {resubmitModal.error}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResubmitModal((prev) => ({ ...prev, open: false }))}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resubmitModal.isSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition cursor-pointer disabled:opacity-50"
                >
                  {resubmitModal.isSubmitting ? 'Sending Request...' : 'Send Resubmission Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Screenshot Inspection Modal */}
      {screenshotModal.open && screenshotModal.submissionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in">
          <div className="relative max-w-lg w-full bg-[#0D132D] border border-purple-500/30 rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-400" />
                <span>Uploaded Payment Screenshot</span>
              </h4>
              <button
                onClick={() => setScreenshotModal({ open: false, submissionId: null })}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="my-4 max-h-[70vh] overflow-auto flex items-center justify-center bg-black/40 rounded-xl p-2 border border-slate-800">
              <img
                src={`/api/admin/payment-reviews/${screenshotModal.submissionId}/screenshot`}
                alt="Payment Receipt"
                className="max-h-[60vh] w-auto object-contain rounded-lg"
              />
            </div>
            <div className="text-right">
              <button
                onClick={() => setScreenshotModal({ open: false, submissionId: null })}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
