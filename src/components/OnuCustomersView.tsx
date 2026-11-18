import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe,
  Pencil,
  RefreshCw,
  Router,
  Search,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import type { AuthUser, Branch, OnuNatRuleStatus, PppoeCustomer } from '../types';

interface OnuCustomersViewProps {
  user: AuthUser;
}

export function OnuCustomersView({ user }: OnuCustomersViewProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(user.branch_id);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);

  const [customers, setCustomers] = useState<PppoeCustomer[]>([]);
  const [natRule, setNatRule] = useState<OnuNatRuleStatus | null>(null);
  const [routerOnline, setRouterOnline] = useState(true);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'with_ip' | 'all'>('with_ip');

  const [targetingCustomerId, setTargetingCustomerId] = useState<string | null>(null);
  const [manualIp, setManualIp] = useState('');
  const [submittingManual, setSubmittingManual] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    ipAddress: string;
    customerName?: string;
  } | null>(null);

  // Admin: Edit Alamat Remote Cabang
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [remoteUrlInput, setRemoteUrlInput] = useState('');
  const [remoteModalError, setRemoteModalError] = useState<string | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);

  useEffect(() => {
    async function initBranches() {
      try {
        const res = await apiRequest<{ branches: Branch[] }>('/api/branches');
        setBranches(res.branches);
        if (user.role === 'staff') {
          setSelectedBranchId(user.branch_id);
        } else if (res.branches.length > 0) {
          setSelectedBranchId((prev) => prev ?? res.branches[0].id);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    initBranches();
  }, [user.branch_id, user.role]);

  async function loadOnuRemote(branchId: number) {
    setLoading(true);
    setRouterError(null);
    setActionError(null);
    try {
      const res = await apiRequest<{
        branch: Branch;
        online: boolean;
        error: string | null;
        natRule: OnuNatRuleStatus;
        customers: PppoeCustomer[];
      }>(`/api/branches/${branchId}/onu-remote`);
      setSelectedBranch(res.branch);
      setRouterOnline(res.online);
      setRouterError(res.error);
      setNatRule(res.natRule);
      setCustomers(res.customers);
    } catch (err) {
      setRouterError(err instanceof Error ? err.message : 'Gagal memuat data ONU pelanggan.');
      setCustomers([]);
      setNatRule(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedBranchId) {
      setNotice(null);
      loadOnuRemote(selectedBranchId);
    }
  }, [selectedBranchId]);

  async function handlePointRemoteToCustomer(cust: PppoeCustomer) {
    if (!selectedBranchId || !cust.activeAddress) return;
    setActionError(null);
    setNotice(null);
    setTargetingCustomerId(cust.id);
    try {
      const res = await apiRequest<{
        ok: boolean;
        branch: Branch;
        natRule: OnuNatRuleStatus;
      }>(`/api/branches/${selectedBranchId}/onu-remote`, {
        method: 'POST',
        body: JSON.stringify({
          ipAddress: cust.activeAddress,
          customerName: cust.name,
        }),
      });
      setSelectedBranch(res.branch);
      setNatRule(res.natRule);
      setNotice({
        message: `Rule NAT "remot-onu" berhasil diarahkan ke IP ${res.natRule.toAddresses} (${cust.name}).`,
        ipAddress: res.natRule.toAddresses,
        customerName: cust.name,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengarahkan NAT remot-onu di MikroTik.'
      );
    } finally {
      setTargetingCustomerId(null);
    }
  }

  async function handlePointManualIp(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranchId || !manualIp.trim()) return;
    setActionError(null);
    setNotice(null);
    setSubmittingManual(true);
    try {
      const res = await apiRequest<{
        ok: boolean;
        branch: Branch;
        natRule: OnuNatRuleStatus;
      }>(`/api/branches/${selectedBranchId}/onu-remote`, {
        method: 'POST',
        body: JSON.stringify({
          ipAddress: manualIp.trim(),
        }),
      });
      setSelectedBranch(res.branch);
      setNatRule(res.natRule);
      setManualIp('');
      setNotice({
        message: `Rule NAT "remot-onu" berhasil diarahkan ke IP ${res.natRule.toAddresses}.`,
        ipAddress: res.natRule.toAddresses,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengarahkan NAT remot-onu ke IP manual.'
      );
    } finally {
      setSubmittingManual(false);
    }
  }

  function openRemoteUrlModal() {
    if (!selectedBranch) return;
    setRemoteUrlInput(selectedBranch.remote_url || '');
    setRemoteModalError(null);
    setShowRemoteModal(true);
  }

  async function handleSaveRemoteUrl(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranch) return;
    setRemoteModalError(null);
    setSavingRemote(true);
    try {
      const res = await apiRequest<{ branch: Branch }>(
        `/api/branches/${selectedBranch.id}/remote-url`,
        {
          method: 'PUT',
          body: JSON.stringify({ remote_url: remoteUrlInput.trim() }),
        }
      );
      setSelectedBranch(res.branch);
      setBranches((prev) => prev.map((b) => (b.id === res.branch.id ? res.branch : b)));
      setShowRemoteModal(false);
    } catch (err) {
      setRemoteModalError(
        err instanceof Error ? err.message : 'Gagal menyimpan alamat remote cabang.'
      );
    } finally {
      setSavingRemote(false);
    }
  }

  const customersWithIp = customers.filter((c) => Boolean(c.activeAddress));
  const activeNatCustomer = natRule?.toAddresses
    ? customers.find((c) => c.activeAddress === natRule.toAddresses) || null
    : null;

  const filteredCustomers = customers.filter((c) => {
    if (filterMode === 'with_ip' && !c.activeAddress) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.profile.toLowerCase().includes(q) ||
      c.wifiName.toLowerCase().includes(q) ||
      (c.activeAddress || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            ONU Pelanggan
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {user.role === 'admin' && branches.length > 0 && (
            <select
              value={selectedBranchId ?? ''}
              onChange={(e) => setSelectedBranchId(Number(e.target.value))}
              aria-label="Pilih cabang"
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {selectedBranchId && (
            <button
              type="button"
              onClick={() => loadOnuRemote(selectedBranchId)}
              disabled={loading}
              className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Segarkan</span>
            </button>
          )}
        </div>
      </div>

      {!selectedBranchId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada cabang tersedia</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {user.role === 'admin'
              ? 'Silakan tambahkan cabang MikroTik terlebih dahulu di Menu Cabang.'
              : 'Akun staf Anda belum dihubungkan ke cabang manapun.'}
          </p>
        </div>
      ) : (
        <>
          {routerError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>{routerError}</span>
            </div>
          )}

          {actionError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100 p-1 rounded cursor-pointer"
                aria-label="Tutup pesan error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{notice.message}</span>
              </div>
              <div className="flex items-center gap-2">
                {selectedBranch?.remote_url && (
                  <a
                    href={selectedBranch.remote_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium whitespace-nowrap"
                  >
                    <span>Buka Halaman ONU</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 p-1 rounded cursor-pointer"
                  aria-label="Tutup pemberitahuan"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Panel Status Alamat Remote Cabang & Rule NAT remot-onu */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Alamat Remote Cabang */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Alamat Remote ONU Cabang · {selectedBranch?.name || '-'}
                  </p>
                  {selectedBranch?.remote_url ? (
                    <p className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 mt-1.5 truncate">
                      {selectedBranch.remote_url}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mt-1.5">
                      Alamat remote cabang belum diatur
                    </p>
                  )}
                </div>
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <Globe className="w-4 h-4" />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {selectedBranch?.remote_url ? (
                  <a
                    href={selectedBranch.remote_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                  >
                    <span>Buka Alamat Remote</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-xs text-slate-400 dark:text-slate-500">Link remote belum tersedia</span>
                )}

                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={openRemoteUrlModal}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{selectedBranch?.remote_url ? 'Ubah Alamat' : 'Atur Alamat Remote'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Status NAT MikroTik (comment: remot-onu) */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {user.role === 'admin' && (
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      MikroTik IP &gt; Firewall &gt; NAT (komen: <span className="font-mono">remot-onu</span>)
                    </p>
                  )}
                  {loading ? (
                    <p className="font-mono text-sm text-slate-400 dark:text-slate-500 mt-1.5">Memeriksa rule NAT...</p>
                  ) : !routerOnline ? (
                    <p className="text-sm font-medium text-red-600 dark:text-red-400 mt-1.5">Router MikroTik Offline</p>
                  ) : !natRule?.found ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Rule NAT &quot;remot-onu&quot; tidak ditemukan</span>
                    </div>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">To Addresses:</span>
                        <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {natRule.toAddresses || 'Belum diisi'}
                        </span>
                        {activeNatCustomer && (
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                            · {activeNatCustomer.name}
                          </span>
                        )}
                      </div>
                      {user.role === 'admin' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          chain={natRule.chain} · action={natRule.action}
                          {natRule.dstPort ? ` · dst-port=${natRule.dstPort}` : ''}
                          {natRule.toPorts ? ` · to-ports=${natRule.toPorts}` : ''}
                          {natRule.disabled ? ' · DISABLED' : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                  <Router className="w-4 h-4" />
                </div>
              </div>

              {/* Quick Manual IP Input (Admin Only) */}
              {user.role === 'admin' && (
                <form
                  onSubmit={handlePointManualIp}
                  className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800"
                >
                  <input
                    type="text"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    disabled={!routerOnline || !natRule?.found || submittingManual}
                    placeholder="Atur IP manual (mis. 172.16.10.11)"
                    aria-label="Atur IP manual to-addresses NAT"
                    className="flex-1 min-w-[180px] h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 dark:disabled:bg-slate-800/50"
                  />
                  <button
                    type="submit"
                    disabled={!routerOnline || !natRule?.found || !manualIp.trim() || submittingManual}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                  >
                    <span>{submittingManual ? 'Menyimpan...' : 'Set IP Manual'}</span>
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama pelanggan, IP, paket, atau WiFi..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFilterMode('with_ip')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                    filterMode === 'with_ip'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Aktif / Punya IP ({customersWithIp.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                    filterMode === 'all'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Semua Pelanggan ({customers.length})
                </button>
              </div>
            </div>
          </div>

          {/* Tabel Pelanggan untuk Remote ONU */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {filterMode === 'with_ip'
                    ? 'Tidak ada pelanggan aktif dengan IP PPPoE'
                    : 'Tidak ada data pelanggan ditemukan'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {filterMode === 'with_ip'
                    ? 'Pelanggan harus terhubung (status Aktif) agar memiliki IP yang dapat diarahkan ke NAT remot-onu.'
                    : 'Coba ubah kata kunci pencarian Anda.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-6">Pelanggan PPPoE</th>
                      <th className="py-3 px-4">Paket</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">IP Pelanggan</th>
                      <th className="py-3 px-6 text-right">Remote ONU</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {filteredCustomers.map((c) => {
                      const isCurrentTarget =
                        Boolean(c.activeAddress) &&
                        Boolean(natRule?.toAddresses) &&
                        c.activeAddress === natRule?.toAddresses;
                      const isUpdating = targetingCustomerId === c.id;

                      return (
                        <tr
                          key={c.id}
                          className={
                            isCurrentTarget
                              ? 'bg-blue-50/40 dark:bg-blue-950/30 hover:bg-blue-50/60 dark:hover:bg-blue-950/40 transition-colors'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors'
                          }
                        >
                          <td className="py-3.5 px-6">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{c.name}</p>
                            {c.wifiName && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">WiFi: {c.wifiName}</p>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {c.profile}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {c.status === 'aktif' ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                <Wifi className="w-3.5 h-3.5 shrink-0" />
                                <span>Aktif</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                                <span>Tidak Aktif</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                            {c.activeAddress ? (
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-900 dark:text-slate-100">
                                  {c.activeAddress}
                                </span>
                                {isCurrentTarget && (
                                  <span className="inline-flex items-center gap-1 text-xs font-sans font-medium text-blue-700 dark:text-blue-400">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Aktif di NAT</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">Belum ada IP</span>
                            )}
                          </td>
                          <td className="py-3.5 px-6 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-2">
                              {isCurrentTarget && selectedBranch?.remote_url && (
                                <a
                                  href={selectedBranch.remote_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap"
                                >
                                  <span>Buka ONU</span>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}

                              <button
                                type="button"
                                onClick={() => handlePointRemoteToCustomer(c)}
                                disabled={
                                  !c.activeAddress ||
                                  !routerOnline ||
                                  !natRule?.found ||
                                  isUpdating
                                }
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                                  isCurrentTarget
                                    ? 'border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                              >
                                <span>
                                  {isUpdating
                                    ? 'Mengarahkan...'
                                    : isCurrentTarget
                                      ? 'Perbarui NAT'
                                      : 'Arahkan Remote'}
                                </span>
                                {!isUpdating && <ArrowRight className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal Ubah Alamat Remote Cabang (Admin Only) */}
      {showRemoteModal && selectedBranch && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Alamat Remote ONU · {selectedBranch.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowRemoteModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRemoteUrl} className="p-6 space-y-4">
              {remoteModalError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {remoteModalError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Remote ONU Cabang
                </label>
                <input
                  type="text"
                  value={remoteUrlInput}
                  onChange={(e) => setRemoteUrlInput(e.target.value)}
                  placeholder="http://remote-cabang.domain.id:8080"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Masukkan URL/IP publik beserta port yang diteruskan oleh rule NAT{' '}
                  <span className="font-mono">remot-onu</span> pada cabang ini.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowRemoteModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingRemote}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingRemote ? 'Menyimpan...' : 'Simpan Alamat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
