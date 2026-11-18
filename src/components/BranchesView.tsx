import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, FlaskConical, Pencil, Plus, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { apiRequest } from '../api';
import type { Branch, BranchStatus, ConnectionMode } from '../types';
import { formatConnectionMode, formatDateTime } from '../utils/format';

const DEFAULT_PORTS: Record<ConnectionMode, number> = {
  api: 8728,
  'api-ssl': 8729,
  'rest-http': 80,
  'rest-https': 443,
  sandbox: 8728,
};

export function BranchesView() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [mode, setMode] = useState<ConnectionMode>('api');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<string>('8728');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<BranchStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [editRemoteTarget, setEditRemoteTarget] = useState<Branch | null>(null);
  const [editRemoteUrl, setEditRemoteUrl] = useState('');
  const [editRemoteError, setEditRemoteError] = useState<string | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadBranches() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ branches: Branch[] }>('/api/branches');
      setBranches(res.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar cabang.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBranches();
  }, []);

  function openAddModal() {
    setName('');
    setLocation('');
    setMode('api');
    setHost('');
    setPort('8728');
    setUsername('');
    setPassword('');
    setRemoteUrl('');
    setTestResult(null);
    setFormError(null);
    setShowAddModal(true);
  }

  function openEditRemoteModal(branch: Branch) {
    setEditRemoteTarget(branch);
    setEditRemoteUrl(branch.remote_url || '');
    setEditRemoteError(null);
  }

  function handleModeChange(nextMode: ConnectionMode) {
    setMode(nextMode);
    setPort(String(DEFAULT_PORTS[nextMode]));
    setTestResult(null);
    if (nextMode === 'sandbox' && !host) {
      setHost('10.10.99.1');
    }
  }

  async function handleTestConnection() {
    setFormError(null);
    setTestResult(null);
    if (!host.trim()) {
      setFormError('Masukkan IP atau Host MikroTik terlebih dahulu.');
      return;
    }
    setTesting(true);
    try {
      const res = await apiRequest<BranchStatus>('/api/branches/test', {
        method: 'POST',
        body: JSON.stringify({
          connection_mode: mode,
          host: host.trim(),
          port: Number(port) || DEFAULT_PORTS[mode],
          username: username.trim(),
          password,
        }),
      });
      setTestResult(res);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Uji koneksi gagal.');
    } finally {
      setTesting(false);
    }
  }

  async function handleCreateBranch(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/branches', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          location: location.trim(),
          connection_mode: mode,
          host: host.trim(),
          port: Number(port) || DEFAULT_PORTS[mode],
          username: username.trim(),
          password,
          remote_url: remoteUrl.trim(),
        }),
      });
      setShowAddModal(false);
      await loadBranches();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menambahkan cabang.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveRemoteUrl(e: FormEvent) {
    e.preventDefault();
    if (!editRemoteTarget) return;
    setEditRemoteError(null);
    setSavingRemote(true);
    try {
      await apiRequest(`/api/branches/${editRemoteTarget.id}/remote-url`, {
        method: 'PUT',
        body: JSON.stringify({ remote_url: editRemoteUrl.trim() }),
      });
      setEditRemoteTarget(null);
      await loadBranches();
    } catch (err) {
      setEditRemoteError(err instanceof Error ? err.message : 'Gagal menyimpan alamat remote cabang.');
    } finally {
      setSavingRemote(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/branches/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await loadBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus cabang.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSeedSandbox() {
    setError(null);
    try {
      await apiRequest('/api/branches/seed-sandbox', { method: 'POST' });
      await loadBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat cabang uji coba.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Manajemen Cabang MikroTik
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Tambahkan atau hapus cabang RT/RW Net beserta konfigurasi integrasi MikroTik masing-masing.
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Cabang</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada cabang terdaftar</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              Daftarkan router MikroTik cabang Anda untuk mulai mengelola PPPoE secret dan pengecekan jaringan.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Cabang MikroTik</span>
              </button>
              <button
                type="button"
                onClick={handleSeedSandbox}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors cursor-pointer"
              >
                <FlaskConical className="w-4 h-4" />
                <span>Muat Cabang Lab Sandbox</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Nama Cabang</th>
                  <th className="py-3 px-4">Lokasi</th>
                  <th className="py-3 px-4">Metode Koneksi</th>
                  <th className="py-3 px-4">Host & Port</th>
                  <th className="py-3 px-4">Alamat Remote ONU</th>
                  <th className="py-3 px-4">Username API</th>
                  <th className="py-3 px-4">Ditambahkan</th>
                  <th className="py-3 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {branches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">{b.name}</td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">{b.location}</td>
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                      {formatConnectionMode(b.connection_mode)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-800 dark:text-slate-200 tabular-nums">
                      {b.host}:{b.port}
                    </td>
                    <td className="py-3.5 px-4">
                      {b.remote_url ? (
                        <a
                          href={b.remote_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline whitespace-nowrap"
                        >
                          <span className="truncate max-w-[200px]">{b.remote_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Belum diatur</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">{b.username}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {formatDateTime(b.created_at)}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditRemoteModal(b)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Alamat Remote</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(b)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Tambah Cabang */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Tambah Cabang MikroTik</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBranch} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Cabang</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Cabang Utara"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Lokasi / Area</label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Contoh: Desa Sukamaju"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Metode Integrasi MikroTik</label>
                <select
                  value={mode}
                  onChange={(e) => handleModeChange(e.target.value as ConnectionMode)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="api">RouterOS API (TCP Port 8728)</option>
                  <option value="api-ssl">RouterOS API-SSL (TLS Port 8729)</option>
                  <option value="rest-http">RouterOS v7 REST API (HTTP Port 80)</option>
                  <option value="rest-https">RouterOS v7 REST API (HTTPS Port 443)</option>
                  <option value="sandbox">Mode Lab Sandbox (Uji Coba Lokal)</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Host / IP / DDNS MikroTik</label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.88.1 atau vpn.domain.id"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Port</label>
                  <input
                    type="number"
                    required
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {mode !== 'sandbox' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Username MikroTik</label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="admin"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password MikroTik</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password router"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Remote ONU Cabang (Opsional)
                </label>
                <input
                  type="text"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="http://remote-cabang.domain.id:8080"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Alamat publik/VPN beserta port yang mengarah ke NAT <span className="font-mono">remot-onu</span> di MikroTik cabang ini.
                </p>
              </div>

              {testResult && (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    testResult.online
                      ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                      : 'border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
                  }`}
                >
                  {testResult.online ? (
                    <div className="flex items-start gap-2">
                      <Wifi className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Koneksi berhasil ke {testResult.identity}</p>
                        <p className="text-xs mt-0.5">
                          RouterOS {testResult.version || '-'} · Aktif: {testResult.activeCount} / Nonaktif:{' '}
                          {testResult.inactiveCount}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Router tidak merespons</p>
                        <p className="text-xs mt-0.5">{testResult.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60"
                >
                  {testing ? 'Menguji...' : 'Tes Koneksi Router'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {submitting ? 'Menyimpan...' : 'Simpan Cabang'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Edit Alamat Remote ONU Cabang */}
      {editRemoteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Alamat Remote ONU · {editRemoteTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditRemoteTarget(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRemoteUrl} className="p-6 space-y-4">
              {editRemoteError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {editRemoteError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Remote ONU
                </label>
                <input
                  type="text"
                  value={editRemoteUrl}
                  onChange={(e) => setEditRemoteUrl(e.target.value)}
                  placeholder="http://remote-cabang.domain.id:8080"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Masukkan URL/IP beserta port tujuan NAT <span className="font-mono">remot-onu</span> pada cabang ini. Kosongkan untuk menghapus alamat remote.
                </p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditRemoteTarget(null)}
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

      {/* Modal Konfirmasi Hapus Cabang */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Cabang</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Apakah Anda yakin ingin menghapus cabang{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteTarget.name}</span>? Staf yang ditugaskan
              ke cabang ini perlu dipindahkan ke cabang lain.
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
                {deleting ? 'Menghapus...' : 'Ya, Hapus Cabang'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
