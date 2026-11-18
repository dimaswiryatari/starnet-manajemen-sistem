import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { apiRequest } from '../api';
import type {
  AuthUser,
  BillingAutomationSettings,
  Branch,
  BranchBillingAutomationSettings,
  CustomerInvoice,
  FinanceSummary,
  FinanceTransaction,
  MonthlyFinanceTrend,
  PackageTariff,
  PppoeCustomer,
} from '../types';
import {
  buildInvoiceWhatsAppMessage,
  buildWhatsAppUrl,
  DEFAULT_WA_TEMPLATE_PAID,
  DEFAULT_WA_TEMPLATE_UNPAID,
  formatDateTime,
  formatPeriodLabel,
  formatPeriodShort,
  formatRupiah,
  formatShortDate,
  formatWhatsAppDisplay,
  normalizeWhatsAppDigits,
  renderInvoiceTemplateText,
  WA_TEMPLATE_PLACEHOLDERS,
} from '../utils/format';

interface FinanceViewProps {
  user: AuthUser;
}

function getCurrentMonthValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getTodayDateValue(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultDateForPeriod(period: string): string {
  if (period === 'all' || period === getCurrentMonthValue()) {
    return getTodayDateValue();
  }
  const [yStr, mStr] = period.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m) {
    return getTodayDateValue();
  }
  const lastDay = new Date(y, m, 0).getDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

const EXPENSE_CATEGORIES = [
  'Bandwidth Upstream',
  'Perawatan Jaringan & ODP',
  'Listrik & Sewa Tempat',
  'Alat & Router/ONT',
  'Gaji Teknisi',
  'Operasional Lainnya',
];

const INCOME_CATEGORIES = [
  'Biaya Pasang Baru (PSB)',
  'Penjualan Voucher',
  'Penjualan Perangkat',
  'Pemasukan Lainnya',
];

const PAYMENT_METHODS = ['Tunai', 'Transfer Bank', 'QRIS', 'E-Wallet'];

export function FinanceView({ user }: FinanceViewProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>(
    user.role === 'staff' && user.branch_id ? String(user.branch_id) : 'all'
  );
  const [monthPeriod, setMonthPeriod] = useState<string>(getCurrentMonthValue);
  const [period, setPeriod] = useState<string>(getCurrentMonthValue);
  const isAllPeriods = period === 'all';
  const [activeSubTab, setActiveSubTab] = useState<'invoices' | 'cashflow' | 'tariffs'>('invoices');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [summary, setSummary] = useState<FinanceSummary>({
    totalPaidInvoices: 0,
    totalOtherIncome: 0,
    totalIncome: 0,
    totalExpense: 0,
    netProfit: 0,
    unpaidAmount: 0,
    paidCount: 0,
    unpaidCount: 0,
  });
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyFinanceTrend[]>([]);
  const [modalInvoicePeriod, setModalInvoicePeriod] = useState<string>(getCurrentMonthValue);

  // Filters
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'all' | 'belum_bayar' | 'lunas'>('all');
  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState<'all' | 'pemasukan' | 'pengeluaran'>('all');

  // Tariffs state
  const [tariffBranchId, setTariffBranchId] = useState<number | null>(user.branch_id);
  const [tariffs, setTariffs] = useState<PackageTariff[]>([]);
  const [tariffDrafts, setTariffDrafts] = useState<Record<string, string>>({});
  const [loadingTariffs, setLoadingTariffs] = useState(false);
  const [savingTariffs, setSavingTariffs] = useState(false);

  // Generate Invoices Modal
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateBranchId, setGenerateBranchId] = useState<number | null>(user.branch_id);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Manual Invoice Modal
  const [showManualInvModal, setShowManualInvModal] = useState(false);
  const [manualBranchId, setManualBranchId] = useState<number | null>(user.branch_id);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [manualProfileName, setManualProfileName] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualTariffOptions, setManualTariffOptions] = useState<PackageTariff[]>([]);
  const [manualCustomerOptions, setManualCustomerOptions] = useState<PppoeCustomer[]>([]);
  const [loadingManualCustomers, setLoadingManualCustomers] = useState(false);
  const [manualCustomerCustomMode, setManualCustomerCustomMode] = useState(false);
  const [savingManualInv, setSavingManualInv] = useState(false);
  const [manualInvError, setManualInvError] = useState<string | null>(null);

  // Pay Invoice Modal
  const [payTarget, setPayTarget] = useState<CustomerInvoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('Tunai');
  const [payDate, setPayDate] = useState(getTodayDateValue);
  const [payNotes, setPayNotes] = useState('');
  const [savingPay, setSavingPay] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Receipt Modal
  const [receiptTarget, setReceiptTarget] = useState<CustomerInvoice | null>(null);

  // Cashflow Transaction Modal
  const [showTxModal, setShowTxModal] = useState(false);
  const [txBranchId, setTxBranchId] = useState<number | null>(user.branch_id);
  const [txType, setTxType] = useState<'pemasukan' | 'pengeluaran'>('pengeluaran');
  const [txCategory, setTxCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [txDescription, setTxDescription] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState(getTodayDateValue);
  const [txMethod, setTxMethod] = useState('Tunai');
  const [savingTx, setSavingTx] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // Delete confirmations
  const [deleteInvTarget, setDeleteInvTarget] = useState<CustomerInvoice | null>(null);
  const [deleteTxTarget, setDeleteTxTarget] = useState<FinanceTransaction | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Automation settings & modal
  const [automationSettings, setAutomationSettings] = useState<BillingAutomationSettings>({
    auto_invoice_enabled: true,
    auto_isolir_enabled: true,
    isolir_cutoff_day: 5,
    isolir_profile_name: 'profile-isolir',
    updated_at: '',
  });
  const [branchAutomationSettings, setBranchAutomationSettings] = useState<
    BranchBillingAutomationSettings[]
  >([]);
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoBranchId, setAutoBranchId] = useState<number | null>(user.branch_id);
  const [draftAutoInvoice, setDraftAutoInvoice] = useState(true);
  const [draftAutoIsolir, setDraftAutoIsolir] = useState(true);
  const [draftCutoffDay, setDraftCutoffDay] = useState('5');
  const [draftIsolirProfile, setDraftIsolirProfile] = useState('profile-isolir');
  const [savingAuto, setSavingAuto] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);

  // WhatsApp notification & quick number modal
  const [waTarget, setWaTarget] = useState<CustomerInvoice | null>(null);
  const [waNumberInput, setWaNumberInput] = useState('');
  const [waMessageInput, setWaMessageInput] = useState('');
  const [savingWa, setSavingWa] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  const [copiedWa, setCopiedWa] = useState(false);

  // WhatsApp template customization modal
  const [showWaTemplateModal, setShowWaTemplateModal] = useState(false);
  const [waTemplateTab, setWaTemplateTab] = useState<'unpaid' | 'paid'>('unpaid');
  const [draftTemplateUnpaid, setDraftTemplateUnpaid] = useState(DEFAULT_WA_TEMPLATE_UNPAID);
  const [draftTemplatePaid, setDraftTemplatePaid] = useState(DEFAULT_WA_TEMPLATE_PAID);
  const [savingWaTemplate, setSavingWaTemplate] = useState(false);
  const [waTemplateError, setWaTemplateError] = useState<string | null>(null);
  const waTemplateTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    async function initBranches() {
      try {
        const res = await apiRequest<{ branches: Branch[] }>('/api/branches');
        setBranches(res.branches);
        if (user.role === 'staff') {
          const sid = user.branch_id;
          setSelectedBranchFilter(sid ? String(sid) : '');
          setTariffBranchId(sid);
          setGenerateBranchId(sid);
          setManualBranchId(sid);
          setTxBranchId(sid);
        } else if (res.branches.length > 0) {
          const firstId = res.branches[0].id;
          setTariffBranchId((prev) => prev ?? firstId);
          setGenerateBranchId((prev) => prev ?? firstId);
          setManualBranchId((prev) => prev ?? firstId);
          setTxBranchId((prev) => prev ?? firstId);
        }
      } catch {
        // handled by loadFinance
      }
    }
    initBranches();
  }, [user.branch_id, user.role]);

  const loadFinance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        period,
        branchId: selectedBranchFilter || 'all',
      });
      const res = await apiRequest<{
        period: string;
        automationSettings?: BillingAutomationSettings;
        branchAutomationSettings?: BranchBillingAutomationSettings[];
        summary: FinanceSummary;
        invoices: CustomerInvoice[];
        transactions: FinanceTransaction[];
        monthlyTrend?: MonthlyFinanceTrend[];
      }>(`/api/finance/summary?${qs.toString()}`);
      setSummary(res.summary);
      setInvoices(res.invoices);
      setTransactions(res.transactions);
      setMonthlyTrend(res.monthlyTrend || []);
      if (res.automationSettings) {
        setAutomationSettings(res.automationSettings);
      }
      if (res.branchAutomationSettings) {
        setBranchAutomationSettings(res.branchAutomationSettings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data keuangan.');
    } finally {
      setLoading(false);
    }
  }, [period, selectedBranchFilter]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const loadTariffs = useCallback(async (branchId: number) => {
    setLoadingTariffs(true);
    try {
      const res = await apiRequest<{
        online: boolean;
        error: string | null;
        tariffs: PackageTariff[];
      }>(`/api/branches/${branchId}/finance/tariffs`);
      setTariffs(res.tariffs);
      const drafts: Record<string, string> = {};
      for (const t of res.tariffs) {
        drafts[t.profileName] = String(t.priceIdr);
      }
      setTariffDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat tarif paket cabang.');
    } finally {
      setLoadingTariffs(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'tariffs' && tariffBranchId) {
      loadTariffs(tariffBranchId);
    }
  }, [activeSubTab, tariffBranchId, loadTariffs]);

  // Keep tariffBranchId synced when user selects a specific branch filter
  useEffect(() => {
    if (selectedBranchFilter !== 'all' && selectedBranchFilter !== '') {
      const num = Number(selectedBranchFilter);
      if (!Number.isNaN(num)) {
        setTariffBranchId(num);
        setGenerateBranchId(num);
        setManualBranchId(num);
        setTxBranchId(num);
      }
    }
  }, [selectedBranchFilter]);

  async function handleSaveTariffs(e: FormEvent) {
    e.preventDefault();
    if (!tariffBranchId || user.role !== 'admin') return;
    setSavingTariffs(true);
    setError(null);
    setNotice(null);
    try {
      const items = tariffs.map((t) => ({
        profileName: t.profileName,
        priceIdr: Math.max(0, Math.round(Number(tariffDrafts[t.profileName] || 0))),
      }));
      await apiRequest(`/api/branches/${tariffBranchId}/finance/tariffs`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      setNotice('Tarif bulanan paket internet berhasil disimpan.');
      await loadTariffs(tariffBranchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan tarif paket.');
    } finally {
      setSavingTariffs(false);
    }
  }

  function openGenerateModal() {
    const defaultId =
      selectedBranchFilter !== 'all' && selectedBranchFilter !== ''
        ? Number(selectedBranchFilter)
        : branches[0]?.id ?? null;
    setGenerateBranchId(defaultId);
    setModalInvoicePeriod(isAllPeriods ? monthPeriod : period);
    setGenerateError(null);
    setShowGenerateModal(true);
  }

  async function handleGenerateInvoices(e: FormEvent) {
    e.preventDefault();
    if (!generateBranchId) return;
    setGenerating(true);
    setGenerateError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        createdCount: number;
        skippedCount: number;
      }>(`/api/branches/${generateBranchId}/finance/invoices/generate`, {
        method: 'POST',
        body: JSON.stringify({ period: modalInvoicePeriod }),
      });
      setShowGenerateModal(false);
      setNotice(
        `Tagihan periode ${formatPeriodLabel(modalInvoicePeriod)} dibuat: ${res.createdCount} tagihan baru (${res.skippedCount} sudah ada / dilewati).`
      );
      await loadFinance();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Gagal membuat tagihan otomatis.');
    } finally {
      setGenerating(false);
    }
  }

  async function loadManualBranchTariffs(branchId: number) {
    setLoadingManualCustomers(true);
    setManualCustomerOptions([]);
    try {
      const [tariffRes, custRes] = await Promise.allSettled([
        apiRequest<{ tariffs: PackageTariff[] }>(
          `/api/branches/${branchId}/finance/tariffs`
        ),
        apiRequest<{ customers: PppoeCustomer[] }>(
          `/api/branches/${branchId}/customers`
        ),
      ]);

      if (tariffRes.status === 'fulfilled') {
        const tariffsList = tariffRes.value.tariffs;
        setManualTariffOptions(tariffsList);
        const firstNonIsolir =
          tariffsList.find((t) => t.profileName.toLowerCase() !== 'isolir') || tariffsList[0];
        if (firstNonIsolir) {
          setManualProfileName(firstNonIsolir.profileName);
          setManualAmount(String(firstNonIsolir.priceIdr || ''));
        }
      } else {
        setManualTariffOptions([]);
      }

      if (custRes.status === 'fulfilled') {
        const sorted = [...custRes.value.customers].sort((a, b) =>
          a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
        );
        setManualCustomerOptions(sorted);
        setManualCustomerCustomMode(false);
      } else {
        setManualCustomerOptions([]);
      }
    } finally {
      setLoadingManualCustomers(false);
    }
  }

  function openManualInvoiceModal() {
    const defaultId =
      selectedBranchFilter !== 'all' && selectedBranchFilter !== ''
        ? Number(selectedBranchFilter)
        : branches[0]?.id ?? null;
    setManualBranchId(defaultId);
    setModalInvoicePeriod(isAllPeriods ? monthPeriod : period);
    setManualCustomerName('');
    setManualCustomerCustomMode(false);
    setManualProfileName('');
    setManualAmount('');
    setManualNotes('');
    setManualInvError(null);
    setShowManualInvModal(true);
    if (defaultId) {
      loadManualBranchTariffs(defaultId);
    }
  }

  async function handleManualInvoiceSubmit(e: FormEvent) {
    e.preventDefault();
    if (!manualBranchId) return;
    setSavingManualInv(true);
    setManualInvError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/branches/${manualBranchId}/finance/invoices`, {
        method: 'POST',
        body: JSON.stringify({
          customerName: manualCustomerName.trim(),
          profileName: manualProfileName.trim(),
          period: modalInvoicePeriod,
          amountIdr: Number(manualAmount) || 0,
          notes: manualNotes.trim(),
        }),
      });
      setShowManualInvModal(false);
      setNotice(`Tagihan untuk "${manualCustomerName.trim()}" berhasil ditambahkan.`);
      await loadFinance();
    } catch (err) {
      setManualInvError(err instanceof Error ? err.message : 'Gagal menambahkan tagihan.');
    } finally {
      setSavingManualInv(false);
    }
  }

  function openPayModal(inv: CustomerInvoice) {
    setPayTarget(inv);
    setPayAmount(String(inv.amount_idr));
    setPayMethod('Tunai');
    setPayDate(getTodayDateValue());
    setPayNotes(inv.notes || '');
    setPayError(null);
  }

  async function handlePaySubmit(e: FormEvent) {
    e.preventDefault();
    if (!payTarget) return;
    setSavingPay(true);
    setPayError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        restored?: boolean;
        restoredProfile?: string | null;
        restoreWarning?: string | null;
      }>(`/api/finance/invoices/${payTarget.id}/pay`, {
        method: 'PUT',
        body: JSON.stringify({
          amountIdr: Number(payAmount) || 0,
          paymentMethod: payMethod,
          paidDate: payDate,
          notes: payNotes.trim(),
        }),
      });
      const paidName = payTarget.customer_name;
      setPayTarget(null);
      if (res.restored && res.restoredProfile) {
        setNotice(
          `Pembayaran "${paidName}" Lunas dan profile MikroTik otomatis dikembalikan ke "${res.restoredProfile}".`
        );
      } else if (res.restoreWarning) {
        setNotice(
          `Pembayaran "${paidName}" Lunas. Catatan pengaktifan: ${res.restoreWarning}`
        );
      } else {
        setNotice(`Pembayaran tagihan "${paidName}" berhasil dicatat sebagai Lunas.`);
      }
      await loadFinance();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Gagal menyimpan pembayaran.');
    } finally {
      setSavingPay(false);
    }
  }

  function applyBranchAutomationDrafts(
    branchId: number | null,
    list: BranchBillingAutomationSettings[] = branchAutomationSettings
  ) {
    const match = branchId ? list.find((item) => item.branch_id === branchId) : undefined;
    if (match) {
      setDraftAutoInvoice(match.auto_invoice_enabled);
      setDraftAutoIsolir(match.auto_isolir_enabled);
      setDraftCutoffDay(String(match.isolir_cutoff_day));
      setDraftIsolirProfile(match.isolir_profile_name);
    } else {
      setDraftAutoInvoice(automationSettings.auto_invoice_enabled);
      setDraftAutoIsolir(automationSettings.auto_isolir_enabled);
      setDraftCutoffDay(String(automationSettings.isolir_cutoff_day));
      setDraftIsolirProfile(automationSettings.isolir_profile_name);
    }
  }

  function openAutoModal() {
    const defaultBranchId =
      selectedBranchFilter !== 'all' && selectedBranchFilter !== ''
        ? Number(selectedBranchFilter)
        : branches[0]?.id ?? null;
    setAutoBranchId(defaultBranchId);
    applyBranchAutomationDrafts(defaultBranchId);
    setAutoError(null);
    setShowAutoModal(true);
  }

  async function handleSaveAutomation(e: FormEvent) {
    e.preventDefault();
    if (!autoBranchId) {
      setAutoError('Pilih cabang terlebih dahulu.');
      return;
    }
    setSavingAuto(true);
    setAutoError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        settings: BillingAutomationSettings;
        branchSetting?: BranchBillingAutomationSettings;
        branchSettings?: BranchBillingAutomationSettings[];
      }>('/api/finance/automation', {
        method: 'PUT',
        body: JSON.stringify({
          branch_id: autoBranchId,
          auto_invoice_enabled: draftAutoInvoice,
          auto_isolir_enabled: draftAutoIsolir,
          isolir_cutoff_day: Number(draftCutoffDay) || 5,
          isolir_profile_name: draftIsolirProfile.trim() || 'profile-isolir',
        }),
      });
      if (res.branchSettings) {
        setBranchAutomationSettings(res.branchSettings);
      }
      if (
        res.branchSetting &&
        selectedBranchFilter !== 'all' &&
        Number(selectedBranchFilter) === res.branchSetting.branch_id
      ) {
        setAutomationSettings((prev) => ({
          ...prev,
          ...res.branchSetting,
        }));
      } else {
        setAutomationSettings(res.settings);
      }
      const savedBranchName =
        branches.find((b) => b.id === autoBranchId)?.name || 'Cabang';
      setShowAutoModal(false);
      setNotice(
        `Pengaturan tagihan otomatis & isolir untuk cabang "${savedBranchName}" berhasil disimpan.`
      );
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan otomatisasi.');
    } finally {
      setSavingAuto(false);
    }
  }

  async function handleRunAutomationNow(opts?: {
    forceInvoice?: boolean;
    forceIsolir?: boolean;
    branchId?: number | null;
  }) {
    setRunningAuto(true);
    setError(null);
    setAutoError(null);
    setNotice(null);
    const targetBranchId =
      opts?.branchId !== undefined
        ? opts.branchId
        : selectedBranchFilter !== 'all' && selectedBranchFilter !== ''
          ? Number(selectedBranchFilter)
          : null;
    try {
      const res = await apiRequest<{
        period: string;
        day: number;
        invoicesCreated: number;
        isolatedCount: number;
        errors: string[];
      }>('/api/finance/automation/run', {
        method: 'POST',
        body: JSON.stringify({
          forceInvoice: opts?.forceInvoice,
          forceIsolir: opts?.forceIsolir,
          branchId: targetBranchId,
        }),
      });
      if (res.errors.length > 0) {
        setError(res.errors.join(' · '));
      }
      const branchLabel = targetBranchId
        ? branches.find((b) => b.id === targetBranchId)?.name
        : null;
      setNotice(
        `Pemeriksaan otomatis${branchLabel ? ` (${branchLabel})` : ''} selesai (Periode ${formatPeriodLabel(res.period)}, Tgl ${res.day}): ${res.invoicesCreated} tagihan dibuat, ${res.isolatedCount} pelanggan diisolir.`
      );
      setShowAutoModal(false);
      await loadFinance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan otomatisasi.';
      if (showAutoModal) {
        setAutoError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setRunningAuto(false);
    }
  }

  async function handleUnpayInvoice(inv: CustomerInvoice) {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/finance/invoices/${inv.id}/unpay`, { method: 'PUT' });
      setNotice(`Status pembayaran "${inv.customer_name}" dikembalikan ke Belum Bayar.`);
      await loadFinance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan status lunas.');
    }
  }

  async function handleConfirmDeleteInvoice() {
    if (!deleteInvTarget) return;
    setDeletingItem(true);
    try {
      await apiRequest(`/api/finance/invoices/${deleteInvTarget.id}`, { method: 'DELETE' });
      setDeleteInvTarget(null);
      await loadFinance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus tagihan.');
      setDeleteInvTarget(null);
    } finally {
      setDeletingItem(false);
    }
  }

  function openTxModal(defaultType: 'pemasukan' | 'pengeluaran' = 'pengeluaran') {
    const defaultId =
      selectedBranchFilter !== 'all' && selectedBranchFilter !== ''
        ? Number(selectedBranchFilter)
        : branches[0]?.id ?? null;
    setTxBranchId(defaultId);
    setTxType(defaultType);
    setTxCategory(
      defaultType === 'pengeluaran' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0]
    );
    setTxDescription('');
    setTxAmount('');
    setTxDate(getDefaultDateForPeriod(period));
    setTxMethod('Tunai');
    setTxError(null);
    setShowTxModal(true);
  }

  async function handleTxSubmit(e: FormEvent) {
    e.preventDefault();
    if (!txBranchId) return;
    setSavingTx(true);
    setTxError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/branches/${txBranchId}/finance/transactions`, {
        method: 'POST',
        body: JSON.stringify({
          type: txType,
          category: txCategory.trim(),
          description: txDescription.trim(),
          amountIdr: Number(txAmount) || 0,
          transactionDate: txDate,
          paymentMethod: txMethod,
        }),
      });
      setShowTxModal(false);
      setNotice('Transaksi arus kas berhasil dicatat.');
      await loadFinance();
    } catch (err) {
      setTxError(err instanceof Error ? err.message : 'Gagal mencatat transaksi.');
    } finally {
      setSavingTx(false);
    }
  }

  async function handleConfirmDeleteTx() {
    if (!deleteTxTarget) return;
    setDeletingItem(true);
    try {
      await apiRequest(`/api/finance/transactions/${deleteTxTarget.id}`, { method: 'DELETE' });
      setDeleteTxTarget(null);
      await loadFinance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus transaksi.');
      setDeleteTxTarget(null);
    } finally {
      setDeletingItem(false);
    }
  }

  function openWaModal(inv: CustomerInvoice) {
    setWaTarget(inv);
    setWaNumberInput(inv.whatsapp_number ? formatWhatsAppDisplay(inv.whatsapp_number) : '');
    setWaMessageInput(buildInvoiceWhatsAppMessage(inv, automationSettings));
    setWaError(null);
    setCopiedWa(false);
  }

  async function handleSaveWaNumber(e: FormEvent) {
    e.preventDefault();
    if (!waTarget) return;
    setSavingWa(true);
    setWaError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ ok: boolean; whatsappNumber: string }>(
        `/api/branches/${waTarget.branch_id}/customers-whatsapp`,
        {
          method: 'PUT',
          body: JSON.stringify({
            customerName: waTarget.customer_name,
            whatsappNumber: waNumberInput.trim(),
          }),
        }
      );
      setWaTarget((prev) =>
        prev ? { ...prev, whatsapp_number: res.whatsappNumber } : null
      );
      setWaNumberInput(res.whatsappNumber ? formatWhatsAppDisplay(res.whatsappNumber) : '');
      setNotice(
        res.whatsappNumber
          ? `Nomor WhatsApp "${waTarget.customer_name}" berhasil disimpan (${formatWhatsAppDisplay(res.whatsappNumber)}).`
          : `Nomor WhatsApp "${waTarget.customer_name}" dihapus.`
      );
      await loadFinance();
    } catch (err) {
      setWaError(err instanceof Error ? err.message : 'Gagal menyimpan nomor WhatsApp.');
    } finally {
      setSavingWa(false);
    }
  }

  async function handleCopyWaMessage() {
    try {
      await navigator.clipboard.writeText(waMessageInput);
      setCopiedWa(true);
      setTimeout(() => setCopiedWa(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  function openWaTemplateModal() {
    setDraftTemplateUnpaid(
      automationSettings.wa_template_unpaid?.trim()
        ? automationSettings.wa_template_unpaid
        : DEFAULT_WA_TEMPLATE_UNPAID
    );
    setDraftTemplatePaid(
      automationSettings.wa_template_paid?.trim()
        ? automationSettings.wa_template_paid
        : DEFAULT_WA_TEMPLATE_PAID
    );
    setWaTemplateTab('unpaid');
    setWaTemplateError(null);
    setShowWaTemplateModal(true);
  }

  function insertPlaceholderToken(token: string) {
    const currentText = waTemplateTab === 'unpaid' ? draftTemplateUnpaid : draftTemplatePaid;
    const setText =
      waTemplateTab === 'unpaid' ? setDraftTemplateUnpaid : setDraftTemplatePaid;
    const textarea = waTemplateTextareaRef.current;

    if (!textarea) {
      setText(`${currentText}${currentText && !currentText.endsWith(' ') ? ' ' : ''}${token}`);
      return;
    }

    const start = textarea.selectionStart ?? currentText.length;
    const end = textarea.selectionEnd ?? currentText.length;
    const nextText = currentText.slice(0, start) + token + currentText.slice(end);
    setText(nextText);

    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function handleResetActiveTemplate() {
    if (waTemplateTab === 'unpaid') {
      setDraftTemplateUnpaid(DEFAULT_WA_TEMPLATE_UNPAID);
    } else {
      setDraftTemplatePaid(DEFAULT_WA_TEMPLATE_PAID);
    }
  }

  async function handleSaveWaTemplates(e: FormEvent) {
    e.preventDefault();
    setSavingWaTemplate(true);
    setWaTemplateError(null);
    setNotice(null);
    try {
      const cleanUnpaid =
        draftTemplateUnpaid.trim() === DEFAULT_WA_TEMPLATE_UNPAID.trim()
          ? ''
          : draftTemplateUnpaid.trim();
      const cleanPaid =
        draftTemplatePaid.trim() === DEFAULT_WA_TEMPLATE_PAID.trim()
          ? ''
          : draftTemplatePaid.trim();

      const res = await apiRequest<{ settings: BillingAutomationSettings }>(
        '/api/finance/automation',
        {
          method: 'PUT',
          body: JSON.stringify({
            wa_template_unpaid: cleanUnpaid,
            wa_template_paid: cleanPaid,
          }),
        }
      );
      setAutomationSettings(res.settings);
      setShowWaTemplateModal(false);
      setNotice('Template teks penagihan WhatsApp berhasil disimpan.');
    } catch (err) {
      setWaTemplateError(
        err instanceof Error ? err.message : 'Gagal menyimpan template teks penagihan.'
      );
    } finally {
      setSavingWaTemplate(false);
    }
  }

  function handleExportCashflowCsv() {
    const headers = [
      'Tanggal',
      'Cabang',
      'Tipe',
      'Kategori',
      'Keterangan',
      'Metode',
      'Nominal (IDR)',
      'Dicatat Oleh',
    ];
    const rows = filteredTransactions.map((t) => [
      t.transaction_date,
      t.branch_name,
      t.type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran',
      t.category,
      t.description,
      t.payment_method,
      String(t.type === 'pemasukan' ? t.amount_idr : -t.amount_idr),
      t.created_by_name,
    ]);
    const csvLines = [headers, ...rows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvLines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = isAllPeriods
      ? 'laporan-keuangan-semua-periode.csv'
      : `laporan-keuangan-${period}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const filteredInvoices = invoices.filter((inv) => {
    const q = invoiceSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      inv.customer_name.toLowerCase().includes(q) ||
      inv.profile_name.toLowerCase().includes(q) ||
      inv.branch_name.toLowerCase().includes(q);
    const matchesStatus =
      invoiceStatusFilter === 'all' ? true : inv.status === invoiceStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredTransactions = transactions.filter((tx) => {
    const q = txSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      tx.category.toLowerCase().includes(q) ||
      tx.description.toLowerCase().includes(q) ||
      tx.branch_name.toLowerCase().includes(q) ||
      tx.created_by_name.toLowerCase().includes(q);
    const matchesType = txTypeFilter === 'all' ? true : tx.type === txTypeFilter;
    return matchesSearch && matchesType;
  });

  const hasAccessibleBranch = branches.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Keuangan</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Tagihan iuran PPPoE, tarif paket internet, dan laporan arus kas pemasukan serta pengeluaran cabang.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {user.role === 'admin' && branches.length > 0 && (
            <select
              value={selectedBranchFilter}
              onChange={(e) => setSelectedBranchFilter(e.target.value)}
              aria-label="Filter cabang keuangan"
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">Semua Cabang</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <div className="inline-flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setPeriod(monthPeriod)}
              className={`h-8 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                !isAllPeriods
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Per Bulan
            </button>
            <button
              type="button"
              onClick={() => setPeriod('all')}
              className={`h-8 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                isAllPeriods
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Secara Total
            </button>
          </div>

          {!isAllPeriods && (
            <input
              type="month"
              value={monthPeriod}
              onChange={(e) => {
                const next = e.target.value;
                if (next) {
                  setMonthPeriod(next);
                  setPeriod(next);
                }
              }}
              aria-label="Periode bulan"
              className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          )}

          <button
            type="button"
            onClick={loadFinance}
            disabled={loading}
            className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>
        </div>
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
            className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100 p-1 rounded cursor-pointer"
            aria-label="Tutup pemberitahuan"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!hasAccessibleBranch && !loading ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Belum ada cabang tersedia</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {user.role === 'admin'
              ? 'Tambahkan cabang MikroTik terlebih dahulu di menu Cabang untuk mulai mengelola keuangan.'
              : 'Akun staf Anda belum dihubungkan ke cabang manapun.'}
          </p>
        </div>
      ) : (
        <>
          {/* Ringkasan KPI Keuangan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Pemasukan</p>
                  <p className="font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums mt-2">
                    {loading ? '—' : formatRupiah(summary.totalIncome)}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                {summary.paidCount} tagihan lunas · {formatPeriodLabel(period)}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Pengeluaran</p>
                  <p className="font-display text-2xl font-bold text-red-600 dark:text-red-400 font-mono tabular-nums mt-2">
                    {loading ? '—' : formatRupiah(summary.totalExpense)}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {isAllPeriods ? 'Akumulasi seluruh periode' : 'Biaya operasional periode ini'}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Laba Bersih</p>
                  <p
                    className={`font-display text-2xl font-bold font-mono tabular-nums mt-2 ${
                      summary.netProfit >= 0 ? 'text-slate-900 dark:text-slate-100' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {loading ? '—' : formatRupiah(summary.netProfit)}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {isAllPeriods ? 'Akumulasi selisih masuk & keluar' : 'Selisih pemasukan & pengeluaran'}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Tagihan Belum Lunas</p>
                  <p className="font-display text-2xl font-bold text-amber-700 dark:text-amber-400 font-mono tabular-nums mt-2">
                    {loading ? '—' : formatRupiah(summary.unpaidAmount)}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                {summary.unpaidCount} {isAllPeriods ? 'tagihan menunggak (total)' : 'pelanggan belum bayar'}
              </p>
            </div>
          </div>

          {/* Rekap Perkembangan Keuangan Bulanan (aktif saat filter Secara Total) */}
          {isAllPeriods && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Perkembangan Keuangan Bulanan
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Perbandingan pemasukan, pengeluaran, dan pertumbuhan laba antar bulan.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                    <span>Pemasukan</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-red-400 inline-block" />
                    <span>Pengeluaran</span>
                  </span>
                </div>
              </div>

              {loading ? (
                <div className="p-6 space-y-3">
                  <div className="h-28 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                </div>
              ) : monthlyTrend.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  Belum ada riwayat transaksi atau tagihan untuk ditampilkan perkembangannya.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {/* Grafik batang perbandingan per bulan */}
                  <div className="px-6 py-5 overflow-x-auto">
                    {(() => {
                      const chartHeightPx = 112;
                      const maxVal = Math.max(
                        ...monthlyTrend.map((m) => Math.max(m.totalIncome, m.totalExpense)),
                        1
                      );
                      return (
                        <div className="flex items-end gap-6 min-w-max">
                          {monthlyTrend.map((m) => {
                            const incomePx =
                              m.totalIncome > 0
                                ? Math.max(6, Math.round((m.totalIncome / maxVal) * chartHeightPx))
                                : 0;
                            const expensePx =
                              m.totalExpense > 0
                                ? Math.max(6, Math.round((m.totalExpense / maxVal) * chartHeightPx))
                                : 0;
                            return (
                              <button
                                key={m.period}
                                type="button"
                                onClick={() => {
                                  setMonthPeriod(m.period);
                                  setPeriod(m.period);
                                }}
                                title={`Pemasukan ${formatRupiah(m.totalIncome)} · Pengeluaran ${formatRupiah(m.totalExpense)}`}
                                className="group flex flex-col items-center gap-2.5 px-3 py-2.5 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                              >
                                <div
                                  style={{ height: `${chartHeightPx}px` }}
                                  className="flex items-end gap-2"
                                >
                                  <div className="w-7 h-full flex items-end bg-slate-100 dark:bg-slate-800 rounded-t-sm overflow-hidden">
                                    <div
                                      style={{ height: `${incomePx}px` }}
                                      className="w-full bg-emerald-500 group-hover:bg-emerald-600 transition-all rounded-t-sm"
                                    />
                                  </div>
                                  <div className="w-7 h-full flex items-end bg-slate-100 dark:bg-slate-800 rounded-t-sm overflow-hidden">
                                    <div
                                      style={{ height: `${expensePx}px` }}
                                      className="w-full bg-red-500 group-hover:bg-red-600 transition-all rounded-t-sm"
                                    />
                                  </div>
                                </div>
                                <div className="text-center space-y-0.5">
                                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400">
                                    {formatPeriodShort(m.period)}
                                  </p>
                                  <p className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                                    +{formatRupiah(m.totalIncome)}
                                  </p>
                                  <p className="text-[11px] font-mono tabular-nums text-red-600 dark:text-red-400">
                                    -{formatRupiah(m.totalExpense)}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Tabel rincian per bulan + pertumbuhan MoM */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                          <th className="py-2.5 px-6">Periode</th>
                          <th className="py-2.5 px-4 text-right">Tagihan Lunas</th>
                          <th className="py-2.5 px-4 text-right">Pemasukan Total</th>
                          <th className="py-2.5 px-4 text-right">Pengeluaran</th>
                          <th className="py-2.5 px-4 text-right">Laba Bersih</th>
                          <th className="py-2.5 px-4 text-right">Pertumbuhan Laba</th>
                          <th className="py-2.5 px-6 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                        {[...monthlyTrend]
                          .map((m, idx) => {
                            const prev = idx > 0 ? monthlyTrend[idx - 1] : null;
                            let growthPct: number | null = null;
                            if (prev && prev.netProfit !== 0) {
                              growthPct =
                                ((m.netProfit - prev.netProfit) / Math.abs(prev.netProfit)) * 100;
                            } else if (prev && prev.netProfit === 0 && m.netProfit !== 0) {
                              growthPct = m.netProfit > 0 ? 100 : -100;
                            }
                            return { ...m, growthPct };
                          })
                          .reverse()
                          .map((m) => (
                            <tr key={m.period} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="py-3 px-6 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                {formatPeriodLabel(m.period)}
                              </td>
                              <td className="py-3 px-4 text-right text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                                <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                                  {m.paidCount}/{m.paidCount + m.unpaidCount}
                                </span>{' '}
                                <span>({formatRupiah(m.paidInvoicesAmount)})</span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-medium text-emerald-700 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                                {formatRupiah(m.totalIncome)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-medium text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                                {formatRupiah(m.totalExpense)}
                              </td>
                              <td
                                className={`py-3 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                  m.netProfit >= 0 ? 'text-slate-900 dark:text-slate-100' : 'text-red-600 dark:text-red-400'
                                }`}
                              >
                                {formatRupiah(m.netProfit)}
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                                {m.growthPct === null ? (
                                  <span className="text-slate-400 dark:text-slate-500">Periode awal</span>
                                ) : (
                                  <span
                                    className={
                                      m.growthPct >= 0
                                        ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                        : 'text-red-600 dark:text-red-400 font-medium'
                                    }
                                  >
                                    {m.growthPct >= 0 ? '+' : ''}
                                    {m.growthPct.toFixed(1).replace('.', ',')}%
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-6 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMonthPeriod(m.period);
                                    setPeriod(m.period);
                                  }}
                                  className="inline-flex items-center px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
                                >
                                  Detail Bulan
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-Tab Navigasi Keuangan */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(
                [
                  { id: 'invoices', label: `Tagihan Pelanggan (${invoices.length})` },
                  { id: 'cashflow', label: `Arus Kas (${transactions.length})` },
                  { id: 'tariffs', label: 'Tarif Paket' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums cursor-pointer ${
                    activeSubTab === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeSubTab === 'invoices' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openManualInvoiceModal}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tagihan Manual</span>
                </button>
                <button
                  type="button"
                  onClick={openGenerateModal}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Receipt className="w-3.5 h-3.5" />
                  <span>Buat Tagihan Otomatis</span>
                </button>
              </div>
            )}

            {activeSubTab === 'cashflow' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportCashflowCsv}
                  disabled={filteredTransactions.length === 0}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => openTxModal('pengeluaran')}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Catat Transaksi</span>
                </button>
              </div>
            )}
          </div>

          {/* TAB 1: TAGIHAN PELANGGAN */}
          {activeSubTab === 'invoices' && (
            <div className="space-y-4">
              {/* Bar Status Otomatisasi Tanggal 1 & Isolir Tanggal 5 */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
                  <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {selectedBranchFilter !== 'all' || branchAutomationSettings.length <= 1 ? (
                      <>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Jadwal Otomatis
                          {selectedBranchFilter !== 'all'
                            ? ` (${branches.find((b) => String(b.id) === selectedBranchFilter)?.name || 'Cabang'})`
                            : ''}
                          :
                        </span>{' '}
                        <span>
                          Tagihan tanggal 1 ({automationSettings.auto_invoice_enabled ? 'Aktif' : 'Nonaktif'})
                        </span>
                        <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                        <span>
                          Isolir setelah tanggal {automationSettings.isolir_cutoff_day} ke{' '}
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                            {automationSettings.isolir_profile_name}
                          </span>{' '}
                          ({automationSettings.auto_isolir_enabled ? 'Aktif' : 'Nonaktif'})
                        </span>
                        <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                        <span>Aktif kembali otomatis saat lunas</span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          Jadwal Otomatis (Per Cabang):
                        </span>{' '}
                        <span>
                          Tagihan tgl 1 aktif di{' '}
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                            {branchAutomationSettings.filter((b) => b.auto_invoice_enabled).length}/
                            {branchAutomationSettings.length}
                          </span>{' '}
                          cabang
                        </span>
                        <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                        <span>
                          Isolir otomatis aktif di{' '}
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                            {branchAutomationSettings.filter((b) => b.auto_isolir_enabled).length}/
                            {branchAutomationSettings.length}
                          </span>{' '}
                          cabang
                        </span>
                        <span className="text-slate-300 dark:text-slate-600 mx-2">·</span>
                        <span>Aktif kembali otomatis saat lunas</span>
                      </>
                    )}
                  </div>
                </div>

                {user.role === 'admin' && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRunAutomationNow()}
                      disabled={runningAuto}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${runningAuto ? 'animate-spin' : ''}`} />
                      <span>{runningAuto ? 'Memeriksa...' : 'Cek & Isolir Sekarang'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={openWaTemplateModal}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Template WA</span>
                    </button>
                    <button
                      type="button"
                      onClick={openAutoModal}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer"
                    >
                      <Settings2 className="w-3.5 h-3.5" />
                      <span>Pengaturan</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={invoiceSearch}
                    onChange={(e) => setInvoiceSearch(e.target.value)}
                    placeholder="Cari nama pelanggan, paket, atau cabang..."
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'all', label: `Semua (${invoices.length})` },
                      { id: 'belum_bayar', label: `Belum Bayar (${summary.unpaidCount})` },
                      { id: 'lunas', label: `Lunas (${summary.paidCount})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setInvoiceStatusFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                        invoiceStatusFilter === f.id
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {loading ? (
                  <div className="p-6 space-y-3">
                    <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                    <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                    <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                  </div>
                ) : filteredInvoices.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {invoices.length === 0
                        ? `Belum ada tagihan pada periode ${formatPeriodLabel(period)}`
                        : 'Tidak ada tagihan yang cocok dengan filter'}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                      {invoices.length === 0
                        ? 'Gunakan tombol "Buat Tagihan Otomatis" untuk menarik daftar pelanggan PPPoE aktif dari MikroTik sesuai tarif paket.'
                        : 'Coba ubah kata kunci pencarian atau pilih status lain.'}
                    </p>
                    {invoices.length === 0 && (
                      <button
                        type="button"
                        onClick={openGenerateModal}
                        className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer"
                      >
                        <Receipt className="w-4 h-4" />
                        <span>Buat Tagihan Otomatis</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-6">Pelanggan</th>
                          {isAllPeriods && <th className="py-3 px-4">Periode</th>}
                          <th className="py-3 px-4">Cabang</th>
                          <th className="py-3 px-4">Paket</th>
                          <th className="py-3 px-4 text-right">Tagihan</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Info Pembayaran</th>
                          <th className="py-3 px-6 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                        {filteredInvoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="py-3.5 px-6">
                              <p className="font-medium text-slate-900 dark:text-slate-100">{inv.customer_name}</p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                                {inv.whatsapp_number ? (
                                  <button
                                    type="button"
                                    onClick={() => openWaModal(inv)}
                                    className="inline-flex items-center gap-1 font-mono text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline cursor-pointer"
                                    title="Ubah nomor WA atau pratinjau pesan"
                                  >
                                    <span>WA: {formatWhatsAppDisplay(inv.whatsapp_number)}</span>
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openWaModal(inv)}
                                    className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                                  >
                                    + Tambah No. WA
                                  </button>
                                )}
                              </div>
                              {inv.notes && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[200px]">
                                  {inv.notes}
                                </p>
                              )}
                            </td>
                            {isAllPeriods && (
                              <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                {formatPeriodShort(inv.period)}
                              </td>
                            )}
                            <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {inv.branch_name}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {inv.profile_name}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                              {formatRupiah(inv.amount_idr)}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {inv.status === 'lunas' ? (
                                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Lunas</span>
                                </span>
                              ) : inv.is_isolated === 1 ? (
                                <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
                                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                                  <span>Belum Bayar · Terisolir</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                                  <Clock className="w-3.5 h-3.5 shrink-0" />
                                  <span>Belum Bayar</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400">
                              {inv.status === 'lunas' ? (
                                <div>
                                  <span className="font-medium text-slate-800 dark:text-slate-200">
                                    {inv.payment_method || 'Tunai'}
                                  </span>
                                  {inv.paid_at && (
                                    <span className="text-slate-500 dark:text-slate-400">
                                      {' '}
                                      · {formatShortDate(inv.paid_at.slice(0, 10))}
                                    </span>
                                  )}
                                  {inv.paid_by_name && (
                                    <p className="text-slate-400 dark:text-slate-500 mt-0.5">Oleh {inv.paid_by_name}</p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-6 text-right">
                              <div className="inline-flex items-center justify-end gap-2">
                                {inv.whatsapp_number ? (
                                  <a
                                    href={buildWhatsAppUrl(
                                      inv.whatsapp_number,
                                      buildInvoiceWhatsAppMessage(inv, automationSettings)
                                    )}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Kirim pemberitahuan tagihan ${formatPeriodLabel(inv.period)} ke WhatsApp`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/80 text-xs font-medium whitespace-nowrap"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    <span>Kirim WA</span>
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openWaModal(inv)}
                                    title="Atur nomor WA pelanggan untuk kirim pemberitahuan"
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    <span>Atur WA</span>
                                  </button>
                                )}

                                {inv.status === 'belum_bayar' ? (
                                  <button
                                    type="button"
                                    onClick={() => openPayModal(inv)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Tandai Lunas</span>
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setReceiptTarget(inv)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      <span>Struk</span>
                                    </button>
                                    {user.role === 'admin' && (
                                      <button
                                        type="button"
                                        onClick={() => handleUnpayInvoice(inv)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap cursor-pointer"
                                        title="Batalkan status lunas"
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        <span>Batal</span>
                                      </button>
                                    )}
                                  </>
                                )}
                                {user.role === 'admin' && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteInvTarget(inv)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                                    aria-label={`Hapus tagihan ${inv.customer_name}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
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
            </div>
          )}

          {/* TAB 2: ARUS KAS */}
          {activeSubTab === 'cashflow' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="relative flex-1 max-w-sm min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.target.value)}
                    placeholder="Cari kategori, keterangan, atau pencatat..."
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'all', label: `Semua (${transactions.length})` },
                      {
                        id: 'pemasukan',
                        label: `Pemasukan (${transactions.filter((t) => t.type === 'pemasukan').length})`,
                      },
                      {
                        id: 'pengeluaran',
                        label: `Pengeluaran (${transactions.filter((t) => t.type === 'pengeluaran').length})`,
                      },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setTxTypeFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap tabular-nums cursor-pointer ${
                        txTypeFilter === f.id
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {loading ? (
                  <div className="p-6 space-y-3">
                    <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                    <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      Belum ada catatan arus kas pada periode {formatPeriodLabel(period)}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Pembayaran tagihan pelanggan akan tercatat otomatis, atau Anda dapat mencatat pemasukan dan pengeluaran operasional secara manual.
                    </p>
                    <button
                      type="button"
                      onClick={() => openTxModal('pengeluaran')}
                      className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Catat Transaksi Pertama</span>
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <th className="py-3 px-6">Tanggal</th>
                          <th className="py-3 px-4">Cabang</th>
                          <th className="py-3 px-4">Tipe & Kategori</th>
                          <th className="py-3 px-4">Keterangan</th>
                          <th className="py-3 px-4">Metode</th>
                          <th className="py-3 px-4 text-right">Nominal</th>
                          {user.role === 'admin' && <th className="py-3 px-6 text-right">Aksi</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                        {filteredTransactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="py-3.5 px-6 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums whitespace-nowrap">
                              {formatShortDate(tx.transaction_date)}
                            </td>
                            <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {tx.branch_name}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {tx.type === 'pemasukan' ? (
                                <div className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <ArrowDownLeft className="w-3.5 h-3.5 shrink-0" />
                                  <span>{tx.category}</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                                  <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                                  <span>{tx.category}</span>
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 max-w-md">
                              <p>{tx.description}</p>
                              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                Dicatat oleh {tx.created_by_name}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {tx.payment_method}
                            </td>
                            <td
                              className={`py-3.5 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                tx.type === 'pemasukan' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {tx.type === 'pemasukan' ? '+' : '-'} {formatRupiah(tx.amount_idr)}
                            </td>
                            {user.role === 'admin' && (
                              <td className="py-3.5 px-6 text-right">
                                {!tx.invoice_id ? (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTxTarget(tx)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-medium whitespace-nowrap cursor-pointer"
                                    aria-label={`Hapus transaksi ${tx.description}`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-slate-500">Dari tagihan</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: TARIF PAKET */}
          {activeSubTab === 'tariffs' && (
            <form
              onSubmit={handleSaveTariffs}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Tarif Bulanan Paket Internet
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {user.role === 'admin'
                      ? 'Tetapkan harga iuran bulanan per profile PPPoE agar pembuatan tagihan otomatis menghitung nominal yang tepat.'
                      : 'Daftar harga langganan bulanan per paket internet di cabang Anda.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {user.role === 'admin' && branches.length > 0 && (
                    <select
                      value={tariffBranchId ?? ''}
                      onChange={(e) => setTariffBranchId(Number(e.target.value))}
                      aria-label="Pilih cabang tarif paket"
                      className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {user.role === 'admin' && tariffs.length > 0 && (
                    <button
                      type="submit"
                      disabled={savingTariffs}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingTariffs ? 'Menyimpan...' : 'Simpan Tarif Paket'}</span>
                    </button>
                  )}
                </div>
              </div>

              {loadingTariffs ? (
                <div className="p-6 space-y-3">
                  <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                  <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
                </div>
              ) : tariffs.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Belum ada profile PPPoE yang ditemukan pada cabang ini.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <th className="py-3 px-6">Nama Paket (PPPoE Profile)</th>
                        <th className="py-3 px-4">Rate Limit</th>
                        <th className="py-3 px-6 text-right">Tarif Bulanan (Rp)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                      {tariffs.map((t) => (
                        <tr key={t.profileName} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">
                            {t.profileName}
                            {t.isDefault && (
                              <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">· Bawaan RouterOS</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                            {t.rateLimit || 'Unlimited'}
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            {user.role === 'admin' ? (
                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">Rp</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1000}
                                  value={tariffDrafts[t.profileName] ?? '0'}
                                  onChange={(e) =>
                                    setTariffDrafts((prev) => ({
                                      ...prev,
                                      [t.profileName]: e.target.value,
                                    }))
                                  }
                                  aria-label={`Tarif ${t.profileName}`}
                                  className="w-36 h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-right font-mono text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                                />
                              </div>
                            ) : (
                              <span className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                                {formatRupiah(t.priceIdr)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </form>
          )}
        </>
      )}

      {/* MODAL: BUAT TAGIHAN OTOMATIS */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Buat Tagihan Otomatis</h3>
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateInvoices} className="p-6 space-y-4">
              {generateError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {generateError}
                </div>
              )}

              <p className="text-sm text-slate-600 dark:text-slate-400">
                Sistem akan membaca seluruh secret PPPoE aktif di MikroTik cabang untuk periode{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatPeriodLabel(modalInvoicePeriod)}
                </span>{' '}
                dan membuat tagihan sesuai tarif masing-masing paket. Pelanggan yang sudah memiliki tagihan pada periode ini tidak akan digandakan.
              </p>

              {isAllPeriods && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Periode Tagihan
                  </label>
                  <input
                    type="month"
                    required
                    value={modalInvoicePeriod}
                    onChange={(e) => {
                      if (e.target.value) setModalInvoicePeriod(e.target.value);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              {user.role === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                  <select
                    required
                    value={generateBranchId ?? ''}
                    onChange={(e) => setGenerateBranchId(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={generating || !generateBranchId}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {generating ? 'Membuat Tagihan...' : 'Buat Tagihan Sekarang'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH TAGIHAN MANUAL */}
      {showManualInvModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Tambah Tagihan ({formatPeriodLabel(modalInvoicePeriod)})
              </h3>
              <button
                type="button"
                onClick={() => setShowManualInvModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualInvoiceSubmit} className="p-6 space-y-4">
              {manualInvError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {manualInvError}
                </div>
              )}

              {isAllPeriods && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Periode Tagihan
                  </label>
                  <input
                    type="month"
                    required
                    value={modalInvoicePeriod}
                    onChange={(e) => {
                      if (e.target.value) setModalInvoicePeriod(e.target.value);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              {user.role === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                  <select
                    required
                    value={manualBranchId ?? ''}
                    onChange={(e) => {
                      const bid = Number(e.target.value);
                      setManualBranchId(bid);
                      setManualCustomerName('');
                      loadManualBranchTariffs(bid);
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Nama Pelanggan / User PPPoE
                  </label>
                  {manualCustomerOptions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualCustomerCustomMode((prev) => !prev);
                        setManualCustomerName('');
                      }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
                    >
                      {manualCustomerCustomMode ? 'Pilih dari daftar' : 'Ketik manual'}
                    </button>
                  )}
                </div>
                {loadingManualCustomers ? (
                  <select
                    disabled
                    value=""
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-sm text-slate-500 dark:text-slate-400"
                  >
                    <option value="">Memuat daftar pelanggan...</option>
                  </select>
                ) : manualCustomerOptions.length > 0 && !manualCustomerCustomMode ? (
                  <select
                    required
                    value={manualCustomerName}
                    onChange={(e) => {
                      const selectedName = e.target.value;
                      setManualCustomerName(selectedName);
                      const cust = manualCustomerOptions.find((c) => c.name === selectedName);
                      if (cust?.profile) {
                        const matchedTariff = manualTariffOptions.find(
                          (t) => t.profileName === cust.profile
                        );
                        if (matchedTariff) {
                          setManualProfileName(matchedTariff.profileName);
                          if (matchedTariff.priceIdr > 0) {
                            setManualAmount(String(matchedTariff.priceIdr));
                          }
                        }
                      }
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="" disabled>
                      -- Pilih Pelanggan PPPoE --
                    </option>
                    {manualCustomerOptions.map((c) => (
                      <option key={c.id || c.name} value={c.name}>
                        {c.name} ({c.profile})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={manualCustomerName}
                    onChange={(e) => setManualCustomerName(e.target.value)}
                    placeholder="Contoh: budi.blokA01"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Paket Internet</label>
                  {manualTariffOptions.length > 0 ? (
                    <select
                      required
                      value={manualProfileName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualProfileName(val);
                        const match = manualTariffOptions.find((t) => t.profileName === val);
                        if (match && match.priceIdr > 0) {
                          setManualAmount(String(match.priceIdr));
                        }
                      }}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {manualTariffOptions.map((t) => (
                        <option key={t.profileName} value={t.profileName}>
                          {t.profileName}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={manualProfileName}
                      onChange={(e) => setManualProfileName(e.target.value)}
                      placeholder="Contoh: 20Mbps-Keluarga"
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nominal (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="200000"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Catatan</label>
                <input
                  type="text"
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  placeholder="Opsional, misal: prorata pemasangan tengah bulan"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowManualInvModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingManualInv}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingManualInv ? 'Menyimpan...' : 'Simpan Tagihan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TANDAI LUNAS */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Catat Pembayaran Lunas</h3>
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePaySubmit} className="p-6 space-y-4">
              {payError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {payError}
                </div>
              )}

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{payTarget.customer_name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {payTarget.branch_name} · {payTarget.profile_name} · {formatPeriodLabel(payTarget.period)}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nominal Bayar (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Metode Pembayaran
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Pembayaran
                </label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Tercatat pada laporan keuangan periode {formatPeriodLabel(payTarget.period)}.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Catatan</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Contoh: Diterima oleh teknisi lapangan"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPayTarget(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingPay}
                  className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingPay ? 'Menyimpan...' : 'Konfirmasi Lunas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: STRUK PEMBAYARAN */}
      {receiptTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 print:bg-white flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 print:bg-white border border-slate-200 dark:border-slate-800 print:border-slate-300 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between print:hidden">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Bukti Pembayaran Pelanggan</h3>
              <button
                type="button"
                onClick={() => setReceiptTarget(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-center pb-4 border-b border-dashed border-slate-300 dark:border-slate-700 print:border-slate-300">
                <p className="font-display font-bold text-base text-slate-900 dark:text-slate-100 print:text-slate-900">
                  Starnet Management System
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 print:text-slate-500 mt-0.5">{receiptTarget.branch_name}</p>
                <p className="text-xs font-mono text-slate-400 dark:text-slate-500 print:text-slate-400 mt-1">
                  KWITANSI #{String(receiptTarget.id).padStart(5, '0')}
                </p>
              </div>

              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Pelanggan</dt>
                  <dd className="font-medium text-slate-900 dark:text-slate-100 print:text-slate-900 text-right">
                    {receiptTarget.customer_name}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Paket Internet</dt>
                  <dd className="font-mono text-xs text-slate-800 dark:text-slate-200 print:text-slate-800 text-right">
                    {receiptTarget.profile_name}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Periode Tagihan</dt>
                  <dd className="text-slate-900 dark:text-slate-100 print:text-slate-900 text-right">
                    {formatPeriodLabel(receiptTarget.period)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Metode Bayar</dt>
                  <dd className="text-slate-900 dark:text-slate-100 print:text-slate-900 text-right">
                    {receiptTarget.payment_method || 'Tunai'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Tanggal Bayar</dt>
                  <dd className="font-mono text-xs text-slate-700 dark:text-slate-300 print:text-slate-700 text-right">
                    {receiptTarget.paid_at ? formatDateTime(receiptTarget.paid_at) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500 dark:text-slate-400 print:text-slate-500">Penerima</dt>
                  <dd className="text-slate-800 dark:text-slate-200 print:text-slate-800 text-right">
                    {receiptTarget.paid_by_name || 'Admin'}
                  </dd>
                </div>
                <div className="pt-3 border-t border-dashed border-slate-300 dark:border-slate-700 print:border-slate-300 flex justify-between items-center gap-4">
                  <dt className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">Total Dibayar</dt>
                  <dd className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400 print:text-emerald-700 tabular-nums">
                    {formatRupiah(receiptTarget.amount_idr)}
                  </dd>
                </div>
              </dl>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-end gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => setReceiptTarget(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Tutup
                </button>
                {receiptTarget.whatsapp_number && (
                  <a
                    href={buildWhatsAppUrl(
                      receiptTarget.whatsapp_number,
                      buildInvoiceWhatsAppMessage(receiptTarget, automationSettings)
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 text-sm font-medium"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Kirim via WA</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Cetak Struk</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CATAT TRANSAKSI ARUS KAS */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Catat Transaksi Kas</h3>
              <button
                type="button"
                onClick={() => setShowTxModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleTxSubmit} className="p-6 space-y-4">
              {txError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {txError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Jenis Transaksi
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setTxType('pengeluaran');
                      setTxCategory(EXPENSE_CATEGORIES[0]);
                    }}
                    className={`h-9 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      txType === 'pengeluaran'
                        ? 'bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    Pengeluaran
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTxType('pemasukan');
                      setTxCategory(INCOME_CATEGORIES[0]);
                    }}
                    className={`h-9 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                      txType === 'pemasukan'
                        ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    Pemasukan Lain
                  </button>
                </div>
              </div>

              {user.role === 'admin' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                  <select
                    required
                    value={txBranchId ?? ''}
                    onChange={(e) => setTxBranchId(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Kategori</label>
                  <select
                    value={txCategory}
                    onChange={(e) => setTxCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {(txType === 'pengeluaran' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nominal (Rp)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={txAmount}
                    onChange={(e) => setTxAmount(e.target.value)}
                    placeholder="150000"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Keterangan</label>
                <input
                  type="text"
                  required
                  value={txDescription}
                  onChange={(e) => setTxDescription(e.target.value)}
                  placeholder={
                    txType === 'pengeluaran'
                      ? 'Contoh: Beli kabel dropcore 1000m & pigtail'
                      : 'Contoh: Biaya pasang baru pelanggan Blok C'
                  }
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tanggal</label>
                  <input
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Metode</label>
                  <select
                    value={txMethod}
                    onChange={(e) => setTxMethod(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTxModal(false)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingTx || !txBranchId}
                  className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingTx ? 'Menyimpan...' : 'Simpan Transaksi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: HAPUS TAGIHAN */}
      {deleteInvTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Tagihan Pelanggan</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Tagihan <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteInvTarget.customer_name}</span>{' '}
              untuk periode {formatPeriodLabel(deleteInvTarget.period)} sebesar{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {formatRupiah(deleteInvTarget.amount_idr)}
              </span>{' '}
              akan dihapus permanen.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteInvTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteInvoice}
                disabled={deletingItem}
                className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                {deletingItem ? 'Menghapus...' : 'Ya, Hapus Tagihan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: HAPUS TRANSAKSI */}
      {deleteTxTarget && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Hapus Transaksi Kas</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Transaksi <span className="font-semibold text-slate-900 dark:text-slate-100">{deleteTxTarget.category}</span>{' '}
              ({deleteTxTarget.description}) sebesar{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                {formatRupiah(deleteTxTarget.amount_idr)}
              </span>{' '}
              akan dihapus dari laporan kas.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTxTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTx}
                disabled={deletingItem}
                className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
              >
                {deletingItem ? 'Menghapus...' : 'Ya, Hapus Transaksi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PENGATURAN OTOMATISASI TAGIHAN & ISOLIR */}
      {showAutoModal && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Pengaturan Tagihan & Isolir Otomatis (Per Cabang)
              </h3>
              <button
                type="button"
                onClick={() => setShowAutoModal(false)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAutomation} className="p-6 space-y-4">
              {autoError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {autoError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cabang</label>
                <select
                  required
                  value={autoBranchId ?? ''}
                  onChange={(e) => {
                    const bid = Number(e.target.value);
                    setAutoBranchId(bid);
                    applyBranchAutomationDrafts(bid);
                  }}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input
                  type="checkbox"
                  checked={draftAutoInvoice}
                  onChange={(e) => setDraftAutoInvoice(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-800 text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Buat Tagihan Otomatis Setiap Tanggal 1
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Menarik daftar pelanggan PPPoE aktif pada cabang ini setiap awal bulan.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input
                  type="checkbox"
                  checked={draftAutoIsolir}
                  onChange={(e) => setDraftAutoIsolir(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 dark:bg-slate-800 text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Isolir Otomatis Setelah Tanggal Jatuh Tempo
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Mengubah profile PPPoE pelanggan yang belum lunas pada cabang ini ke profile isolir, dan otomatis mengembalikan profile semula saat ditandai lunas.
                  </p>
                </div>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Batas Tanggal Bayar
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    required
                    value={draftCutoffDay}
                    onChange={(e) => setDraftCutoffDay(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Diisolir mulai tanggal {(Number(draftCutoffDay) || 5) + 1}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nama Profile Isolir
                  </label>
                  <input
                    type="text"
                    required
                    value={draftIsolirProfile}
                    onChange={(e) => setDraftIsolirProfile(e.target.value)}
                    placeholder="profile-isolir"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Harus sama dengan PPPoE Profile</p>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() =>
                    handleRunAutomationNow({
                      forceInvoice: true,
                      forceIsolir: true,
                      branchId: autoBranchId,
                    })
                  }
                  disabled={runningAuto || savingAuto || !autoBranchId}
                  className="h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {runningAuto ? 'Menjalankan...' : 'Jalankan Paksa Cabang Ini'}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAutoModal(false)}
                    className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingAuto || runningAuto}
                    className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                  >
                    {savingAuto ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL: KIRIM & ATUR WHATSAPP TAGIHAN PELANGGAN */}
      {waTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Notifikasi WhatsApp Pelanggan
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setWaTarget(null)}
                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveWaNumber} className="p-6 space-y-4">
              {waError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                  {waError}
                </div>
              )}

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{waTarget.customer_name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {waTarget.branch_name} · {waTarget.profile_name} · {formatPeriodLabel(waTarget.period)}
                  </p>
                </div>
                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {formatRupiah(waTarget.amount_idr)}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nomor WhatsApp Pelanggan
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={waNumberInput}
                    onChange={(e) => setWaNumberInput(e.target.value)}
                    placeholder="Contoh: 081234567890"
                    className="flex-1 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={savingWa}
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap cursor-pointer disabled:opacity-60"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingWa ? 'Menyimpan...' : 'Simpan Nomor'}</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Teks Pemberitahuan & Aturan Isolir (Siap Kirim)
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyWaMessage}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedWa ? 'Tersalin' : 'Salin Teks'}</span>
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={waMessageInput}
                  onChange={(e) => setWaMessageInput(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setWaTarget(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Tutup
                </button>
                {normalizeWhatsAppDigits(waNumberInput) ? (
                  <a
                    href={buildWhatsAppUrl(waNumberInput, waMessageInput)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Buka WhatsApp Sekarang</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="inline-flex items-center h-10 px-4 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-sm font-medium">
                    Isi nomor WA untuk kirim langsung
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL: PENGATURAN TEMPLATE TEKS PENAGIHAN WHATSAPP */}
      {showWaTemplateModal && user.role === 'admin' && (() => {
        const activeTemplate =
          waTemplateTab === 'unpaid' ? draftTemplateUnpaid : draftTemplatePaid;
        const setActiveTemplate =
          waTemplateTab === 'unpaid' ? setDraftTemplateUnpaid : setDraftTemplatePaid;
        const sampleFromList = invoices.find((inv) =>
          waTemplateTab === 'unpaid' ? inv.status === 'belum_bayar' : inv.status === 'lunas'
        );
        const sampleInvoice: CustomerInvoice = sampleFromList || {
          id: 0,
          branch_id: branches[0]?.id || 1,
          branch_name: branches[0]?.name || 'Cabang Pusat',
          customer_name: 'budi.santoso01',
          profile_name: '20Mbps-Keluarga',
          period: isAllPeriods ? monthPeriod : period,
          amount_idr: 200000,
          status: waTemplateTab === 'unpaid' ? 'belum_bayar' : 'lunas',
          payment_method: waTemplateTab === 'paid' ? 'Transfer Bank' : null,
          paid_at: waTemplateTab === 'paid' ? `${getTodayDateValue()}T10:00:00.000Z` : null,
          paid_by_name: user.full_name,
          notes: '',
          created_at: '',
          updated_at: '',
          is_isolated: 0,
          whatsapp_number: '6281234567890',
        };
        const previewText = renderInvoiceTemplateText(
          activeTemplate,
          sampleInvoice,
          automationSettings
        );

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-slate-950/75 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Pengaturan Template Teks Penagihan WhatsApp
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowWaTemplateModal(false)}
                  className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                  aria-label="Tutup modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                onSubmit={handleSaveWaTemplates}
                className="flex-1 overflow-y-auto p-6 space-y-4"
              >
                {waTemplateError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/50 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">
                    {waTemplateError}
                  </div>
                )}

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setWaTemplateTab('unpaid')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        waTemplateTab === 'unpaid'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      Tagihan Belum Bayar
                    </button>
                    <button
                      type="button"
                      onClick={() => setWaTemplateTab('paid')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        waTemplateTab === 'paid'
                          ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      Konfirmasi Lunas
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleResetActiveTemplate}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Default</span>
                  </button>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Variabel Dinamis (klik untuk menyisipkan ke kursor teks):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {WA_TEMPLATE_PLACEHOLDERS.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        onClick={() => insertPlaceholderToken(item.token)}
                        title={`Sisipkan ${item.label}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:border-blue-200 dark:hover:border-blue-800 text-xs text-slate-700 dark:text-slate-300 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer transition-colors"
                      >
                        <span className="font-mono text-[11px] font-medium">{item.token}</span>
                        <span className="text-slate-400 dark:text-slate-500">·</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {waTemplateTab === 'unpaid'
                      ? 'Isi Pesan Tagihan (Status Belum Bayar)'
                      : 'Isi Pesan Konfirmasi Pembayaran (Status Lunas)'}
                  </label>
                  <textarea
                    ref={waTemplateTextareaRef}
                    rows={9}
                    required
                    value={activeTemplate}
                    onChange={(e) => setActiveTemplate(e.target.value)}
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/30 p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      Pratinjau Hasil Pesan ({sampleInvoice.customer_name})
                    </p>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                      {formatPeriodShort(sampleInvoice.period)} · {formatRupiah(sampleInvoice.amount_idr)}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 border border-emerald-100 dark:border-emerald-800/50 rounded-md p-3 max-h-48 overflow-y-auto">
                    {previewText}
                  </pre>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowWaTemplateModal(false)}
                    className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingWaTemplate}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingWaTemplate ? 'Menyimpan...' : 'Simpan Template'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
