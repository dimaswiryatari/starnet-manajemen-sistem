import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type UserRole = 'admin' | 'staff';
export type ConnectionMode = 'api' | 'api-ssl' | 'rest-http' | 'rest-https' | 'sandbox';

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  branch_id: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface DbBranch {
  id: number;
  name: string;
  location: string;
  connection_mode: ConnectionMode;
  host: string;
  port: number;
  username: string;
  password: string;
  remote_url: string;
  created_at: string;
}

export interface DbAuditLog {
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

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'netops.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    connection_mode TEXT NOT NULL DEFAULT 'api',
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8728,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    remote_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    user_full_name TEXT NOT NULL,
    user_role TEXT NOT NULL CHECK(user_role IN ('admin', 'staff')),
    branch_id INTEGER,
    branch_name TEXT,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sandbox_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    local_address TEXT NOT NULL DEFAULT '172.16.1.1',
    remote_address TEXT NOT NULL DEFAULT 'pool1-pppoe',
    rate_limit TEXT NOT NULL DEFAULT '',
    dns_server TEXT NOT NULL DEFAULT '',
    only_one TEXT NOT NULL DEFAULT 'yes',
    parent_queue TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sandbox_secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    service TEXT NOT NULL DEFAULT 'pppoe',
    profile TEXT NOT NULL DEFAULT 'default',
    wifi_name TEXT NOT NULL DEFAULT '',
    wifi_password TEXT NOT NULL DEFAULT '',
    disabled INTEGER NOT NULL DEFAULT 0,
    is_online INTEGER NOT NULL DEFAULT 1,
    active_address TEXT,
    caller_id TEXT,
    uptime TEXT,
    UNIQUE(branch_id, name)
  );

  CREATE TABLE IF NOT EXISTS allowed_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL,
    is_allowed INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, profile_name)
  );

  CREATE TABLE IF NOT EXISTS package_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    profile_name TEXT NOT NULL,
    price_idr INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, profile_name)
  );

  CREATE TABLE IF NOT EXISTS customer_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    period TEXT NOT NULL,
    amount_idr INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'belum_bayar' CHECK(status IN ('belum_bayar', 'lunas')),
    payment_method TEXT,
    paid_at TEXT,
    paid_by_name TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, customer_name, period)
  );

  CREATE TABLE IF NOT EXISTS finance_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('pemasukan', 'pengeluaran')),
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount_idr INTEGER NOT NULL DEFAULT 0,
    transaction_date TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'Tunai',
    invoice_id INTEGER REFERENCES customer_invoices(id) ON DELETE CASCADE,
    created_by_id INTEGER,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS billing_automation_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    auto_invoice_enabled INTEGER NOT NULL DEFAULT 1,
    auto_isolir_enabled INTEGER NOT NULL DEFAULT 1,
    isolir_cutoff_day INTEGER NOT NULL DEFAULT 5,
    isolir_profile_name TEXT NOT NULL DEFAULT 'profile-isolir',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branch_billing_settings (
    branch_id INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
    auto_invoice_enabled INTEGER NOT NULL DEFAULT 1,
    auto_isolir_enabled INTEGER NOT NULL DEFAULT 1,
    isolir_cutoff_day INTEGER NOT NULL DEFAULT 5,
    isolir_profile_name TEXT NOT NULL DEFAULT 'profile-isolir',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS billing_auto_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    auto_invoiced_at TEXT,
    last_isolir_run_at TEXT,
    UNIQUE(branch_id, period)
  );

  CREATE TABLE IF NOT EXISTS customer_billing_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    original_profile TEXT NOT NULL,
    is_isolated INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, customer_name)
  );

  CREATE TABLE IF NOT EXISTS customer_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    whatsapp_number TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(branch_id, customer_name)
  );

  CREATE TABLE IF NOT EXISTS olt_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    http_url TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    login_username TEXT NOT NULL DEFAULT '',
    login_password TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sandbox_nat_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    chain TEXT NOT NULL DEFAULT 'dstnat',
    action TEXT NOT NULL DEFAULT 'dst-nat',
    protocol TEXT NOT NULL DEFAULT 'tcp',
    dst_port TEXT NOT NULL DEFAULT '8080',
    to_addresses TEXT NOT NULL DEFAULT '',
    to_ports TEXT NOT NULL DEFAULT '80',
    comment TEXT NOT NULL DEFAULT '',
    disabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS starlink_remotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    remote_url TEXT NOT NULL,
    local_ip TEXT NOT NULL DEFAULT '192.168.100.1',
    notes TEXT NOT NULL DEFAULT '',
    last_reboot_at TEXT,
    last_reboot_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branch_health_state (
    branch_id INTEGER PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
    is_online INTEGER NOT NULL DEFAULT 1,
    last_online_at TEXT,
    offline_since TEXT,
    last_checked_at TEXT NOT NULL
  );
`);

// Ensure remote_url column exists on older branches tables
const branchCols = db
  .prepare("PRAGMA table_info('branches')")
  .all() as Array<{ name: string }>;
const existingBranchColNames = new Set(branchCols.map((c) => c.name));
if (!existingBranchColNames.has('remote_url')) {
  db.exec("ALTER TABLE branches ADD COLUMN remote_url TEXT NOT NULL DEFAULT '';");
}

// Ensure new columns exist on older sandbox_profiles tables
const sandboxProfCols = db
  .prepare("PRAGMA table_info('sandbox_profiles')")
  .all() as Array<{ name: string }>;
const existingProfColNames = new Set(sandboxProfCols.map((c) => c.name));
const extraProfCols: Array<[string, string]> = [
  ['local_address', "TEXT NOT NULL DEFAULT '172.16.1.1'"],
  ['remote_address', "TEXT NOT NULL DEFAULT 'pool1-pppoe'"],
  ['rate_limit', "TEXT NOT NULL DEFAULT ''"],
  ['dns_server', "TEXT NOT NULL DEFAULT ''"],
  ['only_one', "TEXT NOT NULL DEFAULT 'yes'"],
  ['parent_queue', "TEXT NOT NULL DEFAULT ''"],
];
for (const [col, def] of extraProfCols) {
  if (!existingProfColNames.has(col)) {
    db.exec(`ALTER TABLE sandbox_profiles ADD COLUMN ${col} ${def};`);
  }
}

// Ensure wifi_name and wifi_password exist on older sandbox_secrets tables
const sandboxSecretCols = db
  .prepare("PRAGMA table_info('sandbox_secrets')")
  .all() as Array<{ name: string }>;
const existingSecretColNames = new Set(sandboxSecretCols.map((c) => c.name));
if (!existingSecretColNames.has('wifi_name')) {
  db.exec("ALTER TABLE sandbox_secrets ADD COLUMN wifi_name TEXT NOT NULL DEFAULT '';");
}
if (!existingSecretColNames.has('wifi_password')) {
  db.exec("ALTER TABLE sandbox_secrets ADD COLUMN wifi_password TEXT NOT NULL DEFAULT '';");
}

// Ensure wa_template_unpaid and wa_template_paid exist on older billing_automation_settings tables
const autoCols = db
  .prepare("PRAGMA table_info('billing_automation_settings')")
  .all() as Array<{ name: string }>;
const existingAutoColNames = new Set(autoCols.map((c) => c.name));
if (!existingAutoColNames.has('wa_template_unpaid')) {
  db.exec("ALTER TABLE billing_automation_settings ADD COLUMN wa_template_unpaid TEXT NOT NULL DEFAULT '';");
}
if (!existingAutoColNames.has('wa_template_paid')) {
  db.exec("ALTER TABLE billing_automation_settings ADD COLUMN wa_template_paid TEXT NOT NULL DEFAULT '';");
}

// Ensure login_username and login_password exist on older olt_links tables
const oltLinkCols = db
  .prepare("PRAGMA table_info('olt_links')")
  .all() as Array<{ name: string }>;
const existingOltColNames = new Set(oltLinkCols.map((c) => c.name));
if (!existingOltColNames.has('login_username')) {
  db.exec("ALTER TABLE olt_links ADD COLUMN login_username TEXT NOT NULL DEFAULT '';");
}
if (!existingOltColNames.has('login_password')) {
  db.exec("ALTER TABLE olt_links ADD COLUMN login_password TEXT NOT NULL DEFAULT '';");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getAllowedPackageMap(branchId: number): Map<string, boolean> {
  const rows = db
    .prepare('SELECT profile_name, is_allowed FROM allowed_packages WHERE branch_id = ?')
    .all(branchId) as Array<{ profile_name: string; is_allowed: number }>;
  const map = new Map<string, boolean>();
  for (const r of rows) {
    map.set(r.profile_name, r.is_allowed === 1);
  }
  return map;
}

export function isPackageAllowed(branchId: number, profileName: string): boolean {
  const row = db
    .prepare('SELECT is_allowed FROM allowed_packages WHERE branch_id = ? AND profile_name = ?')
    .get(branchId, profileName) as { is_allowed: number } | undefined;
  if (!row) return true;
  return row.is_allowed === 1;
}

export function setPackagesAllowed(
  branchId: number,
  items: Array<{ profileName: string; allowed: boolean }>
): void {
  const now = nowIso();
  const upsert = db.prepare(`
    INSERT INTO allowed_packages (branch_id, profile_name, is_allowed, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(branch_id, profile_name)
    DO UPDATE SET is_allowed = excluded.is_allowed, updated_at = excluded.updated_at
  `);
  const tx = db.transaction((list: Array<{ profileName: string; allowed: boolean }>) => {
    for (const item of list) {
      upsert.run(branchId, item.profileName, item.allowed ? 1 : 0, now);
    }
  });
  tx(items);
}

export function currentPeriod(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getPackagePriceMap(branchId: number): Map<string, number> {
  const rows = db
    .prepare('SELECT profile_name, price_idr FROM package_prices WHERE branch_id = ?')
    .all(branchId) as Array<{ profile_name: string; price_idr: number }>;
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.profile_name, r.price_idr);
  }
  return map;
}

export function setPackagePrices(
  branchId: number,
  items: Array<{ profileName: string; priceIdr: number }>
): void {
  const now = nowIso();
  const upsert = db.prepare(`
    INSERT INTO package_prices (branch_id, profile_name, price_idr, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(branch_id, profile_name)
    DO UPDATE SET price_idr = excluded.price_idr, updated_at = excluded.updated_at
  `);
  const tx = db.transaction((list: Array<{ profileName: string; priceIdr: number }>) => {
    for (const item of list) {
      const cleanPrice = Math.max(0, Math.round(Number(item.priceIdr) || 0));
      upsert.run(branchId, item.profileName, cleanPrice, now);
    }
  });
  tx(items);
}

export interface BillingAutomationSettings {
  auto_invoice_enabled: boolean;
  auto_isolir_enabled: boolean;
  isolir_cutoff_day: number;
  isolir_profile_name: string;
  wa_template_unpaid: string;
  wa_template_paid: string;
  updated_at: string;
}

export function getBillingSettings(): BillingAutomationSettings {
  const row = db
    .prepare('SELECT * FROM billing_automation_settings WHERE id = 1')
    .get() as
    | {
        id: number;
        auto_invoice_enabled: number;
        auto_isolir_enabled: number;
        isolir_cutoff_day: number;
        isolir_profile_name: string;
        wa_template_unpaid?: string;
        wa_template_paid?: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    const now = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO billing_automation_settings
        (id, auto_invoice_enabled, auto_isolir_enabled, isolir_cutoff_day, isolir_profile_name, wa_template_unpaid, wa_template_paid, updated_at)
       VALUES (1, 1, 1, 5, 'profile-isolir', '', '', ?)`
    ).run(now);
    return {
      auto_invoice_enabled: true,
      auto_isolir_enabled: true,
      isolir_cutoff_day: 5,
      isolir_profile_name: 'profile-isolir',
      wa_template_unpaid: '',
      wa_template_paid: '',
      updated_at: now,
    };
  }

  return {
    auto_invoice_enabled: row.auto_invoice_enabled === 1,
    auto_isolir_enabled: row.auto_isolir_enabled === 1,
    isolir_cutoff_day: row.isolir_cutoff_day,
    isolir_profile_name: row.isolir_profile_name || 'profile-isolir',
    wa_template_unpaid: row.wa_template_unpaid || '',
    wa_template_paid: row.wa_template_paid || '',
    updated_at: row.updated_at,
  };
}

export function updateBillingSettings(input: {
  auto_invoice_enabled: boolean;
  auto_isolir_enabled: boolean;
  isolir_cutoff_day: number;
  isolir_profile_name: string;
  wa_template_unpaid?: string;
  wa_template_paid?: string;
}): BillingAutomationSettings {
  const now = nowIso();
  const cutoff = Math.min(28, Math.max(1, Math.round(Number(input.isolir_cutoff_day) || 5)));
  const profileName = (input.isolir_profile_name || 'profile-isolir').trim() || 'profile-isolir';
  const current = getBillingSettings();
  const templateUnpaid =
    input.wa_template_unpaid !== undefined ? input.wa_template_unpaid : current.wa_template_unpaid;
  const templatePaid =
    input.wa_template_paid !== undefined ? input.wa_template_paid : current.wa_template_paid;

  db.prepare(
    `INSERT INTO billing_automation_settings
      (id, auto_invoice_enabled, auto_isolir_enabled, isolir_cutoff_day, isolir_profile_name, wa_template_unpaid, wa_template_paid, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       auto_invoice_enabled = excluded.auto_invoice_enabled,
       auto_isolir_enabled = excluded.auto_isolir_enabled,
       isolir_cutoff_day = excluded.isolir_cutoff_day,
       isolir_profile_name = excluded.isolir_profile_name,
       wa_template_unpaid = excluded.wa_template_unpaid,
       wa_template_paid = excluded.wa_template_paid,
       updated_at = excluded.updated_at`
  ).run(
    input.auto_invoice_enabled ? 1 : 0,
    input.auto_isolir_enabled ? 1 : 0,
    cutoff,
    profileName,
    templateUnpaid,
    templatePaid,
    now
  );

  return getBillingSettings();
}

export interface BranchBillingAutomationSettings {
  branch_id: number;
  auto_invoice_enabled: boolean;
  auto_isolir_enabled: boolean;
  isolir_cutoff_day: number;
  isolir_profile_name: string;
  updated_at: string;
}

export function getBranchBillingSettings(branchId: number): BranchBillingAutomationSettings {
  const row = db
    .prepare('SELECT * FROM branch_billing_settings WHERE branch_id = ?')
    .get(branchId) as
    | {
        branch_id: number;
        auto_invoice_enabled: number;
        auto_isolir_enabled: number;
        isolir_cutoff_day: number;
        isolir_profile_name: string;
        updated_at: string;
      }
    | undefined;

  if (row) {
    return {
      branch_id: row.branch_id,
      auto_invoice_enabled: row.auto_invoice_enabled === 1,
      auto_isolir_enabled: row.auto_isolir_enabled === 1,
      isolir_cutoff_day: row.isolir_cutoff_day,
      isolir_profile_name: row.isolir_profile_name || 'profile-isolir',
      updated_at: row.updated_at,
    };
  }

  const defaults = getBillingSettings();
  return {
    branch_id: branchId,
    auto_invoice_enabled: defaults.auto_invoice_enabled,
    auto_isolir_enabled: defaults.auto_isolir_enabled,
    isolir_cutoff_day: defaults.isolir_cutoff_day,
    isolir_profile_name: defaults.isolir_profile_name,
    updated_at: defaults.updated_at,
  };
}

export function getAllBranchBillingSettings(branchIdFilter?: number | null): BranchBillingAutomationSettings[] {
  const defaults = getBillingSettings();
  const rows = (
    branchIdFilter
      ? db
          .prepare(
            `SELECT b.id AS branch_id,
                    s.auto_invoice_enabled,
                    s.auto_isolir_enabled,
                    s.isolir_cutoff_day,
                    s.isolir_profile_name,
                    s.updated_at
             FROM branches b
             LEFT JOIN branch_billing_settings s ON s.branch_id = b.id
             WHERE b.id = ?
             ORDER BY b.id ASC`
          )
          .all(branchIdFilter)
      : db
          .prepare(
            `SELECT b.id AS branch_id,
                    s.auto_invoice_enabled,
                    s.auto_isolir_enabled,
                    s.isolir_cutoff_day,
                    s.isolir_profile_name,
                    s.updated_at
             FROM branches b
             LEFT JOIN branch_billing_settings s ON s.branch_id = b.id
             ORDER BY b.id ASC`
          )
          .all()
  ) as Array<{
    branch_id: number;
    auto_invoice_enabled: number | null;
    auto_isolir_enabled: number | null;
    isolir_cutoff_day: number | null;
    isolir_profile_name: string | null;
    updated_at: string | null;
  }>;

  return rows.map((row) => ({
    branch_id: row.branch_id,
    auto_invoice_enabled:
      row.auto_invoice_enabled !== null ? row.auto_invoice_enabled === 1 : defaults.auto_invoice_enabled,
    auto_isolir_enabled:
      row.auto_isolir_enabled !== null ? row.auto_isolir_enabled === 1 : defaults.auto_isolir_enabled,
    isolir_cutoff_day:
      row.isolir_cutoff_day !== null ? row.isolir_cutoff_day : defaults.isolir_cutoff_day,
    isolir_profile_name:
      (row.isolir_profile_name || defaults.isolir_profile_name || 'profile-isolir').trim() ||
      'profile-isolir',
    updated_at: row.updated_at || defaults.updated_at,
  }));
}

export function updateBranchBillingSettings(
  branchId: number,
  input: {
    auto_invoice_enabled: boolean;
    auto_isolir_enabled: boolean;
    isolir_cutoff_day: number;
    isolir_profile_name: string;
  }
): BranchBillingAutomationSettings {
  const now = nowIso();
  const cutoff = Math.min(28, Math.max(1, Math.round(Number(input.isolir_cutoff_day) || 5)));
  const profileName = (input.isolir_profile_name || 'profile-isolir').trim() || 'profile-isolir';

  db.prepare(
    `INSERT INTO branch_billing_settings
      (branch_id, auto_invoice_enabled, auto_isolir_enabled, isolir_cutoff_day, isolir_profile_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(branch_id) DO UPDATE SET
       auto_invoice_enabled = excluded.auto_invoice_enabled,
       auto_isolir_enabled = excluded.auto_isolir_enabled,
       isolir_cutoff_day = excluded.isolir_cutoff_day,
       isolir_profile_name = excluded.isolir_profile_name,
       updated_at = excluded.updated_at`
  ).run(
    branchId,
    input.auto_invoice_enabled ? 1 : 0,
    input.auto_isolir_enabled ? 1 : 0,
    cutoff,
    profileName,
    now
  );

  return getBranchBillingSettings(branchId);
}

export function getCustomerBillingProfile(
  branchId: number,
  customerName: string
): { original_profile: string; is_isolated: boolean } | null {
  const row = db
    .prepare(
      'SELECT original_profile, is_isolated FROM customer_billing_profiles WHERE branch_id = ? AND customer_name = ?'
    )
    .get(branchId, customerName) as { original_profile: string; is_isolated: number } | undefined;
  if (!row) return null;
  return {
    original_profile: row.original_profile,
    is_isolated: row.is_isolated === 1,
  };
}

export function upsertCustomerBillingProfile(
  branchId: number,
  customerName: string,
  originalProfile: string,
  isIsolated: boolean
): void {
  db.prepare(
    `INSERT INTO customer_billing_profiles (branch_id, customer_name, original_profile, is_isolated, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, customer_name) DO UPDATE SET
       original_profile = excluded.original_profile,
       is_isolated = excluded.is_isolated,
       updated_at = excluded.updated_at`
  ).run(branchId, customerName, originalProfile, isIsolated ? 1 : 0, nowIso());
}

export function normalizeWhatsAppNumber(raw: string): string {
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

export function normalizeOltHttpUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    throw new Error('Link HTTP OLT wajib diisi.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Format link HTTP OLT tidak valid. Contoh: http://192.168.10.2');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Link OLT harus menggunakan protokol http:// atau https://.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function normalizeRemoteUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return '';
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Format alamat remote tidak valid. Contoh: http://remote.cabang.id:8080');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Alamat remote harus menggunakan protokol http:// atau https://.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export function normalizeStarlinkRemoteUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    throw new Error('Alamat remote Starlink wajib diisi.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(
      'Format alamat remote Starlink tidak valid. Contoh: http://remote.cabang.id:9200'
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Alamat remote Starlink harus menggunakan protokol http:// atau https://.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export interface SandboxNatRuleRow {
  id: number;
  branch_id: number;
  chain: string;
  action: string;
  protocol: string;
  dst_port: string;
  to_addresses: string;
  to_ports: string;
  comment: string;
  disabled: number;
  updated_at: string;
}

export function ensureSandboxRemoteNatRule(branchId: number): SandboxNatRuleRow {
  const existing = db
    .prepare(
      "SELECT * FROM sandbox_nat_rules WHERE branch_id = ? AND LOWER(TRIM(comment)) = 'remot-onu' ORDER BY id ASC LIMIT 1"
    )
    .get(branchId) as SandboxNatRuleRow | undefined;
  if (existing) {
    return existing;
  }
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO sandbox_nat_rules (branch_id, chain, action, protocol, dst_port, to_addresses, to_ports, comment, disabled, updated_at)
       VALUES (?, 'dstnat', 'dst-nat', 'tcp', '8080', '', '80', 'remot-onu', 0, ?)`
    )
    .run(branchId, now);
  return db
    .prepare('SELECT * FROM sandbox_nat_rules WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as SandboxNatRuleRow;
}

export function getBranchWhatsAppMap(branchId: number): Map<string, string> {
  const rows = db
    .prepare('SELECT customer_name, whatsapp_number FROM customer_contacts WHERE branch_id = ?')
    .all(branchId) as Array<{ customer_name: string; whatsapp_number: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.whatsapp_number) {
      map.set(r.customer_name, r.whatsapp_number);
    }
  }
  return map;
}

export function setCustomerWhatsApp(
  branchId: number,
  customerName: string,
  whatsappNumber: string,
  previousName?: string
): string {
  const cleanName = customerName.trim();
  const normalized = normalizeWhatsAppNumber(whatsappNumber);
  if (previousName && previousName.trim() && previousName.trim() !== cleanName) {
    db.prepare('DELETE FROM customer_contacts WHERE branch_id = ? AND customer_name = ?').run(
      branchId,
      previousName.trim()
    );
  }
  if (!normalized) {
    db.prepare('DELETE FROM customer_contacts WHERE branch_id = ? AND customer_name = ?').run(
      branchId,
      cleanName
    );
    return '';
  }
  db.prepare(
    `INSERT INTO customer_contacts (branch_id, customer_name, whatsapp_number, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(branch_id, customer_name) DO UPDATE SET
       whatsapp_number = excluded.whatsapp_number,
       updated_at = excluded.updated_at`
  ).run(branchId, cleanName, normalized, nowIso());
  return normalized;
}

export function deleteCustomerContact(branchId: number, customerName: string): void {
  db.prepare('DELETE FROM customer_contacts WHERE branch_id = ? AND customer_name = ?').run(
    branchId,
    customerName.trim()
  );
}

export function recordAuditLog(params: {
  userId: number | null;
  username: string;
  userFullName: string;
  userRole: UserRole;
  branchId: number | null;
  branchName: string | null;
  action: string;
  target: string;
  details: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, user_full_name, user_role, branch_id, branch_name, action, target, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.username,
    params.userFullName,
    params.userRole,
    params.branchId,
    params.branchName,
    params.action,
    params.target,
    params.details,
    nowIso()
  );
}

export function ensureInitialAdmin(): void {
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
    .get() as { id: number } | undefined;

  if (!existingAdmin) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', NULL, 1, ?, ?)`
    ).run('admin', hashPassword('admin123'), 'Administrator Pusat', now, now);
  }
}

export function seedSandboxEnvironment(actor: {
  id: number;
  username: string;
  full_name: string;
}): { branchesCreated: number; staffCreated: number } {
  const existingBranches = db.prepare('SELECT COUNT(*) as c FROM branches').get() as { c: number };
  if (existingBranches.c > 0) {
    return { branchesCreated: 0, staffCreated: 0 };
  }

  const now = nowIso();
  const insertBranch = db.prepare(
    `INSERT INTO branches (name, location, connection_mode, host, port, username, password, remote_url, created_at)
     VALUES (?, ?, 'sandbox', ?, 8728, ?, ?, ?, ?)`
  );

  const b1 = insertBranch.run(
    'Cabang Barat - Sukamaju',
    'Kec. Sukamaju, Blok A–D',
    '10.10.1.1',
    'netops_api',
    'mikrotik_sandbox',
    'http://10.10.1.1:8080',
    now
  );
  const b2 = insertBranch.run(
    'Cabang Timur - Mekarsari',
    'Perumahan Mekarsari Indah',
    '10.20.1.1',
    'netops_api',
    'mikrotik_sandbox',
    'http://10.20.1.1:8080',
    now
  );

  const b1Id = Number(b1.lastInsertRowid);
  const b2Id = Number(b2.lastInsertRowid);

  db.prepare(
    `INSERT INTO sandbox_nat_rules (branch_id, chain, action, protocol, dst_port, to_addresses, to_ports, comment, disabled, updated_at)
     VALUES (?, 'dstnat', 'dst-nat', 'tcp', '8080', ?, '80', 'remot-onu', 0, ?)`
  ).run(b1Id, '172.16.10.11', now);
  db.prepare(
    `INSERT INTO sandbox_nat_rules (branch_id, chain, action, protocol, dst_port, to_addresses, to_ports, comment, disabled, updated_at)
     VALUES (?, 'dstnat', 'dst-nat', 'tcp', '8080', ?, '80', 'remot-onu', 0, ?)`
  ).run(b2Id, '172.16.20.12', now);

  const insertProfile = db.prepare('INSERT INTO sandbox_profiles (branch_id, name) VALUES (?, ?)');
  const defaultPrices: Array<[string, number]> = [
    ['10Mbps-Rumahan', 150000],
    ['20Mbps-Keluarga', 200000],
    ['35Mbps-Bisnis', 300000],
    ['50Mbps-Prioritas', 450000],
    ['profile-isolir', 0],
  ];
  for (const branchId of [b1Id, b2Id]) {
    for (const [prof, price] of defaultPrices) {
      insertProfile.run(branchId, prof);
      db.prepare(
        `INSERT INTO package_prices (branch_id, profile_name, price_idr, updated_at) VALUES (?, ?, ?, ?)`
      ).run(branchId, prof, price, now);
    }
  }

  const insertSecret = db.prepare(
    `INSERT INTO sandbox_secrets (branch_id, name, password, service, profile, disabled, is_online, active_address, caller_id, uptime)
     VALUES (?, ?, ?, 'pppoe', ?, 0, ?, ?, ?, ?)`
  );

  insertSecret.run(b1Id, 'budi.blokA01', 'Infinix1', '20Mbps-Keluarga', 1, '172.16.10.11', '48:A9:8A:11:22:01', '2d 14:22:10');
  insertSecret.run(b1Id, 'siti.blokA04', 'Infinix1', '10Mbps-Rumahan', 1, '172.16.10.14', 'D4:CA:6D:44:10:02', '6d 03:11:45');
  insertSecret.run(b1Id, 'warung.pakrt', 'Infinix1', '35Mbps-Bisnis', 1, '172.16.10.20', 'CC:2D:E0:71:99:08', '1d 08:40:19');
  insertSecret.run(b1Id, 'hendra.blokB02', 'Infinix1', '10Mbps-Rumahan', 0, null, null, null);
  insertSecret.run(b1Id, 'rina.blokC07', 'Infinix1', '20Mbps-Keluarga', 1, '172.16.10.31', '74:4D:28:32:18:4A', '11:05:33');

  insertSecret.run(b2Id, 'agus.mekar02', 'Infinix1', '20Mbps-Keluarga', 1, '172.16.20.12', '18:FD:74:55:01:AA', '4d 19:02:11');
  insertSecret.run(b2Id, 'toko.berkah', 'Infinix1', '50Mbps-Prioritas', 1, '172.16.20.15', 'DC:2C:6E:88:34:B1', '9d 07:15:40');
  insertSecret.run(b2Id, 'dian.mekar09', 'Infinix1', '10Mbps-Rumahan', 0, null, null, null);

  const insertWa = db.prepare(
    `INSERT INTO customer_contacts (branch_id, customer_name, whatsapp_number, updated_at) VALUES (?, ?, ?, ?)`
  );
  insertWa.run(b1Id, 'budi.blokA01', '6281234567801', now);
  insertWa.run(b1Id, 'siti.blokA04', '6281234567802', now);
  insertWa.run(b1Id, 'warung.pakrt', '6281234567803', now);
  insertWa.run(b1Id, 'hendra.blokB02', '6281234567804', now);
  insertWa.run(b1Id, 'rina.blokC07', '6281234567805', now);
  insertWa.run(b2Id, 'agus.mekar02', '6281234567806', now);
  insertWa.run(b2Id, 'toko.berkah', '6281234567807', now);
  insertWa.run(b2Id, 'dian.mekar09', '6281234567808', now);

  const insertOlt = db.prepare(
    `INSERT INTO olt_links (branch_id, name, http_url, notes, login_username, login_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertOlt.run(b1Id, 'OLT Pusat Barat (EPON)', 'http://10.10.1.2', 'Web UI OLT Cabang Barat · Port 80', 'admin', 'oltbarat123', now, now);
  insertOlt.run(b2Id, 'OLT Mekarsari (GPON)', 'http://10.20.1.2:8080', 'Web UI OLT Cabang Timur · Port 8080', 'admin', 'olttimur123', now, now);

  const insertStarlink = db.prepare(
    `INSERT INTO starlink_remotes (branch_id, name, remote_url, local_ip, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertStarlink.run(
    b1Id,
    'Starlink Utama Barat',
    'http://10.10.1.1:9200',
    '192.168.100.1',
    'Port forward remote ke IP lokal Starlink 192.168.100.1',
    now,
    now
  );

  // Seed initial billing invoices & operational cashflow for current month
  const period = currentPeriod();
  const todayDate = now.slice(0, 10);
  const insertInv = db.prepare(
    `INSERT INTO customer_invoices (branch_id, customer_name, profile_name, period, amount_idr, status, payment_method, paid_at, paid_by_name, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTx = db.prepare(
    `INSERT INTO finance_transactions (branch_id, type, category, description, amount_idr, transaction_date, payment_method, invoice_id, created_by_id, created_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const paidB1a = insertInv.run(b1Id, 'budi.blokA01', '20Mbps-Keluarga', period, 200000, 'lunas', 'Transfer Bank', now, actor.full_name, 'Transfer BCA', now, now);
  insertTx.run(b1Id, 'pemasukan', 'Iuran Bulanan PPPoE', `Pembayaran budi.blokA01 (20Mbps-Keluarga · ${period})`, 200000, todayDate, 'Transfer Bank', Number(paidB1a.lastInsertRowid), actor.id, actor.full_name, now);

  const paidB1b = insertInv.run(b1Id, 'siti.blokA04', '10Mbps-Rumahan', period, 150000, 'lunas', 'Tunai', now, actor.full_name, '', now, now);
  insertTx.run(b1Id, 'pemasukan', 'Iuran Bulanan PPPoE', `Pembayaran siti.blokA04 (10Mbps-Rumahan · ${period})`, 150000, todayDate, 'Tunai', Number(paidB1b.lastInsertRowid), actor.id, actor.full_name, now);

  const paidB1c = insertInv.run(b1Id, 'warung.pakrt', '35Mbps-Bisnis', period, 300000, 'lunas', 'QRIS', now, actor.full_name, '', now, now);
  insertTx.run(b1Id, 'pemasukan', 'Iuran Bulanan PPPoE', `Pembayaran warung.pakrt (35Mbps-Bisnis · ${period})`, 300000, todayDate, 'QRIS', Number(paidB1c.lastInsertRowid), actor.id, actor.full_name, now);

  insertInv.run(b1Id, 'hendra.blokB02', '10Mbps-Rumahan', period, 150000, 'belum_bayar', null, null, null, '', now, now);
  insertInv.run(b1Id, 'rina.blokC07', '20Mbps-Keluarga', period, 200000, 'belum_bayar', null, null, null, '', now, now);

  const paidB2a = insertInv.run(b2Id, 'toko.berkah', '50Mbps-Prioritas', period, 450000, 'lunas', 'Transfer Bank', now, actor.full_name, '', now, now);
  insertTx.run(b2Id, 'pemasukan', 'Iuran Bulanan PPPoE', `Pembayaran toko.berkah (50Mbps-Prioritas · ${period})`, 450000, todayDate, 'Transfer Bank', Number(paidB2a.lastInsertRowid), actor.id, actor.full_name, now);

  insertInv.run(b2Id, 'agus.mekar02', '20Mbps-Keluarga', period, 200000, 'belum_bayar', null, null, null, '', now, now);
  insertInv.run(b2Id, 'dian.mekar09', '10Mbps-Rumahan', period, 150000, 'belum_bayar', null, null, null, '', now, now);

  // Sample operational expenses
  insertTx.run(b1Id, 'pengeluaran', 'Bandwidth Upstream', 'Pembayaran bandwidth metro bulan berjalan', 450000, todayDate, 'Transfer Bank', null, actor.id, actor.full_name, now);
  insertTx.run(b1Id, 'pengeluaran', 'Perawatan Jaringan & ODP', 'Penggantian patchcord & splitter 1:8 Blok B', 125000, todayDate, 'Tunai', null, actor.id, actor.full_name, now);
  insertTx.run(b2Id, 'pemasukan', 'Biaya Pasang Baru (PSB)', 'Instalasi baru rumah blok D03 + ONT', 250000, todayDate, 'Tunai', null, actor.id, actor.full_name, now);

  let staffCreated = 0;
  const existingStaff = db
    .prepare("SELECT id FROM users WHERE username = 'staf_barat'")
    .get();
  if (!existingStaff) {
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'staff', ?, 1, ?, ?)`
    ).run('staf_barat', hashPassword('staf123'), 'Rizky Pratama (Staf Barat)', b1Id, now, now);
    staffCreated = 1;
  }

  recordAuditLog({
    userId: actor.id,
    username: actor.username,
    userFullName: actor.full_name,
    userRole: 'admin',
    branchId: b1Id,
    branchName: 'Cabang Barat - Sukamaju',
    action: 'TAMBAH_CABANG',
    target: 'Cabang Barat & Timur (Sandbox)',
    details: 'Membuat 2 cabang uji coba Sandbox beserta data PPPoE, keuangan, dan akun staf_barat.',
  });

  return { branchesCreated: 2, staffCreated };
}

export function syncPaidInvoicesToTransactions(): void {
  const now = nowIso();
  const tx = db.transaction(() => {
    // 1. Hapus transaksi terkait tagihan yang tidak lagi berstatus lunas atau tagihannya sudah hilang
    db.prepare(
      `DELETE FROM finance_transactions
       WHERE invoice_id IS NOT NULL
         AND (
           invoice_id NOT IN (SELECT id FROM customer_invoices)
           OR invoice_id IN (SELECT id FROM customer_invoices WHERE status != 'lunas')
         )`
    ).run();

    // 2. Sinkronkan nominal & cabang jika tagihan lunas berubah nominalnya
    db.prepare(
      `UPDATE finance_transactions
       SET amount_idr = (
             SELECT ci.amount_idr FROM customer_invoices ci WHERE ci.id = finance_transactions.invoice_id
           ),
           branch_id = (
             SELECT ci.branch_id FROM customer_invoices ci WHERE ci.id = finance_transactions.invoice_id
           )
       WHERE invoice_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM customer_invoices ci
           WHERE ci.id = finance_transactions.invoice_id
             AND (ci.amount_idr != finance_transactions.amount_idr OR ci.branch_id != finance_transactions.branch_id)
         )`
    ).run();

    // 3. Lengkapi transaksi pemasukan untuk tagihan berstatus lunas yang belum memiliki entri arus kas
    const missingPaid = db
      .prepare(
        `SELECT ci.*
         FROM customer_invoices ci
         WHERE ci.status = 'lunas'
           AND NOT EXISTS (
             SELECT 1 FROM finance_transactions ft WHERE ft.invoice_id = ci.id
           )`
      )
      .all() as Array<{
      id: number;
      branch_id: number;
      customer_name: string;
      profile_name: string;
      period: string;
      amount_idr: number;
      payment_method: string | null;
      paid_at: string | null;
      paid_by_name: string | null;
      created_at: string;
    }>;

    const insertTx = db.prepare(
      `INSERT INTO finance_transactions
        (branch_id, type, category, description, amount_idr, transaction_date, payment_method, invoice_id, created_by_id, created_by_name, created_at)
       VALUES (?, 'pemasukan', 'Iuran Bulanan PPPoE', ?, ?, ?, ?, ?, NULL, ?, ?)`
    );

    for (const inv of missingPaid) {
      const txDate =
        inv.paid_at && /^\d{4}-\d{2}-\d{2}/.test(inv.paid_at)
          ? inv.paid_at.slice(0, 10)
          : `${inv.period}-01`;
      insertTx.run(
        inv.branch_id,
        `Pembayaran ${inv.customer_name} (${inv.profile_name} · ${inv.period})`,
        inv.amount_idr,
        txDate,
        inv.payment_method || 'Tunai',
        inv.id,
        inv.paid_by_name || 'Sistem',
        inv.created_at || now
      );
    }
  });
  tx();
}

export function formatOfflineDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (days > 0) {
    return `${days} hari ${hours} jam ${minutes} mnt`;
  }
  if (hours > 0) {
    return `${hours} jam ${minutes} mnt`;
  }
  if (minutes > 0) {
    return `${minutes} mnt ${seconds} dtk`;
  }
  return `${seconds} dtk`;
}

export function recordBranchHealthCheck(
  branchId: number,
  online: boolean,
  checkedAt = nowIso()
): { offlineSince: string | null; offlineDuration: string | null } {
  if (!branchId || branchId <= 0) {
    return {
      offlineSince: online ? null : checkedAt,
      offlineDuration: online ? null : '0 dtk',
    };
  }

  const existing = db
    .prepare('SELECT is_online, last_online_at, offline_since FROM branch_health_state WHERE branch_id = ?')
    .get(branchId) as
    | { is_online: number; last_online_at: string | null; offline_since: string | null }
    | undefined;

  if (online) {
    db.prepare(
      `INSERT INTO branch_health_state (branch_id, is_online, last_online_at, offline_since, last_checked_at)
       VALUES (?, 1, ?, NULL, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         is_online = 1,
         last_online_at = excluded.last_online_at,
         offline_since = NULL,
         last_checked_at = excluded.last_checked_at`
    ).run(branchId, checkedAt, checkedAt);

    return { offlineSince: null, offlineDuration: null };
  }

  const offlineSince = existing?.offline_since || checkedAt;
  db.prepare(
    `INSERT INTO branch_health_state (branch_id, is_online, last_online_at, offline_since, last_checked_at)
     VALUES (?, 0, ?, ?, ?)
     ON CONFLICT(branch_id) DO UPDATE SET
       is_online = 0,
       offline_since = COALESCE(branch_health_state.offline_since, excluded.offline_since),
       last_checked_at = excluded.last_checked_at`
  ).run(branchId, existing?.last_online_at || null, offlineSince, checkedAt);

  const elapsedSec = Math.max(
    0,
    Math.floor((Date.parse(checkedAt) - Date.parse(offlineSince)) / 1000)
  );

  return {
    offlineSince,
    offlineDuration: formatOfflineDuration(Number.isFinite(elapsedSec) ? elapsedSec : 0),
  };
}

ensureInitialAdmin();
syncPaidInvoicesToTransactions();
