import type {
  BillingAutomationSettings,
  ConnectionMode,
  CustomerInvoice,
} from '../types';

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

export function formatConnectionMode(mode: ConnectionMode): string {
  switch (mode) {
    case 'api':
      return 'RouterOS API (TCP)';
    case 'api-ssl':
      return 'RouterOS API-SSL';
    case 'rest-http':
      return 'RouterOS REST (HTTP)';
    case 'rest-https':
      return 'RouterOS REST (HTTPS)';
    case 'sandbox':
      return 'Lab Sandbox';
    default:
      return mode;
  }
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T00:00:00`);
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

export function formatPeriodLabel(period: string): string {
  if (period === 'all') {
    return 'Semua Periode (Total)';
  }
  try {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return period;
    const d = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat('id-ID', {
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return period;
  }
}

export function formatPeriodShort(period: string): string {
  if (period === 'all') {
    return 'Semua Periode';
  }
  try {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) return period;
    const d = new Date(year, month - 1, 1);
    return new Intl.DateTimeFormat('id-ID', {
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return period;
  }
}

export function formatActionLabel(action: string): string {
  const map: Record<string, string> = {
    TAMBAH_PELANGGAN: 'Tambah Pelanggan',
    EDIT_PELANGGAN: 'Edit Pelanggan',
    HAPUS_PELANGGAN: 'Hapus Pelanggan',
    ATUR_WA_PELANGGAN: 'Atur WA Pelanggan',
    TAMBAH_PAKET: 'Tambah Paket Internet',
    EDIT_PAKET: 'Edit Paket Internet',
    HAPUS_PAKET: 'Hapus Paket Internet',
    ATUR_PAKET_DIIZINKAN: 'Atur Izin Paket',
    ATUR_TARIF_PAKET: 'Atur Tarif Paket',
    BUAT_TAGIHAN: 'Buat Tagihan',
    BAYAR_TAGIHAN: 'Pembayaran Tagihan',
    BATAL_BAYAR_TAGIHAN: 'Batalkan Pembayaran',
    HAPUS_TAGIHAN: 'Hapus Tagihan',
    TAMBAH_TRANSAKSI: 'Tambah Transaksi Kas',
    HAPUS_TRANSAKSI: 'Hapus Transaksi Kas',
    ISOLIR_OTOMATIS: 'Isolir Otomatis',
    AKTIFKAN_KEMBALI: 'Aktifkan Kembali',
    ATUR_OTOMATISASI_TAGIHAN: 'Atur Otomatisasi',
    TAMBAH_CABANG: 'Tambah Cabang',
    HAPUS_CABANG: 'Hapus Cabang',
    BUAT_STAF: 'Buat Akun Staf',
    EDIT_STAF: 'Edit Akun Staf',
    EDIT_ADMIN: 'Edit Akun Admin',
    CEK_PING: 'Cek Ping',
    TAMBAH_OLT: 'Tambah Link OLT',
    EDIT_OLT: 'Edit Link OLT',
    HAPUS_OLT: 'Hapus Link OLT',
    ATUR_REMOTE_CABANG: 'Atur Alamat Remote',
    REMOTE_ONU_PELANGGAN: 'Remote ONU Pelanggan',
    TAMBAH_STARLINK: 'Tambah Remote Starlink',
    EDIT_STARLINK: 'Edit Remote Starlink',
    HAPUS_STARLINK: 'Hapus Remote Starlink',
    REBOOT_STARLINK: 'Reboot Starlink',
  };
  return map[action] || action;
}

export function normalizeWhatsAppDigits(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

export function formatWhatsAppDisplay(raw: string): string {
  const digits = normalizeWhatsAppDigits(raw);
  if (!digits) return '';
  if (digits.startsWith('62')) {
    return `0${digits.slice(2)}`;
  }
  return `+${digits}`;
}

export function buildWhatsAppUrl(phone: string, text: string): string {
  const digits = normalizeWhatsAppDigits(phone);
  if (!digits) return '#';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const DEFAULT_WA_TEMPLATE_UNPAID = [
  `Halo Bapak/Ibu *{{nama_pelanggan}}*,`,
  `Berikut informasi tagihan layanan internet *Starnet* ({{cabang}}):`,
  ``,
  `• ID Pelanggan : {{nama_pelanggan}}`,
  `• Paket Internet : {{paket}}`,
  `• Periode Tagihan : {{periode}}`,
  `• Total Tagihan : *{{nominal}}*`,
  `• Status : *{{status}}*`,
  ``,
  `*Aturan Tagihan & Isolir:*`,
  `- Tagihan diterbitkan otomatis setiap tanggal 1 setiap bulan.`,
  `- Batas waktu pembayaran paling lambat tanggal {{tanggal_isolir}} setiap bulan.`,
  `- Apabila melewati tanggal {{tanggal_isolir}} tagihan belum dilunasi, layanan akan dialihkan otomatis ke mode isolir ({{profile_isolir}}).`,
  `- Layanan internet akan aktif kembali secara otomatis setelah pembayaran dinyatakan lunas.`,
  ``,
  `Mohon segera melakukan pembayaran dan konfirmasi kepada admin agar layanan tetap aktif tanpa kendala. Terima kasih.`,
].join('\n');

export const DEFAULT_WA_TEMPLATE_PAID = [
  `Halo Bapak/Ibu *{{nama_pelanggan}}*,`,
  `Terima kasih! Pembayaran tagihan internet *Starnet* ({{cabang}}) telah kami terima:`,
  ``,
  `• ID Pelanggan : {{nama_pelanggan}}`,
  `• Paket Internet : {{paket}}`,
  `• Periode Tagihan : {{periode}}`,
  `• Nominal Dibayar : {{nominal}}`,
  `• Metode / Tgl Bayar : {{metode_bayar}} ({{tanggal_bayar}})`,
  `• Status : *{{status}}*`,
  ``,
  `*Aturan Tagihan & Isolir:*`,
  `- Tagihan diterbitkan otomatis setiap tanggal 1 setiap bulan.`,
  `- Batas waktu pembayaran paling lambat tanggal {{tanggal_isolir}} setiap bulan.`,
  `- Apabila melewati tanggal {{tanggal_isolir}} tagihan belum dilunasi, layanan akan dialihkan otomatis ke mode isolir ({{profile_isolir}}).`,
  `- Layanan internet akan aktif kembali secara otomatis setelah pembayaran dinyatakan lunas.`,
  ``,
  `Terima kasih atas kerja sama dan kepercayaan Anda menggunakan layanan kami.`,
].join('\n');

export const WA_TEMPLATE_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{{nama_pelanggan}}', label: 'Nama Pelanggan' },
  { token: '{{cabang}}', label: 'Cabang' },
  { token: '{{paket}}', label: 'Paket' },
  { token: '{{periode}}', label: 'Periode' },
  { token: '{{nominal}}', label: 'Nominal' },
  { token: '{{status}}', label: 'Status' },
  { token: '{{tanggal_isolir}}', label: 'Batas Tgl Isolir' },
  { token: '{{profile_isolir}}', label: 'Profile Isolir' },
  { token: '{{metode_bayar}}', label: 'Metode Bayar' },
  { token: '{{tanggal_bayar}}', label: 'Tanggal Bayar' },
];

export function renderInvoiceTemplateText(
  template: string,
  invoice: CustomerInvoice,
  automation?: BillingAutomationSettings
): string {
  const cutoffDay = String(automation?.isolir_cutoff_day ?? 5);
  const isolirProfile = automation?.isolir_profile_name || 'profile-isolir';
  const periodLabel = formatPeriodLabel(invoice.period);
  const amountLabel = formatRupiah(invoice.amount_idr);
  const paidDateLabel = invoice.paid_at ? formatShortDate(invoice.paid_at.slice(0, 10)) : '-';
  const statusLabel =
    invoice.status === 'lunas'
      ? 'LUNAS'
      : invoice.is_isolated === 1
        ? 'BELUM BAYAR (Layanan Sedang Terisolir)'
        : 'BELUM BAYAR';

  const values: Record<string, string> = {
    '{{nama_pelanggan}}': invoice.customer_name,
    '{{cabang}}': invoice.branch_name,
    '{{paket}}': invoice.profile_name,
    '{{periode}}': periodLabel,
    '{{nominal}}': amountLabel,
    '{{status}}': statusLabel,
    '{{tanggal_isolir}}': cutoffDay,
    '{{profile_isolir}}': isolirProfile,
    '{{metode_bayar}}': invoice.payment_method || 'Tunai',
    '{{tanggal_bayar}}': paidDateLabel,
  };

  return template.replace(/\{\{[a-z0-9_]+\}\}/gi, (match) => {
    const key = match.toLowerCase();
    return key in values ? values[key] : match;
  });
}

export function buildInvoiceWhatsAppMessage(
  invoice: CustomerInvoice,
  automation?: BillingAutomationSettings
): string {
  const template =
    invoice.status === 'lunas'
      ? automation?.wa_template_paid?.trim() || DEFAULT_WA_TEMPLATE_PAID
      : automation?.wa_template_unpaid?.trim() || DEFAULT_WA_TEMPLATE_UNPAID;

  return renderInvoiceTemplateText(template, invoice, automation);
}
