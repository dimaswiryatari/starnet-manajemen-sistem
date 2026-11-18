import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Pencil,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Router,
  Satellite,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import type {
  AuthUser,
  BranchStatus,
  OltLink,
  PingResult,
  StarlinkDishState,
  StarlinkLiveStatus,
  StarlinkRemote,
} from '../types';
import { formatConnectionMode, formatDateTime } from '../utils/format';

interface NetworkCheckViewProps {
  user: AuthUser;
}

function extractHostFromUrl(httpUrl: string): string {
  try {
    return new URL(httpUrl).hostname;
  } catch {
    return httpUrl.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || '';
  }
}

export function NetworkCheckView({ user }: NetworkCheckViewProps) {
  const [branches, setBranches] = useState<BranchStatus[]>([]);
  const [olts, setOlts] = useState<OltLink[]>([]);
  const [starlinks, setStarlinks] = useState<StarlinkRemote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(user.branch_id);
  const [target, setTarget] = useState('8.8.8.8');
  const [count, setCount] = useState(4);
  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const pingSectionRef = useRef<HTMLElement | null>(null);

  // Modal Tambah / Edit OLT
  const [showOltModal, setShowOltModal] = useState(false);
  const [editingOlt, setEditingOlt] = useState<OltLink | null>(null);
  const [oltBranchId, setOltBranchId] = useState<number | ''>('');
  const [oltName, setOltName] = useState('');
  const [oltHttpUrl, setOltHttpUrl] = useState('');
  const [oltLoginUsername, setOltLoginUsername] = useState('');
  const [oltLoginPassword, setOltLoginPassword] = useState('');
  const [savingOlt, setSavingOlt] = useState(false);
  const [oltError, setOltError] = useState<string | null>(null);

  // Modal Hapus OLT
  const [deleteOltTarget, setDeleteOltTarget] = useState<OltLink | null>(null);
  const [deletingOlt, setDeletingOlt] = useState(false);

  // Modal Tambah / Edit Remote Starlink
  const [showStarlinkModal, setShowStarlinkModal] = useState(false);
  const [editingStarlink, setEditingStarlink] = useState<StarlinkRemote | null>(null);
  const [starlinkBranchId, setStarlinkBranchId] = useState<number | ''>('');
  const [starlinkName, setStarlinkName] = useState('');
  const [starlinkRemoteUrl, setStarlinkRemoteUrl] = useState('');
  const [starlinkLocalIp, setStarlinkLocalIp] = useState('192.168.100.1');
  const [starlinkNotes, setStarlinkNotes] = useState('');
  const [savingStarlink, setSavingStarlink] = useState(false);
  const [starlinkError, setStarlinkError] = useState<string | null>(null);

  // Modal Konfirmasi Reboot Starlink & Hapus Remote Starlink
  const [rebootTarget, setRebootTarget] = useState<StarlinkRemote | null>(null);
  const [rebootingStarlink, setRebootingStarlink] = useState(false);
  const [testingStarlinkId, setTestingStarlinkId] = useState<number | null>(null);
  const [starlinkTestNotice, setStarlinkTestNotice] = useState<{
    id: number;
    name: string;
    grpcReady: boolean;
    mode: 'grpc-http2' | 'grpc-web' | 'web-ui-only' | 'sandbox';
    message: string;
  } | null>(null);
  const [starlinkStatuses, setStarlinkStatuses] = useState<Record<number, StarlinkLiveStatus>>({});
  const [loadingStarlinkStatuses, setLoadingStarlinkStatuses] = useState(false);
  const [deleteStarlinkTarget, setDeleteStarlinkTarget] = useState<StarlinkRemote | null>(null);
  const [deletingStarlink, setDeletingStarlink] = useState(false);

  async function loadStarlinkStatuses() {
    setLoadingStarlinkStatuses(true);
    try {
      const res = await apiRequest<{ statuses: StarlinkLiveStatus[] }>('/api/starlink-remotes/status');
      const nextMap: Record<number, StarlinkLiveStatus> = {};
      for (const item of res.statuses) {
        nextMap[item.id] = item;
      }
      setStarlinkStatuses(nextMap);
    } catch {
      // Abaikan jika gagal memuat status live Starlink
    } finally {
      setLoadingStarlinkStatuses(false);
    }
  }

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const [networkRes, oltRes, starlinkRes] = await Promise.all([
        apiRequest<{ branches: BranchStatus[] }>('/api/network-check'),
        apiRequest<{ olts: OltLink[] }>('/api/olt-links'),
        apiRequest<{ starlinks: StarlinkRemote[] }>('/api/starlink-remotes'),
      ]);
      setBranches(networkRes.branches);
      setOlts(oltRes.olts);
      setStarlinks(starlinkRes.starlinks);
      if (user.role === 'staff') {
        setSelectedBranchId(user.branch_id);
      } else if (networkRes.branches.length > 0) {
        setSelectedBranchId((prev) => prev ?? networkRes.branches[0].branchId);
      }
      if (starlinkRes.starlinks.length > 0) {
        void loadStarlinkStatuses();
      } else {
        setStarlinkStatuses({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memeriksa status jaringan.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function handleRunPing(e: FormEvent) {
    e.preventDefault();
    if (!selectedBranchId || !target.trim()) return;
    setPinging(true);
    setPingError(null);
    try {
      const res = await apiRequest<{ result: PingResult }>(
        `/api/branches/${selectedBranchId}/ping`,
        {
          method: 'POST',
          body: JSON.stringify({ target: target.trim(), count }),
        }
      );
      setPingResult(res.result);
    } catch (err) {
      setPingError(err instanceof Error ? err.message : 'Gagal menjalankan ping dari MikroTik.');
      setPingResult(null);
    } finally {
      setPinging(false);
    }
  }

  function openAddOltModal() {
    setEditingOlt(null);
    setOltBranchId(selectedBranchId ?? branches[0]?.branchId ?? '');
    setOltName('');
    setOltHttpUrl('http://');
    setOltLoginUsername('');
    setOltLoginPassword('');
    setOltError(null);
    setShowOltModal(true);
  }

  function openEditOltModal(olt: OltLink) {
    setEditingOlt(olt);
    setOltBranchId(olt.branch_id);
    setOltName(olt.name);
    setOltHttpUrl(olt.http_url);
    setOltLoginUsername(olt.login_username || '');
    setOltLoginPassword(olt.login_password || '');
    setOltError(null);
    setShowOltModal(true);
  }

  async function handleSaveOlt(e: FormEvent) {
    e.preventDefault();
    if (!oltBranchId) {
      setOltError('Pilih cabang terlebih dahulu.');
      return;
    }
    setSavingOlt(true);
    setOltError(null);
    setNotice(null);
    try {
      const payload = {
        branch_id: Number(oltBranchId),
        name: oltName.trim(),
        http_url: oltHttpUrl.trim(),
        login_username: oltLoginUsername.trim(),
        login_password: oltLoginPassword.trim(),
      };
      if (editingOlt) {
        await apiRequest(`/api/olt-links/${editingOlt.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice(`Link OLT "${payload.name}" berhasil diperbarui.`);
      } else {
        await apiRequest('/api/olt-links', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(`Link OLT "${payload.name}" berhasil ditambahkan.`);
      }
      setShowOltModal(false);
      await loadStatus();
    } catch (err) {
      setOltError(err instanceof Error ? err.message : 'Gagal menyimpan link OLT.');
    } finally {
      setSavingOlt(false);
    }
  }

  async function handleConfirmDeleteOlt() {
    if (!deleteOltTarget) return;
    setDeletingOlt(true);
    setNotice(null);
    try {
      await apiRequest(`/api/olt-links/${deleteOltTarget.id}`, {
        method: 'DELETE',
      });
      setNotice(`Link OLT "${deleteOltTarget.name}" berhasil dihapus.`);
      setDeleteOltTarget(null);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus link OLT.');
      setDeleteOltTarget(null);
    } finally {
      setDeletingOlt(false);
    }
  }

  function handleQuickPingOlt(olt: OltLink) {
    const host = extractHostFromUrl(olt.http_url);
    if (!host) return;
    if (user.role === 'admin') {
      setSelectedBranchId(olt.branch_id);
    }
    setTarget(host);
    pingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openAddStarlinkModal() {
    setEditingStarlink(null);
    setStarlinkBranchId(selectedBranchId ?? branches[0]?.branchId ?? '');
    setStarlinkName('');
    setStarlinkRemoteUrl('http://');
    setStarlinkLocalIp('192.168.100.1');
    setStarlinkNotes('');
    setStarlinkError(null);
    setShowStarlinkModal(true);
  }

  function openEditStarlinkModal(item: StarlinkRemote) {
    setEditingStarlink(item);
    setStarlinkBranchId(item.branch_id);
    setStarlinkName(item.name);
    setStarlinkRemoteUrl(item.remote_url);
    setStarlinkLocalIp(item.local_ip || '192.168.100.1');
    setStarlinkNotes(item.notes || '');
    setStarlinkError(null);
    setShowStarlinkModal(true);
  }

  async function handleSaveStarlink(e: FormEvent) {
    e.preventDefault();
    if (!starlinkBranchId) {
      setStarlinkError('Pilih cabang terlebih dahulu.');
      return;
    }
    setSavingStarlink(true);
    setStarlinkError(null);
    setNotice(null);
    try {
      const payload = {
        branch_id: Number(starlinkBranchId),
        name: starlinkName.trim(),
        remote_url: starlinkRemoteUrl.trim(),
        local_ip: starlinkLocalIp.trim() || '192.168.100.1',
        notes: starlinkNotes.trim(),
      };
      if (editingStarlink) {
        await apiRequest(`/api/starlink-remotes/${editingStarlink.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setNotice(`Remote Starlink "${payload.name}" berhasil diperbarui.`);
      } else {
        await apiRequest('/api/starlink-remotes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotice(`Remote Starlink "${payload.name}" berhasil ditambahkan.`);
      }
      setShowStarlinkModal(false);
      await loadStatus();
    } catch (err) {
      setStarlinkError(
        err instanceof Error ? err.message : 'Gagal menyimpan alamat remote Starlink.'
      );
    } finally {
      setSavingStarlink(false);
    }
  }

  async function handleConfirmRebootStarlink() {
    if (!rebootTarget) return;
    setRebootingStarlink(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        message: string;
        starlink: StarlinkRemote;
      }>(`/api/starlink-remotes/${rebootTarget.id}/reboot`, {
        method: 'POST',
      });
      setStarlinks((prev) =>
        prev.map((item) => (item.id === res.starlink.id ? res.starlink : item))
      );
      setNotice(res.message);
      setRebootTarget(null);
      void loadStarlinkStatuses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim perintah reboot Starlink.');
      setRebootTarget(null);
    } finally {
      setRebootingStarlink(false);
    }
  }

  async function handleConfirmDeleteStarlink() {
    if (!deleteStarlinkTarget) return;
    setDeletingStarlink(true);
    setNotice(null);
    try {
      await apiRequest(`/api/starlink-remotes/${deleteStarlinkTarget.id}`, {
        method: 'DELETE',
      });
      setNotice(`Remote Starlink "${deleteStarlinkTarget.name}" berhasil dihapus.`);
      setDeleteStarlinkTarget(null);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus remote Starlink.');
      setDeleteStarlinkTarget(null);
    } finally {
      setDeletingStarlink(false);
    }
  }

  async function handleTestStarlink(item: StarlinkRemote) {
    setTestingStarlinkId(item.id);
    setError(null);
    setStarlinkTestNotice(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        reachable: boolean;
        grpcReady: boolean;
        online: boolean;
        dishState: StarlinkDishState;
        statusLabel: string;
        uptimeSeconds: number | null;
        uptimeFormatted: string | null;
        mode: 'grpc-http2' | 'grpc-web' | 'web-ui-only' | 'sandbox';
        message: string;
      }>(`/api/starlink-remotes/${item.id}/test`, {
        method: 'POST',
      });
      setStarlinkStatuses((prev) => ({
        ...prev,
        [item.id]: {
          id: item.id,
          online: res.online,
          reachable: res.reachable,
          grpcReady: res.grpcReady,
          dishState: res.dishState,
          statusLabel: res.statusLabel,
          uptimeSeconds: res.uptimeSeconds,
          uptimeFormatted: res.uptimeFormatted,
          mode: res.mode,
          error: res.grpcReady ? null : res.message,
          checkedAt: new Date().toISOString(),
        },
      }));
      setStarlinkTestNotice({
        id: item.id,
        name: item.name,
        grpcReady: res.grpcReady,
        mode: res.mode,
        message:
          res.grpcReady && res.uptimeFormatted
            ? `${res.message} Status: ${res.statusLabel} · Uptime: ${res.uptimeFormatted}.`
            : res.message,
      });
    } catch (err) {
      setStarlinkStatuses((prev) => ({
        ...prev,
        [item.id]: {
          id: item.id,
          online: false,
          reachable: false,
          grpcReady: false,
          dishState: 'OFFLINE',
          statusLabel: 'Offline',
          uptimeSeconds: null,
          uptimeFormatted: null,
          mode: 'grpc-http2',
          error: err instanceof Error ? err.message : 'Tidak terjangkau',
          checkedAt: new Date().toISOString(),
        },
      }));
      setError(err instanceof Error ? err.message : 'Gagal menguji koneksi remote Starlink.');
    } finally {
      setTestingStarlinkId(null);
    }
  }

  function handleQuickPingStarlink(item: StarlinkRemote) {
    const host = extractHostFromUrl(item.remote_url) || item.local_ip;
    if (!host) return;
    if (user.role === 'admin') {
      setSelectedBranchId(item.branch_id);
    }
    setTarget(host);
    pingSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Cek Jaringan, OLT &amp; Uji Ping
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {user.role === 'admin'
              ? 'Pantau status MikroTik, akses web HTTP perangkat OLT, dan jalankan uji ping ke tujuan per cabang.'
              : 'Pantau status MikroTik cabang Anda, buka halaman web HTTP OLT, dan uji ping ke tujuan tertentu.'}
          </p>
        </div>

        <button
          type="button"
          onClick={loadStatus}
          disabled={loading}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Perbarui Status</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 cursor-pointer"
            aria-label="Tutup pemberitahuan"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Status per cabang */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">Status MikroTik &amp; PPPoE</h3>
        </div>
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Belum ada cabang yang dapat diperiksa.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Cabang</th>
                  <th className="py-3 px-4">Alamat Router</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Uptime / CPU</th>
                  <th className="py-3 px-4 text-right">PPPoE Aktif</th>
                  <th className="py-3 px-6 text-right">PPPoE Nonaktif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {branches.map((b) => (
                  <tr key={b.branchId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">{b.branchName}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {b.host}:{b.port} · {formatConnectionMode(b.connectionMode)}
                    </td>
                    <td className="py-3.5 px-4">
                      {b.online ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                          <Wifi className="w-4 h-4 shrink-0" />
                          <span>Online</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
                          <WifiOff className="w-4 h-4 shrink-0" />
                          <span>Offline</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                      {b.online ? `${b.uptime || '-'} · CPU ${b.cpuLoad || '-'}` : b.error || 'Tidak terjangkau'}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {b.activeCount}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono font-medium text-amber-700 dark:text-amber-400 tabular-nums">
                      {b.inactiveCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bagian OLT — Link HTTP menuju OLT */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">Perangkat OLT</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Akses cepat halaman web manajemen HTTP perangkat OLT per cabang atau uji koneksi ping ke IP OLT.
            </p>
          </div>

          {user.role === 'admin' && branches.length > 0 && (
            <button
              type="button"
              onClick={openAddOltModal}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Link OLT</span>
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : olts.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Router className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada link HTTP OLT tersimpan</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              {user.role === 'admin'
                ? 'Tambahkan alamat HTTP manajemen OLT (misalnya http://192.168.10.2 atau http://10.10.1.2:8080) agar teknisi dapat langsung membukanya dari menu ini.'
                : 'Belum ada perangkat OLT yang didaftarkan oleh administrator untuk cabang Anda.'}
            </p>
            {user.role === 'admin' && branches.length > 0 && (
              <button
                type="button"
                onClick={openAddOltModal}
                className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Link OLT Pertama</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Nama OLT</th>
                  <th className="py-3 px-4">Cabang</th>
                  <th className="py-3 px-4">Link HTTP OLT</th>
                  <th className="py-3 px-4">User &amp; Password</th>
                  <th className="py-3 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {olts.map((olt) => (
                  <tr key={olt.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {olt.name}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {olt.branch_name}
                    </td>
                    <td className="py-3.5 px-4">
                      <a
                        href={olt.http_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline whitespace-nowrap"
                      >
                        <Globe className="w-3.5 h-3.5 shrink-0" />
                        <span>{olt.http_url}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono whitespace-nowrap">
                      {olt.login_username || olt.login_password ? (
                        <div className="space-y-0.5">
                          <p className="text-slate-800 dark:text-slate-200">
                            <span className="text-slate-400 dark:text-slate-500 select-none">User: </span>
                            <span>{olt.login_username || '—'}</span>
                          </p>
                          <p className="text-slate-600 dark:text-slate-400">
                            <span className="text-slate-400 dark:text-slate-500 select-none">Pass: </span>
                            <span>{olt.login_password || '—'}</span>
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <a
                          href={olt.http_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                        >
                          <span>Buka OLT</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleQuickPingOlt(olt)}
                          title={`Isi target ping dengan IP/Host ${extractHostFromUrl(olt.http_url)}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          <span>Ping IP</span>
                        </button>
                        {user.role === 'admin' && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditOltModal(olt)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                              aria-label={`Edit OLT ${olt.name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteOltTarget(olt)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                              aria-label={`Hapus OLT ${olt.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tool Cek Ping dari MikroTik */}
      {branches.length > 0 && (
        <section
          ref={pingSectionRef}
          className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] p-6 space-y-5"
        >
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">Uji Ping dari Router MikroTik</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Mengirim paket ICMP Ping langsung dari router MikroTik cabang menuju IP atau host tujuan.
            </p>
          </div>

          <form onSubmit={handleRunPing} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            {user.role === 'admin' ? (
              <div className="md:col-span-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cabang Router</label>
                <select
                  value={selectedBranchId ?? ''}
                  onChange={(e) => setSelectedBranchId(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName} ({b.online ? 'Online' : 'Offline'})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="md:col-span-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cabang Router</label>
                <input
                  type="text"
                  readOnly
                  value={branches[0]?.branchName || user.branch_name || '-'}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-700 dark:text-slate-300"
                />
              </div>
            )}

            <div className="md:col-span-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Alamat Tujuan (IP / Domain)</label>
              <input
                type="text"
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="8.8.8.8 atau 172.16.10.1"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Jumlah Paket</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={4}>4 paket</option>
                <option value={6}>6 paket</option>
                <option value={10}>10 paket</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={pinging}
                className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Activity className="w-4 h-4" />
                <span>{pinging ? 'Menguji...' : 'Jalankan Ping'}</span>
              </button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Tujuan cepat:</span>
            {['8.8.8.8', '1.1.1.1', 'google.com', 'shopee.co.id'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTarget(preset)}
                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-mono text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>

          {pingError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {pingError}
            </div>
          )}

          {pingResult && (
            <div className="border-t border-slate-200 dark:border-slate-800 pt-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Terkirim / Diterima</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {pingResult.received} / {pingResult.sent}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Packet Loss</p>
                  <p
                    className={`text-lg font-bold font-mono tabular-nums mt-1 ${
                      pingResult.packetLossPct === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {pingResult.packetLossPct}%
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Rata-rata RTT</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {pingResult.avgRttMs !== null ? `${pingResult.avgRttMs} ms` : '—'}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/60">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Min / Max RTT</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {pingResult.minRttMs !== null && pingResult.maxRttMs !== null
                      ? `${pingResult.minRttMs} / ${pingResult.maxRttMs} ms`
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 px-4">Seq</th>
                      <th className="py-2.5 px-4">Host</th>
                      <th className="py-2.5 px-4 text-right">Size</th>
                      <th className="py-2.5 px-4 text-right">TTL</th>
                      <th className="py-2.5 px-4 text-right">Waktu</th>
                      <th className="py-2.5 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono text-xs tabular-nums">
                    {pingResult.packets.map((pkt) => (
                      <tr key={pkt.seq}>
                        <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">{pkt.seq}</td>
                        <td className="py-2.5 px-4 text-slate-900 dark:text-slate-100">{pkt.host}</td>
                        <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-400">{pkt.size ?? '—'}</td>
                        <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-400">{pkt.ttl ?? '—'}</td>
                        <td className="py-2.5 px-4 text-right text-slate-900 dark:text-slate-100 font-medium">
                          {pkt.timeMs !== null ? `${pkt.timeMs} ms` : '—'}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={
                              pkt.timeMs !== null ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-red-600 dark:text-red-400 font-medium'
                            }
                          >
                            {pkt.timeMs !== null ? 'Diterima' : pkt.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Bagian Reboot Starlink */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Reboot Starlink
            </h3>
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-1 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>WARNING: Reboot Starlink hanya dilakukan saat hasil cek ping di atas 180 ms.</span>
            </p>
          </div>

          {user.role === 'admin' && branches.length > 0 && (
            <button
              type="button"
              onClick={openAddStarlinkModal}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Remote Starlink</span>
            </button>
          )}
        </div>

        {starlinkTestNotice && (
          <div
            className={`mx-6 mt-4 rounded-lg border px-4 py-3 text-sm flex items-start justify-between gap-3 ${
              starlinkTestNotice.grpcReady
                ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200'
                : 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {starlinkTestNotice.grpcReady ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-medium">
                  Hasil Tes Koneksi: {starlinkTestNotice.name}
                </p>
                <p className="text-xs mt-0.5 leading-relaxed opacity-90">
                  {starlinkTestNotice.grpcReady
                    ? 'Starlink merespon dan siap untuk perintah reboot.'
                    : starlinkTestNotice.message}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStarlinkTestNotice(null)}
              className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              aria-label="Tutup hasil tes Starlink"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : starlinks.length === 0 ? (
          <div className="p-8 text-center">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Satellite className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Belum ada alamat remote Starlink tersimpan
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
              {user.role === 'admin'
                ? 'Tambahkan alamat remote yang sudah diarahkan ke IP lokal Starlink (mis. http://remote.domain.id:9200) agar dapat melakukan reboot langsung dari panel ini.'
                : 'Belum ada remote Starlink yang didaftarkan oleh administrator untuk cabang Anda.'}
            </p>
            {user.role === 'admin' && branches.length > 0 && (
              <button
                type="button"
                onClick={openAddStarlinkModal}
                className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Remote Starlink Pertama</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Perangkat Starlink</th>
                  <th className="py-3 px-4">Cabang</th>
                  <th className="py-3 px-4">Alamat Remote</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Uptime</th>
                  <th className="py-3 px-4">Reboot Terakhir</th>
                  <th className="py-3 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {starlinks.map((item) => {
                  const st = starlinkStatuses[item.id];
                  const isChecking = loadingStarlinkStatuses && !st;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3.5 px-6">
                        <p className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">{item.name}</p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {item.branch_name}
                      </td>
                      <td className="py-3.5 px-4">
                        <a
                          href={item.remote_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline whitespace-nowrap"
                        >
                          <Globe className="w-3.5 h-3.5 shrink-0" />
                          <span>{item.remote_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isChecking ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span>Memeriksa...</span>
                          </span>
                        ) : st?.online ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                            <Wifi className="w-4 h-4 shrink-0" />
                            <span>{st.statusLabel}</span>
                          </span>
                        ) : st?.dishState === 'SEARCHING' || st?.dishState === 'BOOTING' || st?.dishState === 'WEB_UI_ONLY' ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>{st.statusLabel}</span>
                          </span>
                        ) : st ? (
                          <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
                            <WifiOff className="w-4 h-4 shrink-0" />
                            <span>{st.statusLabel}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        {isChecking ? (
                          <span className="text-slate-400 dark:text-slate-500">...</span>
                        ) : st?.uptimeFormatted ? (
                          <span className="text-slate-700 dark:text-slate-300">{st.uptimeFormatted}</span>
                        ) : st && !st.online ? (
                          <span
                            className="inline-block max-w-[200px] truncate align-bottom text-slate-500 dark:text-slate-400 font-sans"
                            title={st.error || 'Tidak terjangkau'}
                          >
                            {st.error || 'Tidak terjangkau'}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {item.last_reboot_at ? (
                          <div>
                            <p className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                              {formatDateTime(item.last_reboot_at)}
                            </p>
                            {item.last_reboot_by && (
                              <p className="text-slate-500 dark:text-slate-400 mt-0.5">Oleh {item.last_reboot_by}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Belum pernah</span>
                        )}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setRebootTarget(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span>Reboot Starlink</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTestStarlink(item)}
                            disabled={testingStarlinkId === item.id}
                            title="Uji apakah remote sudah mengarah ke port gRPC-Web 9200 atau masih port 80"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-60"
                          >
                            <PlugZap className="w-3.5 h-3.5" />
                            <span>{testingStarlinkId === item.id ? 'Menguji...' : 'Tes Koneksi'}</span>
                          </button>
                          {user.role === 'admin' && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditStarlinkModal(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                                aria-label={`Edit Starlink ${item.name}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteStarlinkTarget(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                                aria-label={`Hapus Starlink ${item.name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL TAMBAH / EDIT LINK OLT */}
      {showOltModal && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingOlt ? 'Edit Link HTTP OLT' : 'Tambah Link HTTP OLT'}
              </h3>
              <button
                type="button"
                onClick={() => setShowOltModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOlt} className="p-6 space-y-4">
              {oltError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {oltError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                <select
                  required
                  value={oltBranchId}
                  onChange={(e) => setOltBranchId(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="" disabled>
                    Pilih cabang...
                  </option>
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama OLT</label>
                <input
                  type="text"
                  required
                  value={oltName}
                  onChange={(e) => setOltName(e.target.value)}
                  placeholder="Contoh: OLT Pusat - ZTE C320"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Link HTTP Menuju OLT
                </label>
                <input
                  type="text"
                  required
                  value={oltHttpUrl}
                  onChange={(e) => setOltHttpUrl(e.target.value)}
                  placeholder="http://192.168.10.2 atau http://10.10.1.2:8080"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Masukkan alamat IP/domain atau URL HTTP OLT (otomatis diawali <span className="font-mono">http://</span> bila belum diisi).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    User OLT
                  </label>
                  <input
                    type="text"
                    value={oltLoginUsername}
                    onChange={(e) => setOltLoginUsername(e.target.value)}
                    placeholder="Contoh: admin"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Password OLT
                  </label>
                  <input
                    type="text"
                    value={oltLoginPassword}
                    onChange={(e) => setOltLoginPassword(e.target.value)}
                    placeholder="Contoh: admin123"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowOltModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingOlt}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingOlt ? 'Menyimpan...' : editingOlt ? 'Simpan Perubahan' : 'Simpan OLT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL HAPUS OLT */}
      {deleteOltTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Link OLT</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Link OLT <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteOltTarget.name}</span>{' '}
              (<span className="font-mono text-xs">{deleteOltTarget.http_url}</span>) dari cabang{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">{deleteOltTarget.branch_name}</span> akan
              dihapus.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteOltTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteOlt}
                disabled={deletingOlt}
                className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                {deletingOlt ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TAMBAH / EDIT REMOTE STARLINK */}
      {showStarlinkModal && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingStarlink ? 'Edit Remote Starlink' : 'Tambah Remote Starlink'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStarlinkModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStarlink} className="p-6 space-y-4">
              {starlinkError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {starlinkError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                <select
                  required
                  value={starlinkBranchId}
                  onChange={(e) => setStarlinkBranchId(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="" disabled>
                    Pilih cabang...
                  </option>
                  {branches.map((b) => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nama Perangkat Starlink
                </label>
                <input
                  type="text"
                  required
                  value={starlinkName}
                  onChange={(e) => setStarlinkName(e.target.value)}
                  placeholder="Contoh: Starlink Utama Cabang Barat"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Alamat Remote Menuju Starlink
                </label>
                <input
                  type="text"
                  required
                  value={starlinkRemoteUrl}
                  onChange={(e) => setStarlinkRemoteUrl(e.target.value)}
                  placeholder="http://10.17.0.44:8760"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  Pada MikroTik <span className="font-medium text-slate-700 dark:text-slate-300">IP &gt; Firewall &gt; NAT</span> (<span className="font-mono">dst-nat</span> ke <span className="font-mono">192.168.100.1</span>): arahkan <span className="font-mono font-medium text-slate-700 dark:text-slate-300">To Ports: 9200</span> (gRPC HTTP/2) atau <span className="font-mono">9201</span> (gRPC-Web), serta pastikan ada rule <span className="font-mono">chain=srcnat dst-address=192.168.100.1 action=masquerade</span> dan alamat remote dapat diakses oleh server aplikasi.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  value={starlinkNotes}
                  onChange={(e) => setStarlinkNotes(e.target.value)}
                  placeholder="Contoh: Upstream WAN 1 · Port Forward MikroTik"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowStarlinkModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingStarlink}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingStarlink
                    ? 'Menyimpan...'
                    : editingStarlink
                      ? 'Simpan Perubahan'
                      : 'Simpan Remote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI REBOOT STARLINK */}
      {rebootTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Konfirmasi Reboot Starlink
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{rebootTarget.branch_name}</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 p-3.5 text-xs space-y-1">
              <p className="font-medium text-slate-900 dark:text-slate-100">{rebootTarget.name}</p>
              <p className="font-mono text-slate-600 dark:text-slate-400">Remote: {rebootTarget.remote_url}</p>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Perangkat Starlink akan dimulai ulang dan koneksi internet upstream cabang ini akan terputus sementara sekitar 2–3 menit. Lanjutkan reboot?
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRebootTarget(null)}
                disabled={rebootingStarlink}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRebootStarlink}
                disabled={rebootingStarlink}
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                <Power className="w-4 h-4" />
                <span>{rebootingStarlink ? 'Mengirim Perintah...' : 'Ya, Reboot Starlink'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HAPUS REMOTE STARLINK */}
      {deleteStarlinkTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Remote Starlink</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Remote Starlink{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteStarlinkTarget.name}</span> (
              <span className="font-mono text-xs">{deleteStarlinkTarget.remote_url}</span>) dari
              cabang <span className="font-medium text-slate-800 dark:text-slate-200">{deleteStarlinkTarget.branch_name}</span>{' '}
              akan dihapus.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteStarlinkTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteStarlink}
                disabled={deletingStarlink}
                className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                {deletingStarlink ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
