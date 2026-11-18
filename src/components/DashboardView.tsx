import { useEffect, useState } from 'react';
import {
  Activity,
  ChevronRight,
  FlaskConical,
  Plus,
  RefreshCw,
  Router,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiRequest } from '../api';
import type { AuditLog, AuthUser, BranchNetProfit, BranchStatus } from '../types';
import {
  formatActionLabel,
  formatConnectionMode,
  formatDateTime,
  formatPeriodLabel,
  formatRupiah,
} from '../utils/format';

interface DashboardViewProps {
  user: AuthUser;
  onNavigate: (
    tab: string,
    options?: { customerStatusFilter?: 'all' | 'aktif' | 'tidak_aktif' }
  ) => void;
}

function formatElapsedDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (days > 0) {
    return `${days} hari ${hours} jam ${minutes} mnt`;
  }
  if (hours > 0) {
    return `${hours} jam ${minutes} mnt`;
  }
  if (minutes > 0) {
    return `${minutes} mnt ${seconds} dtk`;
  }
  return `${seconds} dtk`;
}

export function DashboardView({ user, onNavigate }: DashboardViewProps) {
  const [branches, setBranches] = useState<BranchStatus[]>([]);
  const [branchProfits, setBranchProfits] = useState<BranchNetProfit[]>([]);
  const [profitPeriod, setProfitPeriod] = useState<string>('');
  const [selectedProfitBranchId, setSelectedProfitBranchId] = useState<string>('all');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'admin' | 'staff'>('all');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        branches: BranchStatus[];
        logs: AuditLog[];
        profitPeriod?: string;
        branchProfits?: BranchNetProfit[];
      }>('/api/dashboard');
      setBranches(data.branches);
      setLogs(data.logs);
      setProfitPeriod(data.profitPeriod || '');
      const profits = data.branchProfits || [];
      setBranchProfits(profits);
      setSelectedProfitBranchId((prev) => {
        if (prev === 'all') return 'all';
        return profits.some((p) => String(p.branchId) === prev) ? prev : 'all';
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat dashboard.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSeedSandbox() {
    setSeeding(true);
    setError(null);
    try {
      await apiRequest('/api/branches/seed-sandbox', { method: 'POST' });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat cabang sandbox.');
    } finally {
      setSeeding(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const hasOfflineBranch = branches.some((b) => !b.online);
  useEffect(() => {
    if (!hasOfflineBranch) return;
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [hasOfflineBranch]);

  const totalOnline = branches.filter((b) => b.online).length;
  const totalOffline = branches.length - totalOnline;
  const totalActivePppoe = branches.reduce((acc, b) => acc + b.activeCount, 0);
  const totalInactivePppoe = branches.reduce((acc, b) => acc + b.inactiveCount, 0);

  const activeProfitSummary = (() => {
    if (user.role === 'staff') {
      return (
        branchProfits[0] || {
          branchId: user.branch_id || 0,
          branchName: user.branch_name || 'Cabang Staf',
          totalIncome: 0,
          totalExpense: 0,
          netProfit: 0,
        }
      );
    }
    if (selectedProfitBranchId !== 'all') {
      const found = branchProfits.find((p) => String(p.branchId) === selectedProfitBranchId);
      if (found) return found;
    }
    return branchProfits.reduce(
      (acc, p) => ({
        branchId: 0,
        branchName: 'Semua Cabang',
        totalIncome: acc.totalIncome + p.totalIncome,
        totalExpense: acc.totalExpense + p.totalExpense,
        netProfit: acc.netProfit + p.netProfit,
      }),
      {
        branchId: 0,
        branchName: 'Semua Cabang',
        totalIncome: 0,
        totalExpense: 0,
        netProfit: 0,
      }
    );
  })();

  const visibleLogs =
    user.role === 'admin'
      ? logs.filter((l) => (logFilter === 'all' ? true : l.user_role === logFilter))
      : logs;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {user.role === 'admin' ? 'Ringkasan Semua Cabang' : `Ringkasan ${user.branch_name || 'Cabang Staf'}`}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {user.role === 'admin'
              ? 'Status konektivitas MikroTik, total PPPoE aktif/nonaktif, dan riwayat perubahan admin serta staf.'
              : 'Status router MikroTik, jumlah PPPoE aktif/nonaktif, dan log aktivitas staf pada cabang Anda.'}
          </p>
        </div>

        <button
          type="button"
          onClick={loadDashboard}
          disabled={loading}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Muat Ulang Status</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Ringkasan KPI */}
      {user.role === 'staff' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Status MikroTik</p>
                {loading ? (
                  <p className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">—</p>
                ) : branches.length === 0 ? (
                  <p className="font-display text-2xl font-bold text-slate-400 dark:text-slate-500 mt-2">Belum Terhubung</p>
                ) : branches[0].online ? (
                  <div className="mt-2 inline-flex items-center gap-2 font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                    <Wifi className="w-5 h-5 shrink-0" />
                    <span>Online</span>
                  </div>
                ) : (
                  <div className="mt-2 inline-flex items-center gap-2 font-display text-2xl font-bold text-red-600 dark:text-red-400">
                    <WifiOff className="w-5 h-5 shrink-0" />
                    <span>Offline</span>
                  </div>
                )}
              </div>
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Router className="w-4 h-4" />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {branches[0]?.branchName || user.branch_name || 'Cabang belum ditugaskan'}
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('customers', { customerStatusFilter: 'aktif' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('customers', { customerStatusFilter: 'aktif' });
              }
            }}
            className="group bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-500"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">PPPoE Aktif</p>
                <p className="font-display text-[28px] leading-tight font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-2">
                  {loading ? '—' : totalActivePppoe}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Sesi aktif di MikroTik</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                <span>Pelanggan Aktif</span>
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('customers', { customerStatusFilter: 'tidak_aktif' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('customers', { customerStatusFilter: 'tidak_aktif' });
              }
            }}
            className="group bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-500"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">PPPoE Nonaktif</p>
                <p className="font-display text-[28px] leading-tight font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-2">
                  {loading ? '—' : totalInactivePppoe}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Secret belum terhubung</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400 group-hover:text-amber-800 dark:group-hover:text-amber-300">
                <span>Pelanggan Nonaktif</span>
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Laba Bersih</p>
                <p
                  className={`font-display text-2xl leading-tight font-bold tabular-nums mt-2 ${
                    activeProfitSummary.netProfit < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {loading ? '—' : formatRupiah(activeProfitSummary.netProfit)}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span
                className="text-slate-500 dark:text-slate-400 truncate"
                title={`Pemasukan: ${formatRupiah(activeProfitSummary.totalIncome)} · Pengeluaran: ${formatRupiah(activeProfitSummary.totalExpense)}`}
              >
                {profitPeriod ? formatPeriodLabel(profitPeriod) : 'Bulan ini'} · {activeProfitSummary.branchName}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('finance')}
                className="inline-flex items-center gap-0.5 font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 shrink-0 cursor-pointer"
              >
                <span>Keuangan</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">MikroTik Online</p>
                <p className="font-display text-[28px] leading-tight font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-2">
                  {loading ? '—' : totalOnline}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Wifi className="w-4 h-4" />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
              Dari {branches.length} cabang terdaftar
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">MikroTik Offline</p>
                <p className={`font-display text-[28px] leading-tight font-bold tabular-nums mt-2 ${totalOffline > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                  {loading ? '—' : totalOffline}
                </p>
              </div>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${totalOffline > 0 ? 'bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                <WifiOff className="w-4 h-4" />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              {totalOffline > 0 ? 'Perlu pengecekan router' : 'Semua router terjangkau'}
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('customers', { customerStatusFilter: 'aktif' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('customers', { customerStatusFilter: 'aktif' });
              }
            }}
            className="group bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-500"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">PPPoE Aktif</p>
                <p className="font-display text-[28px] leading-tight font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-2">
                  {loading ? '—' : totalActivePppoe}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Sesi aktif di MikroTik</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                <span>Pelanggan Aktif</span>
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('customers', { customerStatusFilter: 'tidak_aktif' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('customers', { customerStatusFilter: 'tidak_aktif' });
              }
            }}
            className="group bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-sm rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-600/20 focus:border-amber-500"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">PPPoE Nonaktif</p>
                <p className="font-display text-[28px] leading-tight font-bold text-amber-700 dark:text-amber-400 tabular-nums mt-2">
                  {loading ? '—' : totalInactivePppoe}
                </p>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">Secret belum terhubung</span>
              <span className="inline-flex items-center gap-0.5 font-medium text-amber-700 dark:text-amber-400 group-hover:text-amber-800 dark:group-hover:text-amber-300">
                <span>Pelanggan Nonaktif</span>
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-2 xl:col-span-1 bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Laba Bersih</p>
              <select
                aria-label="Pilih cabang untuk laba bersih"
                value={selectedProfitBranchId}
                onChange={(e) => setSelectedProfitBranchId(e.target.value)}
                disabled={loading || branchProfits.length === 0}
                className="max-w-[140px] h-7 px-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-500 cursor-pointer disabled:opacity-60"
              >
                <option value="all">Semua Cabang</option>
                {branchProfits.map((bp) => (
                  <option key={bp.branchId} value={String(bp.branchId)}>
                    {bp.branchName}
                  </option>
                ))}
              </select>
            </div>
            <p
              className={`font-display text-[22px] xl:text-[24px] leading-tight font-bold tabular-nums mt-2.5 ${
                activeProfitSummary.netProfit < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
              title={`Pemasukan: ${formatRupiah(activeProfitSummary.totalIncome)} · Pengeluaran: ${formatRupiah(activeProfitSummary.totalExpense)}`}
            >
              {loading ? '—' : formatRupiah(activeProfitSummary.netProfit)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span
                className="text-slate-500 dark:text-slate-400 truncate"
                title={`Pemasukan: ${formatRupiah(activeProfitSummary.totalIncome)} · Pengeluaran: ${formatRupiah(activeProfitSummary.totalExpense)}`}
              >
                {profitPeriod ? formatPeriodLabel(profitPeriod) : 'Bulan ini'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('finance')}
                className="inline-flex items-center gap-0.5 font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 shrink-0 cursor-pointer"
              >
                <span>Keuangan</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status MikroTik Per Cabang */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Status MikroTik &amp; PPPoE Cabang
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pemeriksaan langsung ke perangkat MikroTik setiap cabang
            </p>
          </div>
          {user.role === 'admin' && branches.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('branches')}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 whitespace-nowrap cursor-pointer"
            >
              Kelola Cabang
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {user.role === 'admin'
                ? 'Belum ada cabang RT/RW Net yang terdaftar'
                : 'Akun Anda belum ditugaskan ke cabang manapun'}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-lg mx-auto">
              {user.role === 'admin'
                ? 'Tambahkan cabang baru dengan IP/Host MikroTik Anda, atau muat cabang Lab Sandbox untuk langsung menguji fitur PPPoE dan cek ping.'
                : 'Hubungi Administrator untuk menugaskan cabang MikroTik pada akun staf Anda.'}
            </p>
            {user.role === 'admin' && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('branches')}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Cabang MikroTik</span>
                </button>
                <button
                  type="button"
                  onClick={handleSeedSandbox}
                  disabled={seeding}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                >
                  <FlaskConical className="w-4 h-4" />
                  <span>{seeding ? 'Menyiapkan...' : 'Muat Cabang Lab Sandbox'}</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Cabang</th>
                  <th className="py-3 px-4">Router &amp; Metode</th>
                  <th className="py-3 px-4">Status MikroTik</th>
                  <th className="py-3 px-4 text-right">PPPoE Aktif</th>
                  <th className="py-3 px-4 text-right">PPPoE Nonaktif</th>
                  <th className="py-3 px-6 text-right">Total Secret</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 text-sm">
                {branches.map((b) => (
                  <tr key={b.branchId} className="hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-6">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{b.branchName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{b.location}</p>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                        {b.host}:{b.port}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {formatConnectionMode(b.connectionMode)}
                        {b.version ? ` · v${b.version}` : ''}
                      </p>
                    </td>
                    <td className="py-3.5 px-4">
                      {b.online ? (
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                            <Wifi className="w-4 h-4 shrink-0" />
                            <span>Online</span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
                            Uptime: {b.uptime || '-'}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                            <WifiOff className="w-4 h-4 shrink-0" />
                            <span>Offline</span>
                          </div>
                          <p className="text-xs text-red-600/90 dark:text-red-400/90 mt-0.5 font-mono tabular-nums">
                            Lama offline:{' '}
                            {b.offlineSince
                              ? formatElapsedDuration(
                                  Math.max(0, Math.floor((nowMs - Date.parse(b.offlineSince)) / 1000))
                                )
                              : b.offlineDuration || '0 dtk'}
                          </p>
                          {b.error && (
                            <p
                              className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs truncate"
                              title={b.error}
                            >
                              {b.error}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {b.activeCount}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-amber-700 dark:text-amber-400 tabular-nums">
                      {b.inactiveCount}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                      {b.totalSecrets}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Log Perubahan */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {user.role === 'admin' ? 'Log Perubahan Admin & Staf' : 'Log Perubahan Staf Cabang'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {user.role === 'admin'
                ? 'Catatan audit seluruh aktivitas konfigurasi dari semua cabang'
                : 'Catatan perubahan yang dilakukan staf pada cabang Anda'}
            </p>
          </div>

          {user.role === 'admin' && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(['all', 'admin', 'staff'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setLogFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    logFilter === f
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {f === 'all' ? 'Semua' : f === 'admin' ? 'Admin' : 'Staf'}
                </button>
              ))}
            </div>
          )}
        </div>

        {visibleLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Belum ada catatan perubahan yang terekam.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Waktu</th>
                  <th className="py-3 px-4">Pelaku</th>
                  <th className="py-3 px-4">Cabang</th>
                  <th className="py-3 px-4">Aksi</th>
                  <th className="py-3 px-6">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800 text-sm">
                {visibleLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-6 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{log.user_full_name}</span>
                      <span className="text-slate-400 dark:text-slate-500 mx-1.5">·</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {log.user_role === 'admin' ? 'Admin' : 'Staf'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {log.branch_name || 'Global'}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {formatActionLabel(log.action)}
                    </td>
                    <td className="py-3 px-6 text-slate-600 dark:text-slate-400 max-w-md">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
