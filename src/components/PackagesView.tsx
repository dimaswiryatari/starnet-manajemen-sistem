import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, RefreshCw, Search, Trash2, WifiOff, X } from 'lucide-react';
import { apiRequest } from '../api';
import type { AuthUser, Branch, PppoeProfile } from '../types';

interface PackagesViewProps {
  user: AuthUser;
}

export function PackagesView({ user }: PackagesViewProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(user.branch_id);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);

  const [packages, setPackages] = useState<PppoeProfile[]>([]);
  const [ipPools, setIpPools] = useState<string[]>([]);
  const [routerOnline, setRouterOnline] = useState(true);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [allowedFilter, setAllowedFilter] = useState<'all' | 'allowed' | 'disallowed'>('all');
  const [togglingName, setTogglingName] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Modal Create / Edit (Admin only)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingPkg, setEditingPkg] = useState<PppoeProfile | null>(null);
  const [pkgName, setPkgName] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const [localAddress, setLocalAddress] = useState('');
  const [remoteAddress, setRemoteAddress] = useState('');
  const [dnsServer, setDnsServer] = useState('');
  const [onlyOne, setOnlyOne] = useState('yes');
  const [parentQueue, setParentQueue] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal Delete (Admin only)
  const [deleteTarget, setDeleteTarget] = useState<PppoeProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function loadPackages(branchId: number) {
    setLoading(true);
    setRouterError(null);
    try {
      const res = await apiRequest<{
        branch: Branch;
        online: boolean;
        error: string | null;
        packages: PppoeProfile[];
        ipPools: string[];
      }>(`/api/branches/${branchId}/packages`);
      setSelectedBranch(res.branch);
      setRouterOnline(res.online);
      setRouterError(res.error);
      setPackages(res.packages);
      setIpPools(res.ipPools);
    } catch (err) {
      setRouterError(err instanceof Error ? err.message : 'Gagal memuat paket internet.');
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedBranchId) {
      loadPackages(selectedBranchId);
    }
  }, [selectedBranchId]);

  function openCreateModal() {
    const sampleLocal = packages.find((p) => p.localAddress)?.localAddress || '172.16.1.1';
    const samplePool = ipPools[0] || packages.find((p) => p.remoteAddress)?.remoteAddress || '';
    const sampleQueue = packages.find((p) => p.parentQueue)?.parentQueue || '';

    setModalMode('create');
    setEditingPkg(null);
    setPkgName('');
    setRateLimit('');
    setLocalAddress(sampleLocal);
    setRemoteAddress(samplePool);
    setDnsServer('');
    setOnlyOne('yes');
    setParentQueue(sampleQueue);
    setFormError(null);
  }

  function openEditModal(pkg: PppoeProfile) {
    setModalMode('edit');
    setEditingPkg(pkg);
    setPkgName(pkg.name);
    setRateLimit(pkg.rateLimit);
    setLocalAddress(pkg.localAddress);
    setRemoteAddress(pkg.remoteAddress);
    setDnsServer(pkg.dnsServer);
    setOnlyOne(pkg.onlyOne || 'default');
    setParentQueue(pkg.parentQueue);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranchId) return;
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        name: pkgName.trim(),
        rateLimit: rateLimit.trim(),
        localAddress: localAddress.trim(),
        remoteAddress: remoteAddress.trim(),
        dnsServer: dnsServer.trim(),
        onlyOne,
        parentQueue: parentQueue.trim(),
      };
      if (modalMode === 'create') {
        await apiRequest(`/api/branches/${selectedBranchId}/packages`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else if (modalMode === 'edit' && editingPkg) {
        await apiRequest(
          `/api/branches/${selectedBranchId}/packages/${encodeURIComponent(editingPkg.id)}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload),
          }
        );
      }
      setModalMode(null);
      await loadPackages(selectedBranchId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan paket internet.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!selectedBranchId || !deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(
        `/api/branches/${selectedBranchId}/packages/${encodeURIComponent(deleteTarget.id)}?name=${encodeURIComponent(deleteTarget.name)}`,
        { method: 'DELETE' }
      );
      setDeleteTarget(null);
      await loadPackages(selectedBranchId);
    } catch (err) {
      setRouterError(err instanceof Error ? err.message : 'Gagal menghapus paket internet.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleAllowed(pkg: PppoeProfile) {
    if (!selectedBranchId || user.role !== 'admin') return;
    const nextAllowed = !pkg.allowed;
    setTogglingName(pkg.name);
    setPackages((prev) =>
      prev.map((p) => (p.name === pkg.name ? { ...p, allowed: nextAllowed } : p))
    );
    try {
      await apiRequest(`/api/branches/${selectedBranchId}/packages/allowed`, {
        method: 'PUT',
        body: JSON.stringify({ profileName: pkg.name, allowed: nextAllowed }),
      });
    } catch (err) {
      setPackages((prev) =>
        prev.map((p) => (p.name === pkg.name ? { ...p, allowed: pkg.allowed } : p))
      );
      setRouterError(err instanceof Error ? err.message : 'Gagal memperbarui pilihan paket.');
    } finally {
      setTogglingName(null);
    }
  }

  async function handleBulkAllowed(allowed: boolean) {
    if (!selectedBranchId || user.role !== 'admin' || packages.length === 0) return;
    setBulkSaving(true);
    const prevSnapshot = packages;
    const items = packages.map((p) => ({ profileName: p.name, allowed }));
    setPackages((prev) => prev.map((p) => ({ ...p, allowed })));
    try {
      await apiRequest(`/api/branches/${selectedBranchId}/packages/allowed`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
    } catch (err) {
      setPackages(prevSnapshot);
      setRouterError(err instanceof Error ? err.message : 'Gagal memperbarui semua pilihan paket.');
    } finally {
      setBulkSaving(false);
    }
  }

  const allowedCount = packages.filter((p) => p.allowed).length;
  const disallowedCount = packages.length - allowedCount;

  const filteredPackages = packages.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.rateLimit.toLowerCase().includes(q) ||
      p.remoteAddress.toLowerCase().includes(q);
    const matchesAllowed =
      allowedFilter === 'all'
        ? true
        : allowedFilter === 'allowed'
          ? p.allowed
          : !p.allowed;
    return matchesSearch && matchesAllowed;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Paket Internet</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {user.role === 'admin'
              ? 'Kelola paket kecepatan, IP pool, dan limitasi PPPoE Profile langsung pada router MikroTik cabang.'
              : 'Daftar paket internet dan batas kecepatan yang tersedia di MikroTik cabang Anda.'}
          </p>
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
            <>
              <button
                type="button"
                onClick={() => loadPackages(selectedBranchId)}
                disabled={loading}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Segarkan</span>
              </button>

              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  disabled={!routerOnline}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tambah Paket</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!selectedBranchId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada cabang tersedia</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {user.role === 'admin'
              ? 'Tambahkan cabang MikroTik terlebih dahulu di Menu Cabang.'
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

          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
              <div className="relative flex-1 max-w-xs min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama paket atau rate limit..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    { id: 'all', label: `Semua (${packages.length})` },
                    { id: 'allowed', label: `Diizinkan (${allowedCount})` },
                    { id: 'disallowed', label: `Tidak Diizinkan (${disallowedCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAllowedFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                      allowedFilter === tab.id
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user.role === 'admin' && packages.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleBulkAllowed(true)}
                    disabled={bulkSaving}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Centang Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkAllowed(false)}
                    disabled={bulkSaving}
                    className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Kosongkan Pilihan
                  </button>
                </>
              )}
              {selectedBranch && (
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums ml-1">
                  {selectedBranch.name}
                </span>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
              </div>
            ) : filteredPackages.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {packages.length === 0
                    ? 'Belum ada paket internet (PPPoE Profile)'
                    : 'Tidak ada paket yang cocok dengan pencarian'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-6">Boleh Digunakan</th>
                      <th className="py-3 px-4">Nama Paket</th>
                      <th className="py-3 px-4">Rate Limit (Tx/Rx)</th>
                      <th className="py-3 px-4">Local Address</th>
                      <th className="py-3 px-4">Remote Address / Pool</th>
                      <th className="py-3 px-4">Only One</th>
                      <th className="py-3 px-4">Parent Queue</th>
                      {user.role === 'admin' && <th className="py-3 px-6 text-right">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {filteredPackages.map((pkg) => (
                      <tr key={pkg.id || pkg.name} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-3.5 px-6 whitespace-nowrap">
                          {user.role === 'admin' ? (
                            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={pkg.allowed}
                                disabled={togglingName === pkg.name || bulkSaving}
                                onChange={() => handleToggleAllowed(pkg)}
                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600 cursor-pointer"
                              />
                              <span
                                className={`text-xs font-medium ${
                                  pkg.allowed ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {pkg.allowed ? 'Diizinkan' : 'Tidak diizinkan'}
                              </span>
                            </label>
                          ) : (
                            <span
                              className={`text-xs font-medium ${
                                pkg.allowed ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                              }`}
                            >
                              {pkg.allowed ? 'Boleh digunakan' : 'Tidak diizinkan'}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{pkg.name}</span>
                          {pkg.isDefault && (
                            <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">· Bawaan RouterOS</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                          {pkg.rateLimit || <span className="text-slate-400 dark:text-slate-500">Unlimited</span>}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {pkg.localAddress || '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {pkg.remoteAddress || '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {pkg.onlyOne || 'default'}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {pkg.parentQueue || '—'}
                        </td>
                        {user.role === 'admin' && (
                          <td className="py-3.5 px-6 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEditModal(pkg)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              {!pkg.isDefault && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(pkg)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus</span>
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal Tambah / Edit Paket (Admin Only) */}
      {modalMode && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {modalMode === 'create' ? 'Tambah Paket Internet' : 'Edit Paket Internet'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Paket</label>
                  <input
                    type="text"
                    required
                    value={pkgName}
                    onChange={(e) => setPkgName(e.target.value)}
                    placeholder="Contoh: 15Mbps"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Rate Limit (Upload/Download)
                  </label>
                  <input
                    type="text"
                    value={rateLimit}
                    onChange={(e) => setRateLimit(e.target.value)}
                    placeholder="Contoh: 10M/15M"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Local Address</label>
                  <input
                    type="text"
                    value={localAddress}
                    onChange={(e) => setLocalAddress(e.target.value)}
                    placeholder="Contoh: 172.16.1.1"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Remote Address / IP Pool
                  </label>
                  <input
                    list="mikrotik-ip-pools"
                    value={remoteAddress}
                    onChange={(e) => setRemoteAddress(e.target.value)}
                    placeholder="Contoh: pool1-pppoe"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <datalist id="mikrotik-ip-pools">
                    {ipPools.map((pool) => (
                      <option key={pool} value={pool} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Only One</label>
                  <select
                    value={onlyOne}
                    onChange={(e) => setOnlyOne(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                    <option value="default">default</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">DNS Server</label>
                  <input
                    type="text"
                    value={dnsServer}
                    onChange={(e) => setDnsServer(e.target.value)}
                    placeholder="8.8.8.8"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Parent Queue</label>
                  <input
                    type="text"
                    value={parentQueue}
                    onChange={(e) => setParentQueue(e.target.value)}
                    placeholder="queue-pppoe"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : modalMode === 'create' ? 'Simpan Paket' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Paket */}
      {deleteTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Paket Internet</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              PPPoE Profile <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{deleteTarget.name}</span> akan
              dihapus dari router MikroTik cabang ini.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus Paket'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
