import { useEffect, useState, type FormEvent } from 'react';
import {
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import type { AuthUser, Branch, PppoeCustomer } from '../types';
import { buildWhatsAppUrl, formatWhatsAppDisplay } from '../utils/format';

interface CustomersViewProps {
  user: AuthUser;
  initialStatusFilter?: 'all' | 'aktif' | 'tidak_aktif';
}

export function CustomersView({ user, initialStatusFilter = 'all' }: CustomersViewProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(user.branch_id);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);

  const [customers, setCustomers] = useState<PppoeCustomer[]>([]);
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [routerOnline, setRouterOnline] = useState(true);
  const [routerError, setRouterError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'aktif' | 'tidak_aktif'>(initialStatusFilter);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  // Add Modal
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addProfile, setAddProfile] = useState('');
  const [addWifiName, setAddWifiName] = useState('');
  const [addWifiPassword, setAddWifiPassword] = useState('');
  const [addWhatsapp, setAddWhatsapp] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [savingAdd, setSavingAdd] = useState(false);

  // Edit Modal
  const [editTarget, setEditTarget] = useState<PppoeCustomer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editService, setEditService] = useState('pppoe');
  const [editProfile, setEditProfile] = useState('');
  const [editWifiName, setEditWifiName] = useState('');
  const [editWifiPassword, setEditWifiPassword] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete Modal (Admin only)
  const [deleteTarget, setDeleteTarget] = useState<PppoeCustomer | null>(null);
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

  async function loadCustomers(branchId: number) {
    setLoading(true);
    setRouterError(null);
    try {
      const res = await apiRequest<{
        branch: Branch;
        online: boolean;
        error: string | null;
        profiles: string[];
        customers: PppoeCustomer[];
      }>(`/api/branches/${branchId}/customers`);
      setSelectedBranch(res.branch);
      setRouterOnline(res.online);
      setRouterError(res.error);
      setProfiles(res.profiles);
      setCustomers(res.customers);
    } catch (err) {
      setRouterError(err instanceof Error ? err.message : 'Gagal memuat pelanggan.');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedBranchId) {
      loadCustomers(selectedBranchId);
    }
  }, [selectedBranchId]);

  function openAddModal() {
    setAddName('');
    setAddProfile(profiles[0] || 'default');
    setAddWifiName('');
    setAddWifiPassword('');
    setAddWhatsapp('');
    setAddError(null);
    setShowAdd(true);
  }

  async function handleAddSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranchId) return;
    setAddError(null);
    setSavingAdd(true);
    try {
      await apiRequest(`/api/branches/${selectedBranchId}/customers`, {
        method: 'POST',
        body: JSON.stringify({
          name: addName.trim(),
          password: 'Infinix1',
          service: 'pppoe',
          profile: addProfile.trim(),
          wifiName: addWifiName.trim(),
          wifiPassword: addWifiPassword.trim(),
          whatsappNumber: addWhatsapp.trim(),
        }),
      });
      setShowAdd(false);
      await loadCustomers(selectedBranchId);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Gagal menambahkan pelanggan.');
    } finally {
      setSavingAdd(false);
    }
  }

  function openEditModal(cust: PppoeCustomer) {
    setEditTarget(cust);
    setEditName(cust.name);
    setEditPassword(cust.password || 'Infinix1');
    setEditService(cust.service || 'pppoe');
    setEditProfile(cust.profile || profiles[0] || 'default');
    setEditWifiName(cust.wifiName || '');
    setEditWifiPassword(cust.wifiPassword || '');
    setEditWhatsapp(cust.whatsappNumber ? formatWhatsAppDisplay(cust.whatsappNumber) : '');
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranchId || !editTarget) return;
    setEditError(null);
    setNotice(null);
    setSavingEdit(true);
    try {
      const res = await apiRequest<{ ok: boolean; removedActiveCount?: number }>(
        `/api/branches/${selectedBranchId}/customers/${encodeURIComponent(editTarget.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            name: editName.trim(),
            oldName: editTarget.name,
            password: editPassword.trim(),
            service: editService.trim(),
            profile: editProfile.trim(),
            wifiName: editWifiName.trim(),
            wifiPassword: editWifiPassword.trim(),
            whatsappNumber: editWhatsapp.trim(),
          }),
        }
      );
      const editedName = editName.trim();
      setEditTarget(null);
      setNotice(
        res.removedActiveCount && res.removedActiveCount > 0
          ? `Pelanggan "${editedName}" diperbarui dan ${res.removedActiveCount} active connection di MikroTik telah di-remove.`
          : `Pelanggan "${editedName}" berhasil diperbarui.`
      );
      await loadCustomers(selectedBranchId);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Gagal memperbarui pelanggan.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete() {
    if (!selectedBranchId || !deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(
        `/api/branches/${selectedBranchId}/customers/${encodeURIComponent(deleteTarget.id)}?name=${encodeURIComponent(deleteTarget.name)}`,
        { method: 'DELETE' }
      );
      setDeleteTarget(null);
      await loadCustomers(selectedBranchId);
    } catch (err) {
      setRouterError(err instanceof Error ? err.message : 'Gagal menghapus pelanggan.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleSandboxOnline(cust: PppoeCustomer) {
    if (!selectedBranchId) return;
    try {
      await apiRequest(`/api/branches/${selectedBranchId}/sandbox/toggle-active`, {
        method: 'POST',
        body: JSON.stringify({ secretId: cust.id }),
      });
      await loadCustomers(selectedBranchId);
    } catch {
      // ignore
    }
  }

  const filteredCustomers = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.profile.toLowerCase().includes(q) ||
      c.wifiName.toLowerCase().includes(q) ||
      (c.whatsappNumber || '').toLowerCase().includes(q) ||
      formatWhatsAppDisplay(c.whatsappNumber || '').toLowerCase().includes(q) ||
      (c.activeAddress || '').includes(search.trim());
    const matchesStatus = statusFilter === 'all' ? true : c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeTotal = customers.filter((c) => c.status === 'aktif').length;
  const inactiveTotal = customers.length - activeTotal;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Pelanggan</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Kelola pelanggan baru dan lama
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
                onClick={() => loadCustomers(selectedBranchId)}
                disabled={loading}
                className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Segarkan</span>
              </button>
              <button
                type="button"
                onClick={openAddModal}
                disabled={!routerOnline}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Pelanggan</span>
              </button>
            </>
          )}
        </div>
      </div>

      {!selectedBranchId ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
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

          {notice && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-3">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 p-1 rounded cursor-pointer"
                aria-label="Tutup pemberitahuan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Filter Bar & Summary */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama user, profile, WiFi, atau IP..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    { id: 'all', label: `Semua (${customers.length})` },
                    { id: 'aktif', label: `Aktif (${activeTotal})` },
                    { id: 'tidak_aktif', label: `Tidak Aktif (${inactiveTotal})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedBranch && (
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {selectedBranch.name} · {selectedBranch.host}:{selectedBranch.port}
              </div>
            )}
          </div>

          {/* Tabel Pelanggan */}
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
                  {customers.length === 0
                    ? 'Belum ada secret PPPoE pada cabang ini'
                    : 'Tidak ada pelanggan yang cocok dengan pencarian'}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {customers.length === 0
                    ? 'Tambahkan user PPPoE baru untuk langsung menyimpannya ke MikroTik.'
                    : 'Coba ubah kata kunci atau filter status.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-6">Name</th>
                      <th className="py-3 px-4">Password</th>
                      <th className="py-3 px-4">Service</th>
                      <th className="py-3 px-4">Profile</th>
                      <th className="py-3 px-4">Nomor WA</th>
                      <th className="py-3 px-4">Catatan WiFi</th>
                      <th className="py-3 px-4">Status Active</th>
                      <th className="py-3 px-4">IP / Uptime</th>
                      <th className="py-3 px-6 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {filteredCustomers.map((c) => (
                      <tr key={c.id || c.name} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">{c.name}</td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">{c.password}</td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300">{c.service}</td>
                        <td className="py-3.5 px-4 text-slate-800 dark:text-slate-200">{c.profile}</td>
                        <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                          {c.whatsappNumber ? (
                            <a
                              href={buildWhatsAppUrl(
                                c.whatsappNumber,
                                `Halo Bapak/Ibu *${c.name}*, kami dari admin *Starnet* (${selectedBranch?.name || 'Cabang'}) ingin menyampaikan informasi terkait layanan internet paket *${c.profile}*.`
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 font-mono text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{formatWhatsAppDisplay(c.whatsappNumber)}</span>
                            </a>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {c.wifiName || c.wifiPassword ? (
                            <div className="space-y-0.5">
                              {c.wifiName && (
                                <p className="font-medium text-slate-800 dark:text-slate-200">{c.wifiName}</p>
                              )}
                              {c.wifiPassword && (
                                <p className="font-mono text-slate-500 dark:text-slate-400">{c.wifiPassword}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {c.status === 'aktif' ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                              <Wifi className="w-3.5 h-3.5 shrink-0" />
                              <span>Aktif</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                              <WifiOff className="w-3.5 h-3.5 shrink-0" />
                              <span>Tidak Aktif</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {c.status === 'aktif' ? (
                            <div>
                              <span className="text-slate-900 dark:text-slate-100">{c.activeAddress || '-'}</span>
                              {c.activeUptime && (
                                <span className="text-slate-400 dark:text-slate-500 ml-1.5">· {c.activeUptime}</span>
                              )}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            {selectedBranch?.connection_mode === 'sandbox' && (
                              <button
                                type="button"
                                onClick={() => handleToggleSandboxOnline(c)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                              >
                                {c.status === 'aktif' ? 'Set Offline' : 'Set Aktif'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(c)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </button>
                            {user.role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(c)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal Tambah Pelanggan */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Tambah Pelanggan PPPoE</h3>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              {addError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {addError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Contoh: budi.blokA05"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                <input
                  type="text"
                  readOnly
                  value="Infinix1"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 font-mono text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Password otomatis ditetapkan tetap sebagai <span className="font-mono font-medium">Infinix1</span>.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Service</label>
                <input
                  type="text"
                  readOnly
                  value="pppoe"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 font-mono text-sm text-slate-700 dark:text-slate-300 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Profile (Paket Internet)</label>
                {profiles.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    Belum ada paket internet yang dicentang / diizinkan di menu Paket Internet.
                  </div>
                ) : (
                  <select
                    required
                    value={addProfile}
                    onChange={(e) => setAddProfile(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {profiles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama WiFi</label>
                  <input
                    type="text"
                    value={addWifiName}
                    onChange={(e) => setAddWifiName(e.target.value)}
                    placeholder="Contoh: RumahBudi"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password WiFi</label>
                  <input
                    type="text"
                    value={addWifiPassword}
                    onChange={(e) => setAddWifiPassword(e.target.value)}
                    placeholder="Contoh: 12345678"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nomor WhatsApp Pelanggan
                </label>
                <input
                  type="tel"
                  value={addWhatsapp}
                  onChange={(e) => setAddWhatsapp(e.target.value)}
                  placeholder="Contoh: 081234567890"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Digunakan untuk kirim notifikasi tagihan langsung ke WhatsApp.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingAdd || profiles.length === 0}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingAdd ? 'Menyimpan...' : 'Simpan Secret'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Pelanggan (4 Kolom) */}
      {editTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Edit Pelanggan PPPoE</h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              {editError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
                <input
                  type="text"
                  required
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Service</label>
                <select
                  value={editService}
                  onChange={(e) => setEditService(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="pppoe">pppoe</option>
                  <option value="any">any</option>
                  <option value="pptp">pptp</option>
                  <option value="l2tp">l2tp</option>
                  <option value="ovpn">ovpn</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Profile (Paket Internet)</label>
                <select
                  required
                  value={editProfile}
                  onChange={(e) => setEditProfile(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {!profiles.includes(editTarget.profile) && editTarget.profile && (
                    <option value={editTarget.profile} disabled>
                      {editTarget.profile} (tidak diizinkan)
                    </option>
                  )}
                  {profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama WiFi</label>
                  <input
                    type="text"
                    value={editWifiName}
                    onChange={(e) => setEditWifiName(e.target.value)}
                    placeholder="Contoh: RumahBudi"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password WiFi</label>
                  <input
                    type="text"
                    value={editWifiPassword}
                    onChange={(e) => setEditWifiPassword(e.target.value)}
                    placeholder="Contoh: 12345678"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nomor WhatsApp Pelanggan
                </label>
                <input
                  type="tel"
                  value={editWhatsapp}
                  onChange={(e) => setEditWhatsapp(e.target.value)}
                  placeholder="Contoh: 081234567890"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Pelanggan (Admin Only) */}
      {deleteTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Pelanggan PPPoE</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Secret PPPoE <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{deleteTarget.name}</span> akan
              dihapus permanen dari router MikroTik cabang ini.
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
                {deleting ? 'Menghapus...' : 'Ya, Hapus User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
