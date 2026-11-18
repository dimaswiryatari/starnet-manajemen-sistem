import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, Moon, Network, Sun, User } from 'lucide-react';
import { apiRequest, setStoredToken } from '../api';
import type { AuthUser } from '../types';

interface LoginViewProps {
  onSuccess: (user: AuthUser) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function LoginView({ onSuccess, darkMode, onToggleDarkMode }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal masuk ke sistem.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-12 bg-[#f4f6fa] dark:bg-slate-950">
      {/* Left Architectural Operations Panel */}
      <div className="hidden lg:flex lg:col-span-5 bg-[#0b1120] border-r border-transparent dark:border-slate-800/80 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(37,99,235,0.45)]">
            <Network className="w-5 h-5" />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-white">
            Starnet Management System
          </span>
        </div>

        <div className="relative z-10 space-y-8 my-auto py-10">
          <div className="space-y-3 max-w-md">
            <h1 className="font-display text-3xl font-bold tracking-tight text-white leading-snug">
              Kendali terpadu jaringan RT/RW Net multi-cabang.
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Satu panel operasional untuk memantau router MikroTik, manajemen optik OLT &amp; ONU, pelanggan PPPoE, serta arus kas penagihan otomatis.
            </p>
          </div>

          <div className="border-t border-white/10 pt-6 space-y-5 max-w-md">
            <div>
              <p className="text-sm font-semibold text-white">Monitoring MikroTik &amp; PPPoE Real-Time</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Sinkronisasi langsung secret PPPoE, batas kecepatan paket, dan uji ping dari router tiap cabang.
              </p>
            </div>
            <div className="border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-white">Manajemen Perangkat OLT &amp; Akses HTTP</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Pantau port PON, redaman optik dBm, registrasi ONU, serta akses cepat halaman web OLT.
              </p>
            </div>
            <div className="border-t border-white/10 pt-4">
              <p className="text-sm font-semibold text-white">Keuangan, Isolir Otomatis &amp; Penagihan WhatsApp</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Penerbitan tagihan otomatis tanggal 1, isolir jatuh tempo, serta kirim tagihan dengan template WhatsApp kustom.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-slate-500">
          Starnet Operations Console · Multi-Branch MikroTik &amp; OLT
        </div>
      </div>

      {/* Right Authentication Area */}
      <div className="lg:col-span-7 relative flex flex-col justify-center items-center px-4 py-12 sm:px-8">
        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={darkMode ? 'Beralih ke Mode Siang' : 'Beralih ke Mode Malam'}
          className="absolute top-5 right-5 inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
        >
          {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
          <span>{darkMode ? 'Mode Siang' : 'Mode Malam'}</span>
        </button>

        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-8 shadow-[0_8px_30px_rgba(15,23,42,0.04)] dark:shadow-none">
          <div className="flex lg:hidden items-center gap-3 mb-6 pb-6 border-b border-slate-200 dark:border-slate-800">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Starnet Management System
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Manajemen Multi-Cabang RT/RW Net</p>
            </div>
          </div>

          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Masuk ke Panel Operasi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-6">
            Gunakan akun Administrator atau Staf cabang untuk mengelola jaringan dan pelanggan.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Username
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan username"
                  className="w-full h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="w-full h-11 pl-10 pr-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 rounded cursor-pointer"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium shadow-[0_1px_2px_rgba(37,99,235,0.25)] transition-colors whitespace-nowrap cursor-pointer"
            >
              {loading ? 'Memverifikasi...' : 'Masuk'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-medium text-slate-700 dark:text-slate-300">Semangat Menjadi ISP</p>
            <p className="text-slate-400 dark:text-slate-500">
              Bangun infrastruktur jaringan yang stabil, profesional, dan terpercaya untuk melayani setiap pelanggan.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
