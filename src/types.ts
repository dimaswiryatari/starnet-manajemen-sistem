export type UserRole = 'admin' | 'staff';
export type ConnectionMode = 'api' | 'api-ssl' | 'rest-http' | 'rest-https' | 'sandbox';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  branch_id: number | null;
  branch_name: string | null;
  is_active: boolean;
}

export interface Branch {
  id: number;
  name: string;
  location: string;
  connection_mode: ConnectionMode;
  host: string;
  port: number;
  username: string;
  remote_url: string;
  created_at: string;
}

export interface BranchStatus {
  branchId: number;
  branchName: string;
  location: string;
  connectionMode: ConnectionMode;
  host: string;
  port: number;
  online: boolean;
  error: string | null;
  identity: string | null;
  version: string | null;
  uptime: string | null;
  offlineSince?: string | null;
  offlineDuration?: string | null;
  cpuLoad: string | null;
  activeCount: number;
  inactiveCount: number;
  totalSecrets: number;
  checkedAt: string;
}

export interface PppoeCustomer {
  id: string;
  name: string;
  password: string;
  service: string;
  profile: string;
  wifiName: string;
  wifiPassword: string;
  whatsappNumber?: string;
  disabled: boolean;
  status: 'aktif' | 'tidak_aktif';
  activeAddress: string | null;
  activeUptime: string | null;
  callerId: string | null;
}

export interface PppoeProfile {
  id: string;
  name: string;
  localAddress: string;
  remoteAddress: string;
  rateLimit: string;
  dnsServer: string;
  onlyOne: string;
  parentQueue: string;
  isDefault: boolean;
  allowed: boolean;
}

export interface PingPacketResult {
  seq: number;
  host: string;
  size: number | null;
  ttl: number | null;
  timeMs: number | null;
  status: string;
}

export interface PingResult {
  branchId: number;
  branchName: string;
  target: string;
  sent: number;
  received: number;
  packetLossPct: number;
  minRttMs: number | null;
  avgRttMs: number | null;
  maxRttMs: number | null;
  packets: PingPacketResult[];
  checkedAt: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string;
  user_full_name: string;
  user_role: UserRole;
  branch_id: number | null;
  branch_name: string | null;
  action: string;
  target: string;
  details: string;
  created_at: string;
}

export interface StaffAccount {
  id: number;
  username: string;
  full_name: string;
  role: 'staff';
  branch_id: number | null;
  branch_name: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface FinanceSummary {
  totalPaidInvoices: number;
  totalOtherIncome: number;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  unpaidAmount: number;
  paidCount: number;
  unpaidCount: number;
}

export interface BranchNetProfit {
  branchId: number;
  branchName: string;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

export interface MonthlyFinanceTrend {
  period: string;
  paidInvoicesAmount: number;
  otherIncomeAmount: number;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  paidCount: number;
  unpaidCount: number;
  unpaidAmount: number;
}

export interface CustomerInvoice {
  id: number;
  branch_id: number;
  branch_name: string;
  customer_name: string;
  profile_name: string;
  period: string;
  amount_idr: number;
  status: 'belum_bayar' | 'lunas';
  payment_method: string | null;
  paid_at: string | null;
  paid_by_name: string | null;
  notes: string;
  is_isolated?: number;
  whatsapp_number?: string;
  created_at: string;
  updated_at: string;
}

export interface BillingAutomationSettings {
  auto_invoice_enabled: boolean;
  auto_isolir_enabled: boolean;
  isolir_cutoff_day: number;
  isolir_profile_name: string;
  wa_template_unpaid?: string;
  wa_template_paid?: string;
  updated_at: string;
}

export interface BranchBillingAutomationSettings {
  branch_id: number;
  auto_invoice_enabled: boolean;
  auto_isolir_enabled: boolean;
  isolir_cutoff_day: number;
  isolir_profile_name: string;
  updated_at: string;
}

export interface FinanceTransaction {
  id: number;
  branch_id: number;
  branch_name: string;
  type: 'pemasukan' | 'pengeluaran';
  category: string;
  description: string;
  amount_idr: number;
  transaction_date: string;
  payment_method: string;
  invoice_id: number | null;
  created_by_id: number | null;
  created_by_name: string;
  created_at: string;
}

export interface PackageTariff {
  profileName: string;
  rateLimit: string;
  isDefault: boolean;
  priceIdr: number;
}

export interface OltLink {
  id: number;
  branch_id: number;
  branch_name: string;
  name: string;
  http_url: string;
  notes: string;
  login_username: string;
  login_password: string;
  created_at: string;
  updated_at: string;
}

export interface OnuNatRuleStatus {
  found: boolean;
  id: string | null;
  chain: string;
  action: string;
  protocol: string;
  dstPort: string;
  toAddresses: string;
  toPorts: string;
  comment: string;
  disabled: boolean;
}

export interface StarlinkRemote {
  id: number;
  branch_id: number;
  branch_name: string;
  name: string;
  remote_url: string;
  local_ip: string;
  notes: string;
  last_reboot_at: string | null;
  last_reboot_by: string | null;
  created_at: string;
  updated_at: string;
}

export type StarlinkDishState =
  | 'CONNECTED'
  | 'SEARCHING'
  | 'BOOTING'
  | 'OFFLINE'
  | 'WEB_UI_ONLY'
  | 'UNKNOWN';

export interface StarlinkLiveStatus {
  id: number;
  online: boolean;
  reachable: boolean;
  grpcReady: boolean;
  dishState: StarlinkDishState;
  statusLabel: string;
  uptimeSeconds: number | null;
  uptimeFormatted: string | null;
  mode: 'grpc-http2' | 'grpc-web' | 'web-ui-only' | 'sandbox';
  error: string | null;
  checkedAt: string;
}
