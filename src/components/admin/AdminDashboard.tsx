import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
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
} from 'lucide-react';

interface AdminDashboardProps {
  adminUser: any;
  onLogout: () => void;
  onBackToSite: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ adminUser, onLogout, onBackToSite }) => {
  const [activeTab, setActiveTab] = useState<'applied_coupons' | 'payment_diagnostics'>('applied_coupons');
  const [metrics, setMetrics] = useState<any>(null);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

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

  const fetchDiagnostics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payments');
      const json = await res.json();
      if (json.success) {
        setDiagnostics(json.data || []);
      }
    } catch (err) {
      console.error('Error fetching diagnostics', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (activeTab === 'applied_coupons') {
      fetchCoupons();
    } else {
      fetchDiagnostics();
    }
  }, [activeTab, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchCoupons();
  };

  const handleExportCsv = () => {
    window.location.href = '/api/admin/coupons/export.csv';
  };

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
            <p className="text-[10px] text-slate-400 font-mono">Satulur Lucky Draw 2026</p>
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
              <span>Confirmed Revenue</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-white font-display">
              ₹{(metrics?.totalRevenueInr || 0).toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Real Verified Collections</span>
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

          <div className="p-4 rounded-2xl bg-[#0D132D] border border-purple-500/20">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Payment Diagnostics</span>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-300 font-display">
              {metrics?.failedOrPendingAttempts || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Pending / Incomplete</div>
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
                setActiveTab('payment_diagnostics');
                setPage(1);
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'payment_diagnostics'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-900'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Payment Diagnostics</span>
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

        {/* Applied Coupons View */}
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
                      <th className="p-3 sm:p-4">Paid Date</th>
                      <th className="p-3 sm:p-4 text-right">Pass</th>
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
                            Only real, successfully paid bookings appear here.
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
                            <a
                              href={`/api/admin/coupons/${c.coupon_number}/download`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-400/40 hover:bg-amber-500/30 text-[11px] font-bold transition cursor-pointer"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Download className="w-3 h-3" />
                              <span>PDF</span>
                            </a>
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
                    Showing {coupons.length} of {pagination.total} confirmed coupons
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-mono">
                      {page} / {pagination.totalPages}
                    </span>
                    <button
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      className="p-1.5 rounded-lg bg-slate-800 disabled:opacity-40 hover:bg-slate-700 transition"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment Diagnostics View */}
        {activeTab === 'payment_diagnostics' && (
          <div className="bg-[#0D132D] border border-purple-500/20 rounded-2xl overflow-hidden shadow-xl p-4 sm:p-6">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Incomplete & Pending Payment Attempts</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              These records represent ongoing, abandoned, or failed checkout sessions. They are strictly segregated and not counted as applied coupons.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-purple-500/20 bg-slate-950/60 text-slate-400 font-mono uppercase text-[10px]">
                    <th className="p-3">Client Txn ID</th>
                    <th className="p-3">Booking Ref</th>
                    <th className="p-3">Applicant</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10 font-mono">
                  {diagnostics.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-400">
                        No pending or failed payment attempts.
                      </td>
                    </tr>
                  ) : (
                    diagnostics.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-900/60">
                        <td className="p-3 text-amber-300">{d.clientTxnId}</td>
                        <td className="p-3 text-purple-300">{d.bookingPublicId}</td>
                        <td className="p-3 text-white font-sans">{d.participantName}</td>
                        <td className="p-3 text-emerald-400 font-sans">₹{d.amountInr}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              d.normalizedStatus === 'confirmed'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-950 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {d.normalizedStatus}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 text-[11px] font-sans">{d.createdAt}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
