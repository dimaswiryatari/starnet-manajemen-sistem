import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { apiRequest } from '../api';
import type { Branch, StaffAccount } from '../types';
import { formatDateTime } from '../utils/format';

export function StaffAccountsView() {
  const [staffList, setStaffList] = useState<StaffAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingStaff, setEditingStaff] = useState<StaffAccount | null>(null);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [staffRes, branchRes] = await Promise.all([
        apiRequest<{ staff: StaffAccount[] }>('/api/staff'),
        apiRequest<{ branches: Branch[] }>('/api/branches'),
      ]);
      setStaffList(staffRes.staff);
      setBranches(branchRes.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data akun staf.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreate() {
    setModalMode('create');
    setEditingStaff(null);
    setFullName('');
    setUsername('');
    setPassword('');
    setBranchId(branches[0] ? String(branches[0].id) : '');
    setIsActive(true);
    setFormError(null);
  }

  function openEdit(staf: StaffAccount) {
    setModalMode('edit');
    setEditingStaff(staf);
    setFullName(staf.full_name);
    setUsername(staf.username);
    setPassword('');
    setBranchId(staf.branch_id ? String(staf.branch_id) : branches[0] ? String(branches[0].id) : '');
    setIsActive(staf.is_active === 1);
    setFormError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError('Pilih cabang tempat staf bertugas.');
      return;
    }
    setSaving(true);
    try {
      if (modalMode === 'create') {
        await apiRequest('/api/staff', {
          method: 'POST',
          body: JSON.stringify({
            full_name: fullName.trim(),
            username: username.trim(),
            password,
            branch_id: Number(branchId),
            is_active: isActive,
          }),
        });
      } else if (modalMode === 'edit' && editingStaff) {
        await apiRequest(`/api/staff/${editingStaff.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            full_name: fullName.trim(),
            username: username.trim(),
            password: password.trim() || undefined,
            branch_id: Number(branchId),
            is_active: isActive,
          }),
        });
      }
      setModalMode(null);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan akun staf.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Akun Staf Cabang</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Buat dan kelola akun operator staf beserta cabang MikroTik yang menjadi hak aksesnya.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          disabled={branches.length === 0}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Buat Akun Staf</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {branches.length === 0 && !loading && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Tambahkan minimal satu cabang di Menu Cabang sebelum membuat akun staf.
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada akun staf</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Buat akun staf agar teknisi atau admin cabang dapat mengelola PPPoE di cabangnya masing-masing.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Nama Lengkap</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Cabang Ditugaskan</th>
                  <th className="py-3 px-4">Status Akun</th>
                  <th className="py-3 px-4">Diperbarui</th>
                  <th className="py-3 px-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {staffList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">{s.full_name}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300">{s.username}</td>
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                      {s.branch_name || (
                        <span className="text-amber-700 dark:text-amber-400">Belum ditugaskan</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`font-medium ${
                          s.is_active === 1 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {s.is_active === 1 ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {formatDateTime(s.updated_at)}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Buat / Edit Staf */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {modalMode === 'create' ? 'Buat Akun Staf Baru' : 'Edit Akun Staf'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 rounded-lg cursor-pointer"
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

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Andi Wijaya"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="staf_utara"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {modalMode === 'create' ? 'Password' : 'Password Baru (kosongkan jika tidak diubah)'}
                </label>
                <input
                  type="password"
                  required={modalMode === 'create'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={modalMode === 'create' ? 'Minimal 5 karakter' : '••••••••'}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang Staf</label>
                <select
                  required
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="" disabled>
                    Pilih cabang
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  id="staff-active-toggle"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600"
                />
                <label htmlFor="staff-active-toggle" className="text-sm text-slate-700 dark:text-slate-300">
                  Akun aktif dan diizinkan masuk
                </label>
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
                  {saving ? 'Menyimpan...' : modalMode === 'create' ? 'Buat Akun' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
