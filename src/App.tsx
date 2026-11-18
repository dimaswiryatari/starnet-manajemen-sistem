import { useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  Router,
  ShieldCheck,
  Sun,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { apiRequest, getStoredToken, setStoredToken } from './api';
import { AdminAccountView } from './components/AdminAccountView';
import { BranchesView } from './components/BranchesView';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { FinanceView } from './components/FinanceView';
import { LoginView } from './components/LoginView';
import { NetworkCheckView } from './components/NetworkCheckView';
import { OnuCustomersView } from './components/OnuCustomersView';
import { PackagesView } from './components/PackagesView';
import { StaffAccountsView } from './components/StaffAccountsView';
import type { AuthUser } from './types';

interface NavItem {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const ADMIN_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'branches', label: 'Cabang', icon: Building2 },
  { id: 'packages', label: 'Paket Internet', icon: Gauge },
  { id: 'customers', label: 'Pelanggan', icon: Users },
  { id: 'onu', label: 'ONU Pelanggan', icon: Router },
  { id: 'finance', label: 'Keuangan', icon: Wallet },
  { id: 'staff', label: 'Akun Staf', icon: UserCog },
  { id: 'account', label: 'Akun', icon: ShieldCheck },
  { id: 'network', label: 'Cek Jaringan', icon: Activity },
];

const STAFF_NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'packages', label: 'Paket Internet', icon: Gauge },
  { id: 'customers', label: 'Pelanggan', icon: Users },
  { id: 'onu', label: 'ONU Pelanggan', icon: Router },
  { id: 'finance', label: 'Keuangan', icon: Wallet },
  { id: 'network', label: 'Cek Jaringan', icon: Activity },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [customerStatusFilter, setCustomerStatusFilter] = useState<'all' | 'aktif' | 'tidak_aktif'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem('starnet_theme') === 'dark' ||
        document.documentElement.classList.contains('dark')
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('starnet_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  useEffect(() => {
    async function verifySession() {
      const token = getStoredToken();
      if (!token) {
        // Also try cookie-based session
        try {
          const res = await apiRequest<{ user: AuthUser }>('/api/auth/me');
          setUser(res.user);
        } catch {
          setUser(null);
        } finally {
          setCheckingAuth(false);
        }
        return;
      }

      try {
        const res = await apiRequest<{ user: AuthUser }>('/api/auth/me');
        setUser(res.user);
      } catch {
        setStoredToken(null);
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    }

    verifySession();
  }, []);

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setActiveTab('dashboard');
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-sm text-slate-500 dark:text-slate-400">Memuat sesi Starnet Management System...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        onSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          setActiveTab('dashboard');
        }}
      />
    );
  }

  const navItems = user.role === 'admin' ? ADMIN_NAV : STAFF_NAV;
  const currentNav = navItems.find((n) => n.id === activeTab) || navItems[0];

  function selectTab(
    id: string,
    options?: { customerStatusFilter?: 'all' | 'aktif' | 'tidak_aktif' }
  ) {
    setCustomerStatusFilter(options?.customerStatusFilter ?? 'all');
    setActiveTab(id);
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:flex-col w-[276px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shrink-0 print:hidden">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Network className="w-4 h-4" />
          </div>
          <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 tracking-tight whitespace-nowrap truncate">
            Starnet Management System
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentNav.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 h-10 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.full_name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {user.role === 'admin' ? 'Administrator' : `Staf · ${user.branch_name || 'Tanpa Cabang'}`}
            </p>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 dark:bg-slate-950/75"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                  <Network className="w-4 h-4" />
                </div>
                <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                  Starnet Management System
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg"
                aria-label="Tutup menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentNav.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 h-11 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 flex items-center justify-between gap-4 shrink-0 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-lg"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">
                {user.role === 'staff' ? user.branch_name || 'Cabang Staf' : 'Semua Cabang'}
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{currentNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-tight">{user.full_name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {user.role === 'admin' ? 'Admin' : `Staf · ${user.branch_name || '-'}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-label={darkMode ? 'Beralih ke Mode Siang' : 'Beralih ke Mode Malam'}
              title={darkMode ? 'Mode Siang' : 'Mode Malam'}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
              <span className="hidden md:inline">{darkMode ? 'Mode Siang' : 'Mode Malam'}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Keluar</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {currentNav.id === 'dashboard' && (
            <DashboardView user={user} onNavigate={selectTab} />
          )}
          {currentNav.id === 'branches' && user.role === 'admin' && <BranchesView />}
          {currentNav.id === 'packages' && <PackagesView user={user} />}
          {currentNav.id === 'customers' && (
            <CustomersView user={user} initialStatusFilter={customerStatusFilter} />
          )}
          {currentNav.id === 'onu' && <OnuCustomersView user={user} />}
          {currentNav.id === 'finance' && <FinanceView user={user} />}
          {currentNav.id === 'staff' && user.role === 'admin' && <StaffAccountsView />}
          {currentNav.id === 'account' && user.role === 'admin' && (
            <AdminAccountView user={user} onUserUpdated={setUser} />
          )}
          {currentNav.id === 'network' && <NetworkCheckView user={user} />}
        </main>
      </div>
    </div>
  );
}
