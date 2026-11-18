import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  clearSessionCookie,
  createSessionToken,
  loadUserById,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  type AuthedRequest,
} from './server/auth.ts';
import {
  currentPeriod,
  db,
  deleteCustomerContact,
  getAllowedPackageMap,
  getAllBranchBillingSettings,
  getBillingSettings,
  getBranchBillingSettings,
  getBranchWhatsAppMap,
  getPackagePriceMap,
  hashPassword,
  isPackageAllowed,
  normalizeOltHttpUrl,
  normalizeRemoteUrl,
  normalizeStarlinkRemoteUrl,
  nowIso,
  recordAuditLog,
  seedSandboxEnvironment,
  setCustomerWhatsApp,
  setPackagePrices,
  setPackagesAllowed,
  syncPaidInvoicesToTransactions,
  updateBillingSettings,
  updateBranchBillingSettings,
  verifyPassword,
  type ConnectionMode,
  type DbAuditLog,
  type DbBranch,
  type DbUser,
} from './server/db.ts';
import {
  generateInvoicesForBranch,
  restoreCustomerProfileIfEligible,
  runBillingAutomationCycle,
} from './server/billingAutomation.ts';
import {
  addBranchCustomer,
  addBranchProfile,
  deleteBranchCustomer,
  deleteBranchProfile,
  getBranchCustomers,
  getBranchOnuRemoteData,
  getBranchProfiles,
  getBranchStatus,
  pingFromBranch,
  setBranchOnuRemoteTarget,
  updateBranchCustomer,
  updateBranchProfile,
} from './server/mikrotik.ts';
import {
  getStarlinkStatusViaRemote,
  rebootStarlinkViaRemote,
  testStarlinkViaRemote,
} from './server/starlink.ts';

function parseCliArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }
  }
  return undefined;
}

const cliPort = Number(parseCliArg('port'));
const PORT = Number.isFinite(cliPort) && cliPort > 0 ? cliPort : Number(process.env.PORT) || 3000;
const HOST = parseCliArg('host') || '0.0.0.0';
const VALID_MODES = new Set<ConnectionMode>(['api', 'api-ssl', 'rest-http', 'rest-https', 'sandbox']);

function sanitizeBranch(b: DbBranch) {
  return {
    id: b.id,
    name: b.name,
    location: b.location,
    connection_mode: b.connection_mode,
    host: b.host,
    port: b.port,
    username: b.username,
    remote_url: b.remote_url || '',
    created_at: b.created_at,
  };
}

function getBranchForUser(req: AuthedRequest, branchId: number): DbBranch | null {
  const user = req.authUser;
  if (!user) return null;
  if (user.role === 'staff' && user.branch_id !== branchId) {
    return null;
  }
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId) as DbBranch | undefined;
  return branch ?? null;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- Auth Routes ---

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const row = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username.trim()) as DbUser | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }
    if (row.is_active !== 1) {
      res.status(403).json({ error: 'Akun ini sedang dinonaktifkan oleh Admin.' });
      return;
    }

    const user = loadUserById(row.id);
    if (!user) {
      res.status(401).json({ error: 'Akun tidak valid.' });
      return;
    }

    const token = createSessionToken(user.id, user.role);
    setSessionCookie(req, res, token);
    res.json({ token, user });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.authUser });
  });

  // --- Dashboard ---

  app.get('/api/dashboard', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    let branches: DbBranch[] = [];
    let logs: DbAuditLog[] = [];

    if (user.role === 'admin') {
      branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all() as DbBranch[];
      logs = db
        .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50')
        .all() as DbAuditLog[];
    } else {
      if (user.branch_id) {
        const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(user.branch_id) as
          | DbBranch
          | undefined;
        if (b) branches = [b];
        logs = db
          .prepare(
            "SELECT * FROM audit_logs WHERE user_role = 'staff' AND branch_id = ? ORDER BY id DESC LIMIT 50"
          )
          .all(user.branch_id) as DbAuditLog[];
      }
    }

    const branchStatuses = await Promise.all(branches.map((b) => getBranchStatus(b)));

    syncPaidInvoicesToTransactions();
    const profitPeriod = currentPeriod();
    const profitMap = new Map<number, { totalIncome: number; totalExpense: number }>();

    if (branches.length > 0) {
      const branchIds = branches.map((b) => b.id);
      const placeholders = branchIds.map(() => '?').join(', ');
      const profitRows = db
        .prepare(
          `SELECT ft.branch_id AS branch_id,
                  SUM(CASE WHEN ft.type = 'pemasukan' THEN ft.amount_idr ELSE 0 END) AS total_income,
                  SUM(CASE WHEN ft.type = 'pengeluaran' THEN ft.amount_idr ELSE 0 END) AS total_expense
           FROM finance_transactions ft
           LEFT JOIN customer_invoices ci ON ci.id = ft.invoice_id
           WHERE ft.branch_id IN (${placeholders})
             AND (
               (ft.invoice_id IS NOT NULL AND ci.period = ?)
               OR (ft.invoice_id IS NULL AND ft.transaction_date LIKE ?)
             )
           GROUP BY ft.branch_id`
        )
        .all(...branchIds, profitPeriod, `${profitPeriod}-%`) as Array<{
        branch_id: number;
        total_income: number;
        total_expense: number;
      }>;

      for (const row of profitRows) {
        profitMap.set(row.branch_id, {
          totalIncome: Number(row.total_income) || 0,
          totalExpense: Number(row.total_expense) || 0,
        });
      }
    }

    const branchProfits = branches.map((b) => {
      const stats = profitMap.get(b.id) || { totalIncome: 0, totalExpense: 0 };
      return {
        branchId: b.id,
        branchName: b.name,
        totalIncome: stats.totalIncome,
        totalExpense: stats.totalExpense,
        netProfit: stats.totalIncome - stats.totalExpense,
      };
    });

    res.json({
      branches: branchStatuses,
      logs,
      profitPeriod,
      branchProfits,
    });
  });

  // --- Branches (Cabang) ---

  app.get('/api/branches', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role === 'admin') {
      const rows = db.prepare('SELECT * FROM branches ORDER BY id ASC').all() as DbBranch[];
      res.json({ branches: rows.map(sanitizeBranch) });
      return;
    }
    if (!user.branch_id) {
      res.json({ branches: [] });
      return;
    }
    const row = db.prepare('SELECT * FROM branches WHERE id = ?').get(user.branch_id) as
      | DbBranch
      | undefined;
    res.json({ branches: row ? [sanitizeBranch(row)] : [] });
  });

  app.post('/api/branches/test', requireAuth, requireAdmin, async (req, res) => {
    const { connection_mode, host, port, username, password } = req.body as {
      connection_mode?: ConnectionMode;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
    };

    if (!connection_mode || !VALID_MODES.has(connection_mode) || !host) {
      res.status(400).json({ error: 'Host dan metode koneksi wajib diisi.' });
      return;
    }

    const tempBranch: DbBranch = {
      id: 0,
      name: 'Uji Koneksi',
      location: '-',
      connection_mode,
      host: host.trim(),
      port: Number(port) || 8728,
      username: (username || '').trim(),
      password: password || '',
      remote_url: '',
      created_at: nowIso(),
    };

    const status = await getBranchStatus(tempBranch);
    res.json(status);
  });

  app.post('/api/branches/seed-sandbox', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const result = seedSandboxEnvironment(req.authUser!);
    res.json(result);
  });

  app.post('/api/branches', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const { name, location, connection_mode, host, port, username, password, remote_url } =
      req.body as {
        name?: string;
        location?: string;
        connection_mode?: ConnectionMode;
        host?: string;
        port?: number;
        username?: string;
        password?: string;
        remote_url?: string;
      };

    if (!name?.trim() || !location?.trim() || !host?.trim()) {
      res.status(400).json({ error: 'Nama cabang, lokasi, dan host MikroTik wajib diisi.' });
      return;
    }
    const mode: ConnectionMode =
      connection_mode && VALID_MODES.has(connection_mode) ? connection_mode : 'api';

    if (mode !== 'sandbox' && !username?.trim()) {
      res.status(400).json({ error: 'Username API MikroTik wajib diisi.' });
      return;
    }

    let normalizedRemoteUrl = '';
    try {
      normalizedRemoteUrl = normalizeRemoteUrl(remote_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format alamat remote cabang tidak valid.',
      });
      return;
    }

    const defaultPort =
      mode === 'api-ssl'
        ? 8729
        : mode === 'rest-http'
          ? 80
          : mode === 'rest-https'
            ? 443
            : 8728;

    const resolvedPort = Number(port) > 0 ? Number(port) : defaultPort;

    const info = db
      .prepare(
        `INSERT INTO branches (name, location, connection_mode, host, port, username, password, remote_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        location.trim(),
        mode,
        host.trim(),
        resolvedPort,
        (username || 'sandbox').trim(),
        password || '',
        normalizedRemoteUrl,
        nowIso()
      );

    const newId = Number(info.lastInsertRowid);
    if (mode === 'sandbox') {
      const insertProf = db.prepare('INSERT INTO sandbox_profiles (branch_id, name) VALUES (?, ?)');
      for (const p of ['10Mbps-Rumahan', '20Mbps-Keluarga', '35Mbps-Bisnis', 'default']) {
        insertProf.run(newId, p);
      }
    }

    const created = db.prepare('SELECT * FROM branches WHERE id = ?').get(newId) as DbBranch;

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: newId,
      branchName: created.name,
      action: 'TAMBAH_CABANG',
      target: created.name,
      details: `Menambahkan cabang ${created.name} (${created.host}:${created.port} · ${created.connection_mode}${normalizedRemoteUrl ? ` · Remote: ${normalizedRemoteUrl}` : ''}).`,
    });

    res.status(201).json({ branch: sanitizeBranch(created) });
  });

  app.put('/api/branches/:id/remote-url', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as DbBranch | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    const { remote_url } = req.body as { remote_url?: string };
    let normalizedRemoteUrl = '';
    try {
      normalizedRemoteUrl = normalizeRemoteUrl(remote_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format alamat remote cabang tidak valid.',
      });
      return;
    }

    db.prepare('UPDATE branches SET remote_url = ? WHERE id = ?').run(normalizedRemoteUrl, id);
    const updated = db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as DbBranch;

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'ATUR_REMOTE_CABANG',
      target: branch.name,
      details: normalizedRemoteUrl
        ? `Mengatur alamat remote ONU cabang ${branch.name} menjadi ${normalizedRemoteUrl}.`
        : `Menghapus alamat remote ONU cabang ${branch.name}.`,
    });

    res.json({ branch: sanitizeBranch(updated) });
  });

  app.delete('/api/branches/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as DbBranch | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    db.prepare('DELETE FROM branches WHERE id = ?').run(id);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: null,
      branchName: branch.name,
      action: 'HAPUS_CABANG',
      target: branch.name,
      details: `Menghapus cabang ${branch.name} (${branch.host}).`,
    });

    res.json({ ok: true });
  });

  // --- Pelanggan (PPPoE Secrets) ---

  app.get('/api/branches/:id/customers', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const data = await getBranchCustomers(branch);
    const allowedMap = getAllowedPackageMap(branch.id);
    const waMap = getBranchWhatsAppMap(branch.id);
    const allowedProfiles = data.profiles.filter((name) =>
      allowedMap.has(name) ? allowedMap.get(name)! : true
    );
    const customersWithContacts = data.customers.map((c) => ({
      ...c,
      whatsappNumber: waMap.get(c.name) || '',
    }));

    res.json({
      branch: sanitizeBranch(branch),
      ...data,
      customers: customersWithContacts,
      profiles: allowedProfiles,
    });
  });

  // --- Remote ONU Pelanggan (IP > Firewall > NAT comment=remot-onu) ---

  app.get('/api/branches/:id/onu-remote', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const data = await getBranchOnuRemoteData(branch);
    res.json({
      branch: sanitizeBranch(branch),
      ...data,
    });
  });

  app.post('/api/branches/:id/onu-remote', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { ipAddress, customerName } = req.body as {
      ipAddress?: string;
      customerName?: string;
    };

    if (!ipAddress?.trim()) {
      res.status(400).json({ error: 'IP pelanggan yang akan di-remote wajib diisi.' });
      return;
    }

    try {
      const natRule = await setBranchOnuRemoteTarget(branch, ipAddress.trim());
      const targetLabel = customerName?.trim()
        ? `${customerName.trim()} (${natRule.toAddresses})`
        : natRule.toAddresses;

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'REMOTE_ONU_PELANGGAN',
        target: targetLabel,
        details: `Mengubah action to-addresses NAT (komen: remot-onu) cabang ${branch.name} ke IP ${natRule.toAddresses}${customerName?.trim() ? ` untuk pelanggan "${customerName.trim()}"` : ''}.`,
      });

      res.json({
        ok: true,
        branch: sanitizeBranch(branch),
        natRule,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal memperbarui rule NAT remot-onu di MikroTik.',
      });
    }
  });

  app.post('/api/branches/:id/customers', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { name, service, profile, wifiName, wifiPassword, whatsappNumber } = req.body as {
      name?: string;
      service?: string;
      profile?: string;
      wifiName?: string;
      wifiPassword?: string;
      whatsappNumber?: string;
    };

    if (!name?.trim() || !profile?.trim()) {
      res.status(400).json({ error: 'Nama user PPPoE dan profile wajib diisi.' });
      return;
    }

    if (!isPackageAllowed(branch.id, profile.trim())) {
      res.status(400).json({
        error: `Paket "${profile.trim()}" tidak diizinkan untuk digunakan pada cabang ini.`,
      });
      return;
    }

    // Sesuai catatan user: PASSWORD di buat fix menjadi Infinix1, service pppoe
    const fixedPassword = 'Infinix1';
    const fixedService = service?.trim() || 'pppoe';

    try {
      await addBranchCustomer(branch, {
        name: name.trim(),
        password: fixedPassword,
        service: fixedService,
        profile: profile.trim(),
        wifiName: (wifiName || '').trim(),
        wifiPassword: (wifiPassword || '').trim(),
      });

      const savedWa = whatsappNumber?.trim()
        ? setCustomerWhatsApp(branch.id, name.trim(), whatsappNumber)
        : '';

      const wifiNote = wifiName?.trim() ? `, WiFi: ${wifiName.trim()}` : '';
      const waNote = savedWa ? `, WA: ${savedWa}` : '';

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'TAMBAH_PELANGGAN',
        target: name.trim(),
        details: `Menambah PPPoE secret "${name.trim()}" (service: ${fixedService}, profile: ${profile.trim()}, password: Infinix1${wifiNote}${waNote}).`,
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menambah secret PPPoE ke MikroTik.',
      });
    }
  });

  app.put('/api/branches/:id/customers/:secretId', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const secretId = decodeURIComponent(req.params.secretId);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { name, oldName, password, service, profile, wifiName, wifiPassword, whatsappNumber } =
      req.body as {
        name?: string;
        oldName?: string;
        password?: string;
        service?: string;
        profile?: string;
        wifiName?: string;
        wifiPassword?: string;
        whatsappNumber?: string;
      };

    if (!name?.trim() || !password?.trim() || !service?.trim() || !profile?.trim()) {
      res.status(400).json({ error: 'Keempat kolom (Name, Password, Service, Profile) wajib diisi.' });
      return;
    }

    if (!isPackageAllowed(branch.id, profile.trim())) {
      res.status(400).json({
        error: `Paket "${profile.trim()}" tidak diizinkan untuk digunakan. Pilih paket yang diizinkan.`,
      });
      return;
    }

    try {
      const { removedActiveCount } = await updateBranchCustomer(branch, secretId, {
        name: name.trim(),
        password: password.trim(),
        service: service.trim(),
        profile: profile.trim(),
        wifiName: (wifiName || '').trim(),
        wifiPassword: (wifiPassword || '').trim(),
      });

      if (whatsappNumber !== undefined) {
        setCustomerWhatsApp(branch.id, name.trim(), whatsappNumber, oldName);
      }

      const activeNote =
        removedActiveCount > 0
          ? ` (${removedActiveCount} active connection di-remove)`
          : '';
      const wifiNote = wifiName?.trim() ? `, WiFi: ${wifiName.trim()}` : '';

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'EDIT_PELANGGAN',
        target: name.trim(),
        details: `Mengubah PPPoE secret "${name.trim()}" (service: ${service.trim()}, profile: ${profile.trim()}${wifiNote})${activeNote}.`,
      });

      res.json({ ok: true, removedActiveCount });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal mengubah secret PPPoE di MikroTik.',
      });
    }
  });

  app.put('/api/branches/:id/customers-whatsapp', requireAuth, (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { customerName, whatsappNumber } = req.body as {
      customerName?: string;
      whatsappNumber?: string;
    };

    if (!customerName?.trim()) {
      res.status(400).json({ error: 'Nama pelanggan wajib diisi.' });
      return;
    }

    const saved = setCustomerWhatsApp(branch.id, customerName.trim(), whatsappNumber || '');

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: branch.id,
      branchName: branch.name,
      action: 'ATUR_WA_PELANGGAN',
      target: customerName.trim(),
      details: saved
        ? `Memperbarui nomor WhatsApp pelanggan "${customerName.trim()}" (${saved}).`
        : `Menghapus nomor WhatsApp pelanggan "${customerName.trim()}".`,
    });

    res.json({ ok: true, whatsappNumber: saved });
  });

  app.delete(
    '/api/branches/:id/customers/:secretId',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const branchId = Number(req.params.id);
      const secretId = decodeURIComponent(req.params.secretId);
      const branch = getBranchForUser(req, branchId);
      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const targetName = (req.query.name as string) || secretId;

      try {
        await deleteBranchCustomer(branch, secretId);
        deleteCustomerContact(branch.id, targetName);

        recordAuditLog({
          userId: req.authUser!.id,
          username: req.authUser!.username,
          userFullName: req.authUser!.full_name,
          userRole: req.authUser!.role,
          branchId: branch.id,
          branchName: branch.name,
          action: 'HAPUS_PELANGGAN',
          target: targetName,
          details: `Menghapus PPPoE secret "${targetName}" dari cabang ${branch.name}.`,
        });

        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal menghapus secret PPPoE dari MikroTik.',
        });
      }
    }
  );

  // Sandbox connection state toggle for easy testing of active/inactive status
  app.post('/api/branches/:id/sandbox/toggle-active', requireAuth, (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch || branch.connection_mode !== 'sandbox') {
      res.status(400).json({ error: 'Fitur ini hanya berlaku untuk cabang mode Sandbox.' });
      return;
    }
    const { secretId } = req.body as { secretId?: string };
    const row = db
      .prepare('SELECT * FROM sandbox_secrets WHERE id = ? AND branch_id = ?')
      .get(Number(secretId), branchId) as { id: number; is_online: number } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
      return;
    }
    const nextOnline = row.is_online === 1 ? 0 : 1;
    db.prepare(
      `UPDATE sandbox_secrets
       SET is_online = ?,
           active_address = CASE WHEN ? = 1 THEN COALESCE(active_address, '172.16.' || branch_id || '.' || (10 + (id % 200))) ELSE NULL END,
           uptime = CASE WHEN ? = 1 THEN COALESCE(uptime, '00:05:12') ELSE NULL END
       WHERE id = ?`
    ).run(nextOnline, nextOnline, nextOnline, row.id);
    res.json({ ok: true, is_online: nextOnline === 1 });
  });

  // --- Paket Internet (PPPoE Profiles) ---

  app.get('/api/branches/:id/packages', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const data = await getBranchProfiles(branch);
    const allowedMap = getAllowedPackageMap(branch.id);
    const packages = data.packages.map((pkg) => ({
      ...pkg,
      allowed: allowedMap.has(pkg.name) ? allowedMap.get(pkg.name)! : true,
    }));

    res.json({
      branch: sanitizeBranch(branch),
      ...data,
      packages,
    });
  });

  app.put(
    '/api/branches/:id/packages/allowed',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const branchId = Number(req.params.id);
      const branch = getBranchForUser(req, branchId);
      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const body = req.body as {
        profileName?: string;
        allowed?: boolean;
        items?: Array<{ profileName: string; allowed: boolean }>;
      };

      const items: Array<{ profileName: string; allowed: boolean }> = Array.isArray(body.items)
        ? body.items
            .filter((i) => typeof i.profileName === 'string' && i.profileName.trim().length > 0)
            .map((i) => ({ profileName: i.profileName.trim(), allowed: Boolean(i.allowed) }))
        : body.profileName?.trim()
          ? [{ profileName: body.profileName.trim(), allowed: Boolean(body.allowed) }]
          : [];

      if (items.length === 0) {
        res.status(400).json({ error: 'Daftar pilihan paket wajib diisi.' });
        return;
      }

      setPackagesAllowed(branch.id, items);

      const summaryTarget =
        items.length === 1 ? items[0].profileName : `${items.length} paket internet`;
      const summaryDetail =
        items.length === 1
          ? `Mengatur paket "${items[0].profileName}" menjadi ${items[0].allowed ? 'boleh digunakan' : 'tidak diizinkan'}.`
          : `Memperbarui izin penggunaan untuk ${items.length} paket internet di cabang ${branch.name}.`;

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'ATUR_PAKET_DIIZINKAN',
        target: summaryTarget,
        details: summaryDetail,
      });

      res.json({ ok: true });
    }
  );

  app.post('/api/branches/:id/packages', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    const { name, localAddress, remoteAddress, rateLimit, dnsServer, onlyOne, parentQueue } = req.body as {
      name?: string;
      localAddress?: string;
      remoteAddress?: string;
      rateLimit?: string;
      dnsServer?: string;
      onlyOne?: string;
      parentQueue?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nama paket internet wajib diisi.' });
      return;
    }

    try {
      await addBranchProfile(branch, {
        name: name.trim(),
        localAddress: (localAddress || '').trim(),
        remoteAddress: (remoteAddress || '').trim(),
        rateLimit: (rateLimit || '').trim(),
        dnsServer: (dnsServer || '').trim(),
        onlyOne: (onlyOne || 'yes').trim(),
        parentQueue: (parentQueue || '').trim(),
      });

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'TAMBAH_PAKET',
        target: name.trim(),
        details: `Menambah paket internet "${name.trim()}" (rate-limit: ${rateLimit?.trim() || 'unlimited'}).`,
      });

      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menambah paket internet ke MikroTik.',
      });
    }
  });

  app.put(
    '/api/branches/:id/packages/:profileId',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const branchId = Number(req.params.id);
      const profileId = decodeURIComponent(req.params.profileId);
      const branch = getBranchForUser(req, branchId);
      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const { name, localAddress, remoteAddress, rateLimit, dnsServer, onlyOne, parentQueue } = req.body as {
        name?: string;
        localAddress?: string;
        remoteAddress?: string;
        rateLimit?: string;
        dnsServer?: string;
        onlyOne?: string;
        parentQueue?: string;
      };

      if (!name?.trim()) {
        res.status(400).json({ error: 'Nama paket internet wajib diisi.' });
        return;
      }

      try {
        await updateBranchProfile(branch, profileId, {
          name: name.trim(),
          localAddress: (localAddress || '').trim(),
          remoteAddress: (remoteAddress || '').trim(),
          rateLimit: (rateLimit || '').trim(),
          dnsServer: (dnsServer || '').trim(),
          onlyOne: (onlyOne || 'default').trim(),
          parentQueue: (parentQueue || '').trim(),
        });

        recordAuditLog({
          userId: req.authUser!.id,
          username: req.authUser!.username,
          userFullName: req.authUser!.full_name,
          userRole: req.authUser!.role,
          branchId: branch.id,
          branchName: branch.name,
          action: 'EDIT_PAKET',
          target: name.trim(),
          details: `Mengubah paket internet "${name.trim()}" (rate-limit: ${rateLimit?.trim() || 'unlimited'}).`,
        });

        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal mengubah paket internet di MikroTik.',
        });
      }
    }
  );

  app.delete(
    '/api/branches/:id/packages/:profileId',
    requireAuth,
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const branchId = Number(req.params.id);
      const profileId = decodeURIComponent(req.params.profileId);
      const branch = getBranchForUser(req, branchId);
      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const targetName = (req.query.name as string) || profileId;

      try {
        await deleteBranchProfile(branch, profileId);

        recordAuditLog({
          userId: req.authUser!.id,
          username: req.authUser!.username,
          userFullName: req.authUser!.full_name,
          userRole: req.authUser!.role,
          branchId: branch.id,
          branchName: branch.name,
          action: 'HAPUS_PAKET',
          target: targetName,
          details: `Menghapus paket internet "${targetName}" dari cabang ${branch.name}.`,
        });

        res.json({ ok: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Gagal menghapus paket internet dari MikroTik.',
        });
      }
    }
  );

  // --- Cek Jaringan & Ping ---

  app.get('/api/network-check', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    let branches: DbBranch[] = [];
    if (user.role === 'admin') {
      branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all() as DbBranch[];
    } else if (user.branch_id) {
      const b = db.prepare('SELECT * FROM branches WHERE id = ?').get(user.branch_id) as
        | DbBranch
        | undefined;
      if (b) branches = [b];
    }

    const statuses = await Promise.all(branches.map((b) => getBranchStatus(b)));
    res.json({ branches: statuses });
  });

  app.post('/api/branches/:id/ping', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { target, count } = req.body as { target?: string; count?: number };
    if (!target?.trim()) {
      res.status(400).json({ error: 'Alamat tujuan ping (IP/domain) wajib diisi.' });
      return;
    }

    try {
      const result = await pingFromBranch(branch, target.trim(), Number(count) || 4);
      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: branch.id,
        branchName: branch.name,
        action: 'CEK_PING',
        target: target.trim(),
        details: `Cek ping ke ${target.trim()} (${result.received}/${result.sent} diterima, avg ${result.avgRttMs ?? '-'} ms).`,
      });
      res.json({ result });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menjalankan ping pada MikroTik.',
      });
    }
  });

  // --- Link HTTP OLT per Cabang ---

  app.get('/api/olt-links', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role === 'admin') {
      const rows = db
        .prepare(
          `SELECT o.*, b.name AS branch_name
           FROM olt_links o
           JOIN branches b ON b.id = o.branch_id
           ORDER BY b.id ASC, o.id ASC`
        )
        .all();
      res.json({ olts: rows });
      return;
    }

    if (!user.branch_id) {
      res.json({ olts: [] });
      return;
    }

    const rows = db
      .prepare(
        `SELECT o.*, b.name AS branch_name
         FROM olt_links o
         JOIN branches b ON b.id = o.branch_id
         WHERE o.branch_id = ?
         ORDER BY o.id ASC`
      )
      .all(user.branch_id);
    res.json({ olts: rows });
  });

  app.post('/api/olt-links', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const { branch_id, name, http_url, notes, login_username, login_password } = req.body as {
      branch_id?: number;
      name?: string;
      http_url?: string;
      notes?: string;
      login_username?: string;
      login_password?: string;
    };

    const branchId = Number(branch_id);
    if (!branchId) {
      res.status(400).json({ error: 'Cabang wajib dipilih.' });
      return;
    }
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE id = ?')
      .get(branchId) as { id: number; name: string } | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nama OLT wajib diisi.' });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeOltHttpUrl(http_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format link HTTP OLT tidak valid.',
      });
      return;
    }

    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO olt_links (branch_id, name, http_url, notes, login_username, login_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        branch.id,
        name.trim(),
        normalizedUrl,
        (notes || '').trim(),
        (login_username || '').trim(),
        (login_password || '').trim(),
        now,
        now
      );

    const created = db
      .prepare(
        `SELECT o.*, b.name AS branch_name
         FROM olt_links o
         JOIN branches b ON b.id = o.branch_id
         WHERE o.id = ?`
      )
      .get(Number(result.lastInsertRowid));

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'TAMBAH_OLT',
      target: name.trim(),
      details: `Menambahkan link OLT ${name.trim()} (${normalizedUrl}) di ${branch.name}.`,
    });

    res.status(201).json({ olt: created });
  });

  app.put('/api/olt-links/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const oltId = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM olt_links WHERE id = ?')
      .get(oltId) as
      | { id: number; branch_id: number; name: string; http_url: string; notes: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data OLT tidak ditemukan.' });
      return;
    }

    const { branch_id, name, http_url, notes, login_username, login_password } = req.body as {
      branch_id?: number;
      name?: string;
      http_url?: string;
      notes?: string;
      login_username?: string;
      login_password?: string;
    };

    const branchId = Number(branch_id) || existing.branch_id;
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE id = ?')
      .get(branchId) as { id: number; name: string } | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nama OLT wajib diisi.' });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeOltHttpUrl(http_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format link HTTP OLT tidak valid.',
      });
      return;
    }

    db.prepare(
      `UPDATE olt_links
       SET branch_id = ?, name = ?, http_url = ?, notes = ?, login_username = ?, login_password = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      branch.id,
      name.trim(),
      normalizedUrl,
      (notes || '').trim(),
      (login_username || '').trim(),
      (login_password || '').trim(),
      nowIso(),
      oltId
    );

    const updated = db
      .prepare(
        `SELECT o.*, b.name AS branch_name
         FROM olt_links o
         JOIN branches b ON b.id = o.branch_id
         WHERE o.id = ?`
      )
      .get(oltId);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'EDIT_OLT',
      target: name.trim(),
      details: `Memperbarui link OLT ${name.trim()} (${normalizedUrl}) di ${branch.name}.`,
    });

    res.json({ olt: updated });
  });

  app.delete('/api/olt-links/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const oltId = Number(req.params.id);
    const existing = db
      .prepare(
        `SELECT o.id, o.branch_id, o.name, o.http_url, b.name AS branch_name
         FROM olt_links o
         JOIN branches b ON b.id = o.branch_id
         WHERE o.id = ?`
      )
      .get(oltId) as
      | { id: number; branch_id: number; name: string; http_url: string; branch_name: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data OLT tidak ditemukan.' });
      return;
    }

    db.prepare('DELETE FROM olt_links WHERE id = ?').run(oltId);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: existing.branch_id,
      branchName: existing.branch_name,
      action: 'HAPUS_OLT',
      target: existing.name,
      details: `Menghapus link OLT ${existing.name} (${existing.http_url}) dari ${existing.branch_name}.`,
    });

    res.json({ ok: true });
  });

  // --- Remote Starlink & Reboot per Cabang ---

  app.get('/api/starlink-remotes', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role === 'admin') {
      const rows = db
        .prepare(
          `SELECT s.*, b.name AS branch_name
           FROM starlink_remotes s
           JOIN branches b ON b.id = s.branch_id
           ORDER BY b.id ASC, s.id ASC`
        )
        .all();
      res.json({ starlinks: rows });
      return;
    }

    if (!user.branch_id) {
      res.json({ starlinks: [] });
      return;
    }

    const rows = db
      .prepare(
        `SELECT s.*, b.name AS branch_name
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.branch_id = ?
         ORDER BY s.id ASC`
      )
      .all(user.branch_id);
    res.json({ starlinks: rows });
  });

  app.get('/api/starlink-remotes/status', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    let rows: Array<{
      id: number;
      remote_url: string;
      last_reboot_at: string | null;
      created_at: string;
      branch_connection_mode: ConnectionMode;
    }> = [];

    if (user.role === 'admin') {
      rows = db
        .prepare(
          `SELECT s.id, s.remote_url, s.last_reboot_at, s.created_at,
                  b.connection_mode AS branch_connection_mode
           FROM starlink_remotes s
           JOIN branches b ON b.id = s.branch_id
           ORDER BY b.id ASC, s.id ASC`
        )
        .all() as typeof rows;
    } else if (user.branch_id) {
      rows = db
        .prepare(
          `SELECT s.id, s.remote_url, s.last_reboot_at, s.created_at,
                  b.connection_mode AS branch_connection_mode
           FROM starlink_remotes s
           JOIN branches b ON b.id = s.branch_id
           WHERE s.branch_id = ?
           ORDER BY s.id ASC`
        )
        .all(user.branch_id) as typeof rows;
    }

    const statuses = await Promise.all(
      rows.map((row) =>
        getStarlinkStatusViaRemote(
          row.id,
          row.remote_url,
          row.branch_connection_mode === 'sandbox',
          { lastRebootAt: row.last_reboot_at, createdAt: row.created_at }
        )
      )
    );

    res.json({ statuses });
  });

  app.post('/api/starlink-remotes', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const { branch_id, name, remote_url, local_ip, notes } = req.body as {
      branch_id?: number;
      name?: string;
      remote_url?: string;
      local_ip?: string;
      notes?: string;
    };

    const branchId = Number(branch_id);
    if (!branchId) {
      res.status(400).json({ error: 'Cabang wajib dipilih.' });
      return;
    }
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE id = ?')
      .get(branchId) as { id: number; name: string } | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nama perangkat Starlink wajib diisi.' });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeStarlinkRemoteUrl(remote_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format alamat remote Starlink tidak valid.',
      });
      return;
    }

    const cleanLocalIp = (local_ip || '192.168.100.1').trim() || '192.168.100.1';
    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO starlink_remotes (branch_id, name, remote_url, local_ip, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(branch.id, name.trim(), normalizedUrl, cleanLocalIp, (notes || '').trim(), now, now);

    const created = db
      .prepare(
        `SELECT s.*, b.name AS branch_name
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.id = ?`
      )
      .get(Number(result.lastInsertRowid));

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'TAMBAH_STARLINK',
      target: name.trim(),
      details: `Menambahkan remote Starlink ${name.trim()} (${normalizedUrl} -> ${cleanLocalIp}) di ${branch.name}.`,
    });

    res.status(201).json({ starlink: created });
  });

  app.put('/api/starlink-remotes/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const starlinkId = Number(req.params.id);
    const existing = db
      .prepare('SELECT * FROM starlink_remotes WHERE id = ?')
      .get(starlinkId) as
      | { id: number; branch_id: number; name: string; remote_url: string; local_ip: string; notes: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data remote Starlink tidak ditemukan.' });
      return;
    }

    const { branch_id, name, remote_url, local_ip, notes } = req.body as {
      branch_id?: number;
      name?: string;
      remote_url?: string;
      local_ip?: string;
      notes?: string;
    };

    const branchId = Number(branch_id) || existing.branch_id;
    const branch = db
      .prepare('SELECT id, name FROM branches WHERE id = ?')
      .get(branchId) as { id: number; name: string } | undefined;
    if (!branch) {
      res.status(404).json({ error: 'Cabang tidak ditemukan.' });
      return;
    }

    if (!name?.trim()) {
      res.status(400).json({ error: 'Nama perangkat Starlink wajib diisi.' });
      return;
    }

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeStarlinkRemoteUrl(remote_url || '');
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Format alamat remote Starlink tidak valid.',
      });
      return;
    }

    const cleanLocalIp = (local_ip || '192.168.100.1').trim() || '192.168.100.1';

    db.prepare(
      `UPDATE starlink_remotes
       SET branch_id = ?, name = ?, remote_url = ?, local_ip = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(branch.id, name.trim(), normalizedUrl, cleanLocalIp, (notes || '').trim(), nowIso(), starlinkId);

    const updated = db
      .prepare(
        `SELECT s.*, b.name AS branch_name
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.id = ?`
      )
      .get(starlinkId);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'EDIT_STARLINK',
      target: name.trim(),
      details: `Memperbarui remote Starlink ${name.trim()} (${normalizedUrl} -> ${cleanLocalIp}) di ${branch.name}.`,
    });

    res.json({ starlink: updated });
  });

  app.delete('/api/starlink-remotes/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const starlinkId = Number(req.params.id);
    const existing = db
      .prepare(
        `SELECT s.id, s.branch_id, s.name, s.remote_url, b.name AS branch_name
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.id = ?`
      )
      .get(starlinkId) as
      | { id: number; branch_id: number; name: string; remote_url: string; branch_name: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data remote Starlink tidak ditemukan.' });
      return;
    }

    db.prepare('DELETE FROM starlink_remotes WHERE id = ?').run(starlinkId);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: existing.branch_id,
      branchName: existing.branch_name,
      action: 'HAPUS_STARLINK',
      target: existing.name,
      details: `Menghapus remote Starlink ${existing.name} (${existing.remote_url}) dari ${existing.branch_name}.`,
    });

    res.json({ ok: true });
  });

  app.post('/api/starlink-remotes/:id/reboot', requireAuth, async (req: AuthedRequest, res) => {
    const starlinkId = Number(req.params.id);
    const existing = db
      .prepare(
        `SELECT s.*, b.name AS branch_name, b.connection_mode AS branch_connection_mode
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.id = ?`
      )
      .get(starlinkId) as
      | {
          id: number;
          branch_id: number;
          name: string;
          remote_url: string;
          local_ip: string;
          branch_name: string;
          branch_connection_mode: ConnectionMode;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data remote Starlink tidak ditemukan.' });
      return;
    }

    const branch = getBranchForUser(req, existing.branch_id);
    if (!branch) {
      res.status(403).json({ error: 'Akses cabang ditolak.' });
      return;
    }

    try {
      const result = await rebootStarlinkViaRemote(
        existing.remote_url,
        existing.branch_connection_mode === 'sandbox'
      );
      const now = nowIso();
      db.prepare(
        `UPDATE starlink_remotes
         SET last_reboot_at = ?, last_reboot_by = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, req.authUser!.full_name, now, starlinkId);

      const updated = db
        .prepare(
          `SELECT s.*, b.name AS branch_name
           FROM starlink_remotes s
           JOIN branches b ON b.id = s.branch_id
           WHERE s.id = ?`
        )
        .get(starlinkId);

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
        branchId: existing.branch_id,
        branchName: existing.branch_name,
        action: 'REBOOT_STARLINK',
        target: existing.name,
        details: `Mengirim perintah reboot Starlink "${existing.name}" melalui remote ${existing.remote_url} (IP lokal ${existing.local_ip}).`,
      });

      res.json({
        ok: true,
        message: result.message,
        starlink: updated,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal mengirim perintah reboot Starlink.',
      });
    }
  });

  app.post('/api/starlink-remotes/:id/test', requireAuth, async (req: AuthedRequest, res) => {
    const starlinkId = Number(req.params.id);
    const existing = db
      .prepare(
        `SELECT s.*, b.name AS branch_name, b.connection_mode AS branch_connection_mode
         FROM starlink_remotes s
         JOIN branches b ON b.id = s.branch_id
         WHERE s.id = ?`
      )
      .get(starlinkId) as
      | {
          id: number;
          branch_id: number;
          name: string;
          remote_url: string;
          local_ip: string;
          last_reboot_at: string | null;
          created_at: string;
          branch_name: string;
          branch_connection_mode: ConnectionMode;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Data remote Starlink tidak ditemukan.' });
      return;
    }

    const branch = getBranchForUser(req, existing.branch_id);
    if (!branch) {
      res.status(403).json({ error: 'Akses cabang ditolak.' });
      return;
    }

    try {
      const result = await testStarlinkViaRemote(
        existing.remote_url,
        existing.branch_connection_mode === 'sandbox',
        { lastRebootAt: existing.last_reboot_at, createdAt: existing.created_at }
      );
      res.json({
        ok: true,
        ...result,
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal menguji koneksi remote Starlink.',
      });
    }
  });

  // --- Akun Staf (Admin Only) ---

  app.get('/api/staff', requireAuth, requireAdmin, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role, u.branch_id, u.is_active, u.created_at, u.updated_at,
                b.name AS branch_name
         FROM users u
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE u.role = 'staff'
         ORDER BY u.id DESC`
      )
      .all();
    res.json({ staff: rows });
  });

  app.post('/api/staff', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const { username, password, full_name, branch_id, is_active } = req.body as {
      username?: string;
      password?: string;
      full_name?: string;
      branch_id?: number | null;
      is_active?: boolean;
    };

    if (!username?.trim() || !password?.trim() || !full_name?.trim() || !branch_id) {
      res.status(400).json({ error: 'Nama lengkap, username, password, dan cabang staf wajib diisi.' });
      return;
    }

    const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(Number(branch_id)) as
      | { id: number; name: string }
      | undefined;
    if (!branch) {
      res.status(400).json({ error: 'Cabang yang dipilih tidak ditemukan.' });
      return;
    }

    const existing = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username.trim());
    if (existing) {
      res.status(409).json({ error: `Username "${username.trim()}" sudah digunakan.` });
      return;
    }

    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, full_name, role, branch_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'staff', ?, ?, ?, ?)`
      )
      .run(
        username.trim(),
        hashPassword(password),
        full_name.trim(),
        branch.id,
        is_active === false ? 0 : 1,
        now,
        now
      );

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'BUAT_STAF',
      target: username.trim(),
      details: `Membuat akun staf "${full_name.trim()}" (${username.trim()}) untuk cabang ${branch.name}.`,
    });

    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/staff/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const staffId = Number(req.params.id);
    const existing = db
      .prepare("SELECT * FROM users WHERE id = ? AND role = 'staff'")
      .get(staffId) as DbUser | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Akun staf tidak ditemukan.' });
      return;
    }

    const { username, password, full_name, branch_id, is_active } = req.body as {
      username?: string;
      password?: string;
      full_name?: string;
      branch_id?: number | null;
      is_active?: boolean;
    };

    if (!username?.trim() || !full_name?.trim() || !branch_id) {
      res.status(400).json({ error: 'Nama lengkap, username, dan cabang staf wajib diisi.' });
      return;
    }

    const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(Number(branch_id)) as
      | { id: number; name: string }
      | undefined;
    if (!branch) {
      res.status(400).json({ error: 'Cabang yang dipilih tidak ditemukan.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(username.trim(), staffId);
    if (dup) {
      res.status(409).json({ error: `Username "${username.trim()}" sudah digunakan akun lain.` });
      return;
    }

    const nextHash = password?.trim() ? hashPassword(password) : existing.password_hash;
    const nextActive = is_active === undefined ? existing.is_active : is_active ? 1 : 0;

    db.prepare(
      `UPDATE users SET username = ?, password_hash = ?, full_name = ?, branch_id = ?, is_active = ?, updated_at = ? WHERE id = ?`
    ).run(username.trim(), nextHash, full_name.trim(), branch.id, nextActive, nowIso(), staffId);

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: branch.id,
      branchName: branch.name,
      action: 'EDIT_STAF',
      target: username.trim(),
      details: `Memperbarui akun staf "${full_name.trim()}" (${username.trim()}) · Cabang ${branch.name} · ${nextActive === 1 ? 'Aktif' : 'Nonaktif'}.`,
    });

    res.json({ ok: true });
  });

  // --- Akun Admin (Admin Only) ---

  app.put('/api/account/admin', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const adminId = req.authUser!.id;
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(adminId) as DbUser | undefined;
    if (!current) {
      res.status(404).json({ error: 'Akun admin tidak ditemukan.' });
      return;
    }

    const { username, full_name, current_password, new_password } = req.body as {
      username?: string;
      full_name?: string;
      current_password?: string;
      new_password?: string;
    };

    if (!username?.trim() || !full_name?.trim()) {
      res.status(400).json({ error: 'Nama lengkap dan username wajib diisi.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(username.trim(), adminId);
    if (dup) {
      res.status(409).json({ error: `Username "${username.trim()}" sudah digunakan.` });
      return;
    }

    let nextHash = current.password_hash;
    if (new_password && new_password.trim().length > 0) {
      if (!current_password || !verifyPassword(current_password, current.password_hash)) {
        res.status(400).json({ error: 'Password saat ini tidak cocok.' });
        return;
      }
      if (new_password.trim().length < 5) {
        res.status(400).json({ error: 'Password baru minimal 5 karakter.' });
        return;
      }
      nextHash = hashPassword(new_password.trim());
    }

    db.prepare('UPDATE users SET username = ?, full_name = ?, password_hash = ?, updated_at = ? WHERE id = ?').run(
      username.trim(),
      full_name.trim(),
      nextHash,
      nowIso(),
      adminId
    );

    const updatedUser = loadUserById(adminId);

    recordAuditLog({
      userId: adminId,
      username: username.trim(),
      userFullName: full_name.trim(),
      userRole: 'admin',
      branchId: null,
      branchName: null,
      action: 'EDIT_ADMIN',
      target: username.trim(),
      details: `Memperbarui profil akun administrator (${username.trim()}).`,
    });

    res.json({ user: updatedUser });
  });

  // --- Keuangan (Tagihan, Tarif Paket, & Arus Kas) ---

  app.get('/api/finance/summary', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const rawPeriod = typeof req.query.period === 'string' ? req.query.period.trim() : '';
    const isAllPeriods = rawPeriod === 'all';
    const periodParam = isAllPeriods
      ? 'all'
      : /^\d{4}-\d{2}$/.test(rawPeriod)
        ? rawPeriod
        : currentPeriod();

    const branchParam =
      typeof req.query.branchId === 'string' && req.query.branchId !== '' && req.query.branchId !== 'all'
        ? Number(req.query.branchId)
        : null;

    let accessibleBranchIds: number[] = [];
    if (user.role === 'admin') {
      if (branchParam && !Number.isNaN(branchParam)) {
        const exists = db.prepare('SELECT id FROM branches WHERE id = ?').get(branchParam) as
          | { id: number }
          | undefined;
        accessibleBranchIds = exists ? [exists.id] : [];
      } else {
        const rows = db.prepare('SELECT id FROM branches ORDER BY id ASC').all() as Array<{ id: number }>;
        accessibleBranchIds = rows.map((r) => r.id);
      }
    } else {
      accessibleBranchIds = user.branch_id ? [user.branch_id] : [];
    }

    const baseAutomationSettings = getBillingSettings();
    const branchAutomationSettings = getAllBranchBillingSettings(
      user.role === 'staff' ? user.branch_id : null
    );
    const automationSettings =
      accessibleBranchIds.length === 1
        ? {
            ...baseAutomationSettings,
            ...getBranchBillingSettings(accessibleBranchIds[0]),
          }
        : baseAutomationSettings;

    if (accessibleBranchIds.length === 0) {
      res.json({
        period: periodParam,
        automationSettings,
        branchAutomationSettings,
        summary: {
          totalPaidInvoices: 0,
          totalOtherIncome: 0,
          totalIncome: 0,
          totalExpense: 0,
          netProfit: 0,
          unpaidAmount: 0,
          paidCount: 0,
          unpaidCount: 0,
        },
        invoices: [],
        transactions: [],
        monthlyTrend: [],
      });
      return;
    }

    syncPaidInvoicesToTransactions();

    const placeholders = accessibleBranchIds.map(() => '?').join(',');

    type InvoiceRow = {
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
      is_isolated: number;
      whatsapp_number: string;
      created_at: string;
      updated_at: string;
    };

    const invoices = (
      isAllPeriods
        ? db
            .prepare(
              `SELECT ci.*, b.name AS branch_name, COALESCE(cbp.is_isolated, 0) AS is_isolated,
                      COALESCE(cc.whatsapp_number, '') AS whatsapp_number
               FROM customer_invoices ci
               JOIN branches b ON b.id = ci.branch_id
               LEFT JOIN customer_billing_profiles cbp
                 ON cbp.branch_id = ci.branch_id AND cbp.customer_name = ci.customer_name
               LEFT JOIN customer_contacts cc
                 ON cc.branch_id = ci.branch_id AND cc.customer_name = ci.customer_name
               WHERE ci.branch_id IN (${placeholders})
               ORDER BY ci.period DESC, CASE WHEN ci.status = 'belum_bayar' THEN 0 ELSE 1 END, ci.customer_name ASC`
            )
            .all(...accessibleBranchIds)
        : db
            .prepare(
              `SELECT ci.*, b.name AS branch_name, COALESCE(cbp.is_isolated, 0) AS is_isolated,
                      COALESCE(cc.whatsapp_number, '') AS whatsapp_number
               FROM customer_invoices ci
               JOIN branches b ON b.id = ci.branch_id
               LEFT JOIN customer_billing_profiles cbp
                 ON cbp.branch_id = ci.branch_id AND cbp.customer_name = ci.customer_name
               LEFT JOIN customer_contacts cc
                 ON cc.branch_id = ci.branch_id AND cc.customer_name = ci.customer_name
               WHERE ci.period = ? AND ci.branch_id IN (${placeholders})
               ORDER BY CASE WHEN ci.status = 'belum_bayar' THEN 0 ELSE 1 END, ci.customer_name ASC`
            )
            .all(periodParam, ...accessibleBranchIds)
    ) as InvoiceRow[];

    type TransactionRow = {
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
    };

    const transactions = (
      isAllPeriods
        ? db
            .prepare(
              `SELECT ft.*, b.name AS branch_name
               FROM finance_transactions ft
               JOIN branches b ON b.id = ft.branch_id
               WHERE ft.branch_id IN (${placeholders})
               ORDER BY ft.transaction_date DESC, ft.id DESC`
            )
            .all(...accessibleBranchIds)
        : db
            .prepare(
              `SELECT ft.*, b.name AS branch_name
               FROM finance_transactions ft
               JOIN branches b ON b.id = ft.branch_id
               LEFT JOIN customer_invoices ci ON ci.id = ft.invoice_id
               WHERE ft.branch_id IN (${placeholders})
                 AND (
                   (ft.invoice_id IS NOT NULL AND ci.period = ?)
                   OR (ft.invoice_id IS NULL AND ft.transaction_date LIKE ?)
                 )
               ORDER BY ft.transaction_date DESC, ft.id DESC`
            )
            .all(...accessibleBranchIds, periodParam, `${periodParam}-%`)
    ) as TransactionRow[];

    // Hitung perkembangan bulanan untuk seluruh periode cabang terpilih
    const invoiceStatsRows = db
      .prepare(
        `SELECT ci.period AS period,
                SUM(CASE WHEN ci.status = 'lunas' THEN 1 ELSE 0 END) AS paid_count,
                SUM(CASE WHEN ci.status = 'belum_bayar' THEN 1 ELSE 0 END) AS unpaid_count,
                SUM(CASE WHEN ci.status = 'belum_bayar' THEN ci.amount_idr ELSE 0 END) AS unpaid_amount
         FROM customer_invoices ci
         WHERE ci.branch_id IN (${placeholders})
         GROUP BY ci.period`
      )
      .all(...accessibleBranchIds) as Array<{
      period: string;
      paid_count: number;
      unpaid_count: number;
      unpaid_amount: number;
    }>;

    const txStatsRows = db
      .prepare(
        `SELECT CASE
                  WHEN ft.invoice_id IS NOT NULL AND ci.period IS NOT NULL THEN ci.period
                  ELSE substr(ft.transaction_date, 1, 7)
                END AS effective_period,
                SUM(CASE WHEN ft.type = 'pemasukan' AND ft.invoice_id IS NOT NULL THEN ft.amount_idr ELSE 0 END) AS paid_invoices_amount,
                SUM(CASE WHEN ft.type = 'pemasukan' AND ft.invoice_id IS NULL THEN ft.amount_idr ELSE 0 END) AS other_income_amount,
                SUM(CASE WHEN ft.type = 'pengeluaran' THEN ft.amount_idr ELSE 0 END) AS total_expense
         FROM finance_transactions ft
         LEFT JOIN customer_invoices ci ON ci.id = ft.invoice_id
         WHERE ft.branch_id IN (${placeholders})
         GROUP BY effective_period`
      )
      .all(...accessibleBranchIds) as Array<{
      effective_period: string;
      paid_invoices_amount: number;
      other_income_amount: number;
      total_expense: number;
    }>;

    const trendMap = new Map<
      string,
      {
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
    >();

    for (const row of invoiceStatsRows) {
      if (!/^\d{4}-\d{2}$/.test(row.period)) continue;
      const existing = trendMap.get(row.period) || {
        period: row.period,
        paidInvoicesAmount: 0,
        otherIncomeAmount: 0,
        totalIncome: 0,
        totalExpense: 0,
        netProfit: 0,
        paidCount: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
      };
      existing.paidCount += Number(row.paid_count) || 0;
      existing.unpaidCount += Number(row.unpaid_count) || 0;
      existing.unpaidAmount += Number(row.unpaid_amount) || 0;
      trendMap.set(row.period, existing);
    }

    for (const row of txStatsRows) {
      const p = row.effective_period;
      if (!/^\d{4}-\d{2}$/.test(p)) continue;
      const existing = trendMap.get(p) || {
        period: p,
        paidInvoicesAmount: 0,
        otherIncomeAmount: 0,
        totalIncome: 0,
        totalExpense: 0,
        netProfit: 0,
        paidCount: 0,
        unpaidCount: 0,
        unpaidAmount: 0,
      };
      existing.paidInvoicesAmount += Number(row.paid_invoices_amount) || 0;
      existing.otherIncomeAmount += Number(row.other_income_amount) || 0;
      existing.totalIncome = existing.paidInvoicesAmount + existing.otherIncomeAmount;
      existing.totalExpense += Number(row.total_expense) || 0;
      existing.netProfit = existing.totalIncome - existing.totalExpense;
      trendMap.set(p, existing);
    }

    const monthlyTrend = Array.from(trendMap.values()).sort((a, b) =>
      a.period.localeCompare(b.period)
    );

    let totalPaidInvoices = 0;
    let totalOtherIncome = 0;
    let totalExpense = 0;
    let unpaidAmount = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    for (const inv of invoices) {
      if (inv.status === 'lunas') {
        paidCount += 1;
      } else {
        unpaidCount += 1;
        unpaidAmount += inv.amount_idr;
      }
    }

    for (const tx of transactions) {
      if (tx.type === 'pemasukan') {
        if (tx.invoice_id) {
          totalPaidInvoices += tx.amount_idr;
        } else {
          totalOtherIncome += tx.amount_idr;
        }
      } else {
        totalExpense += tx.amount_idr;
      }
    }

    const totalIncome = totalPaidInvoices + totalOtherIncome;
    const netProfit = totalIncome - totalExpense;

    res.json({
      period: periodParam,
      automationSettings,
      branchAutomationSettings,
      summary: {
        totalPaidInvoices,
        totalOtherIncome,
        totalIncome,
        totalExpense,
        netProfit,
        unpaidAmount,
        paidCount,
        unpaidCount,
      },
      invoices,
      transactions,
      monthlyTrend,
    });
  });

  app.get('/api/branches/:id/finance/tariffs', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const profileData = await getBranchProfiles(branch);
    const priceMap = getPackagePriceMap(branch.id);

    const seen = new Set<string>();
    const tariffs = profileData.packages.map((pkg) => {
      seen.add(pkg.name);
      return {
        profileName: pkg.name,
        rateLimit: pkg.rateLimit,
        isDefault: pkg.isDefault,
        priceIdr: priceMap.get(pkg.name) ?? 0,
      };
    });

    for (const [profileName, priceIdr] of priceMap.entries()) {
      if (!seen.has(profileName)) {
        tariffs.push({
          profileName,
          rateLimit: '',
          isDefault: false,
          priceIdr,
        });
      }
    }

    res.json({
      branch: sanitizeBranch(branch),
      online: profileData.online,
      error: profileData.error,
      tariffs,
    });
  });

  app.put(
    '/api/branches/:id/finance/tariffs',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const branchId = Number(req.params.id);
      const branch = getBranchForUser(req, branchId);
      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const { items } = req.body as {
        items?: Array<{ profileName: string; priceIdr: number }>;
      };

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({ error: 'Daftar tarif paket wajib diisi.' });
        return;
      }

      const validItems = items
        .filter((i) => typeof i.profileName === 'string' && i.profileName.trim().length > 0)
        .map((i) => ({
          profileName: i.profileName.trim(),
          priceIdr: Math.max(0, Math.round(Number(i.priceIdr) || 0)),
        }));

      setPackagePrices(branch.id, validItems);

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
        branchId: branch.id,
        branchName: branch.name,
        action: 'ATUR_TARIF_PAKET',
        target: `${validItems.length} paket`,
        details: `Memperbarui tarif bulanan untuk ${validItems.length} paket internet pada cabang ${branch.name}.`,
      });

      res.json({ ok: true });
    }
  );

  app.post('/api/branches/:id/finance/invoices/generate', requireAuth, async (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { period } = req.body as { period?: string };
    const resolvedPeriod =
      typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();

    try {
      const { createdCount, skippedCount } = await generateInvoicesForBranch(
        branch,
        resolvedPeriod,
        {
          userId: req.authUser!.id,
          username: req.authUser!.username,
          userFullName: req.authUser!.full_name,
          userRole: req.authUser!.role,
        }
      );

      res.json({ ok: true, createdCount, skippedCount, period: resolvedPeriod });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Gagal membuat tagihan otomatis.',
      });
    }
  });

  app.post('/api/branches/:id/finance/invoices', requireAuth, (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { customerName, profileName, period, amountIdr, notes } = req.body as {
      customerName?: string;
      profileName?: string;
      period?: string;
      amountIdr?: number;
      notes?: string;
    };

    if (!customerName?.trim() || !profileName?.trim()) {
      res.status(400).json({ error: 'Nama pelanggan dan paket wajib diisi.' });
      return;
    }

    const resolvedPeriod =
      typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? period : currentPeriod();
    const cleanAmount = Math.max(0, Math.round(Number(amountIdr) || 0));

    const existing = db
      .prepare('SELECT id FROM customer_invoices WHERE branch_id = ? AND customer_name = ? AND period = ?')
      .get(branch.id, customerName.trim(), resolvedPeriod);
    if (existing) {
      res.status(409).json({
        error: `Tagihan untuk "${customerName.trim()}" pada periode ${resolvedPeriod} sudah ada.`,
      });
      return;
    }

    const now = nowIso();
    const info = db
      .prepare(
        `INSERT INTO customer_invoices
          (branch_id, customer_name, profile_name, period, amount_idr, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'belum_bayar', ?, ?, ?)`
      )
      .run(
        branch.id,
        customerName.trim(),
        profileName.trim(),
        resolvedPeriod,
        cleanAmount,
        (notes || '').trim(),
        now,
        now
      );

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: branch.id,
      branchName: branch.name,
      action: 'BUAT_TAGIHAN',
      target: customerName.trim(),
      details: `Membuat tagihan manual "${customerName.trim()}" (${profileName.trim()}) periode ${resolvedPeriod} sebesar Rp ${cleanAmount.toLocaleString('id-ID')}.`,
    });

    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.put('/api/finance/invoices/:invoiceId/pay', requireAuth, async (req: AuthedRequest, res) => {
    const invoiceId = Number(req.params.invoiceId);
    const invoice = db
      .prepare(
        `SELECT ci.*, b.name AS branch_name
         FROM customer_invoices ci
         JOIN branches b ON b.id = ci.branch_id
         WHERE ci.id = ?`
      )
      .get(invoiceId) as
      | {
          id: number;
          branch_id: number;
          branch_name: string;
          customer_name: string;
          profile_name: string;
          period: string;
          amount_idr: number;
          status: 'belum_bayar' | 'lunas';
        }
      | undefined;

    if (!invoice) {
      res.status(404).json({ error: 'Tagihan tidak ditemukan.' });
      return;
    }

    const branch = getBranchForUser(req, invoice.branch_id);
    if (!branch) {
      res.status(403).json({ error: 'Akses cabang ditolak.' });
      return;
    }

    const { paymentMethod, paidDate, amountIdr, notes } = req.body as {
      paymentMethod?: string;
      paidDate?: string;
      amountIdr?: number;
      notes?: string;
    };

    const resolvedMethod = paymentMethod?.trim() || 'Tunai';
    const resolvedDate =
      typeof paidDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paidDate)
        ? paidDate
        : nowIso().slice(0, 10);
    const resolvedAmount =
      amountIdr !== undefined && !Number.isNaN(Number(amountIdr))
        ? Math.max(0, Math.round(Number(amountIdr)))
        : invoice.amount_idr;
    const now = nowIso();

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE customer_invoices
         SET status = 'lunas', amount_idr = ?, payment_method = ?, paid_at = ?, paid_by_name = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        resolvedAmount,
        resolvedMethod,
        `${resolvedDate}T12:00:00.000Z`,
        req.authUser!.full_name,
        (notes || '').trim(),
        now,
        invoice.id
      );

      db.prepare('DELETE FROM finance_transactions WHERE invoice_id = ?').run(invoice.id);
      db.prepare(
        `INSERT INTO finance_transactions
          (branch_id, type, category, description, amount_idr, transaction_date, payment_method, invoice_id, created_by_id, created_by_name, created_at)
         VALUES (?, 'pemasukan', 'Iuran Bulanan PPPoE', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invoice.branch_id,
        `Pembayaran ${invoice.customer_name} (${invoice.profile_name} · ${invoice.period})`,
        resolvedAmount,
        resolvedDate,
        resolvedMethod,
        invoice.id,
        req.authUser!.id,
        req.authUser!.full_name,
        now
      );
    });
    tx();

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: invoice.branch_id,
      branchName: invoice.branch_name,
      action: 'BAYAR_TAGIHAN',
      target: invoice.customer_name,
      details: `Mencatat pembayaran lunas "${invoice.customer_name}" periode ${invoice.period} sebesar Rp ${resolvedAmount.toLocaleString('id-ID')} (${resolvedMethod}).`,
    });

    const restoreResult = await restoreCustomerProfileIfEligible(
      branch,
      invoice.customer_name,
      invoice.profile_name,
      {
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: req.authUser!.role,
      }
    );

    res.json({
      ok: true,
      restored: restoreResult.restored,
      restoredProfile: restoreResult.restoredProfile,
      restoreWarning: restoreResult.warning,
    });
  });

  app.put(
    '/api/finance/invoices/:invoiceId/unpay',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const invoiceId = Number(req.params.invoiceId);
      const invoice = db
        .prepare(
          `SELECT ci.*, b.name AS branch_name
           FROM customer_invoices ci
           JOIN branches b ON b.id = ci.branch_id
           WHERE ci.id = ?`
        )
        .get(invoiceId) as
        | {
            id: number;
            branch_id: number;
            branch_name: string;
            customer_name: string;
            period: string;
          }
        | undefined;

      if (!invoice) {
        res.status(404).json({ error: 'Tagihan tidak ditemukan.' });
        return;
      }

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE customer_invoices
           SET status = 'belum_bayar', payment_method = NULL, paid_at = NULL, paid_by_name = NULL, updated_at = ?
           WHERE id = ?`
        ).run(nowIso(), invoice.id);
        db.prepare('DELETE FROM finance_transactions WHERE invoice_id = ?').run(invoice.id);
      });
      tx();

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
        branchId: invoice.branch_id,
        branchName: invoice.branch_name,
        action: 'BATAL_BAYAR_TAGIHAN',
        target: invoice.customer_name,
        details: `Membatalkan status lunas tagihan "${invoice.customer_name}" periode ${invoice.period}.`,
      });

      res.json({ ok: true });
    }
  );

  app.delete(
    '/api/finance/invoices/:invoiceId',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const invoiceId = Number(req.params.invoiceId);
      const invoice = db
        .prepare(
          `SELECT ci.*, b.name AS branch_name
           FROM customer_invoices ci
           JOIN branches b ON b.id = ci.branch_id
           WHERE ci.id = ?`
        )
        .get(invoiceId) as
        | {
            id: number;
            branch_id: number;
            branch_name: string;
            customer_name: string;
            period: string;
          }
        | undefined;

      if (!invoice) {
        res.status(404).json({ error: 'Tagihan tidak ditemukan.' });
        return;
      }

      db.prepare('DELETE FROM customer_invoices WHERE id = ?').run(invoice.id);

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
        branchId: invoice.branch_id,
        branchName: invoice.branch_name,
        action: 'HAPUS_TAGIHAN',
        target: invoice.customer_name,
        details: `Menghapus tagihan "${invoice.customer_name}" periode ${invoice.period}.`,
      });

      res.json({ ok: true });
    }
  );

  app.post('/api/branches/:id/finance/transactions', requireAuth, (req: AuthedRequest, res) => {
    const branchId = Number(req.params.id);
    const branch = getBranchForUser(req, branchId);
    if (!branch) {
      res.status(403).json({ error: 'Cabang tidak ditemukan atau akses ditolak.' });
      return;
    }

    const { type, category, description, amountIdr, transactionDate, paymentMethod } = req.body as {
      type?: 'pemasukan' | 'pengeluaran';
      category?: string;
      description?: string;
      amountIdr?: number;
      transactionDate?: string;
      paymentMethod?: string;
    };

    if (type !== 'pemasukan' && type !== 'pengeluaran') {
      res.status(400).json({ error: 'Tipe transaksi harus pemasukan atau pengeluaran.' });
      return;
    }
    if (!category?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'Kategori dan keterangan transaksi wajib diisi.' });
      return;
    }

    const cleanAmount = Math.round(Number(amountIdr) || 0);
    if (cleanAmount <= 0) {
      res.status(400).json({ error: 'Nominal transaksi harus lebih dari Rp 0.' });
      return;
    }

    const resolvedDate =
      typeof transactionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate)
        ? transactionDate
        : nowIso().slice(0, 10);
    const resolvedMethod = paymentMethod?.trim() || 'Tunai';

    const info = db
      .prepare(
        `INSERT INTO finance_transactions
          (branch_id, type, category, description, amount_idr, transaction_date, payment_method, invoice_id, created_by_id, created_by_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        branch.id,
        type,
        category.trim(),
        description.trim(),
        cleanAmount,
        resolvedDate,
        resolvedMethod,
        req.authUser!.id,
        req.authUser!.full_name,
        nowIso()
      );

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: req.authUser!.role,
      branchId: branch.id,
      branchName: branch.name,
      action: 'TAMBAH_TRANSAKSI',
      target: category.trim(),
      details: `Mencatat ${type} (${category.trim()}) sebesar Rp ${cleanAmount.toLocaleString('id-ID')}: ${description.trim()}.`,
    });

    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  app.delete(
    '/api/finance/transactions/:txId',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const txId = Number(req.params.txId);
      const row = db
        .prepare(
          `SELECT ft.*, b.name AS branch_name
           FROM finance_transactions ft
           JOIN branches b ON b.id = ft.branch_id
           WHERE ft.id = ?`
        )
        .get(txId) as
        | {
            id: number;
            branch_id: number;
            branch_name: string;
            type: string;
            category: string;
            amount_idr: number;
            invoice_id: number | null;
          }
        | undefined;

      if (!row) {
        res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
        return;
      }

      if (row.invoice_id) {
        res.status(400).json({
          error: 'Transaksi ini terhubung dengan tagihan pelanggan. Batalkan status lunas pada tab Tagihan Pelanggan.',
        });
        return;
      }

      db.prepare('DELETE FROM finance_transactions WHERE id = ?').run(row.id);

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
        branchId: row.branch_id,
        branchName: row.branch_name,
        action: 'HAPUS_TRANSAKSI',
        target: row.category,
        details: `Menghapus transaksi ${row.type} (${row.category}) sebesar Rp ${row.amount_idr.toLocaleString('id-ID')}.`,
      });

      res.json({ ok: true });
    }
  );

  // --- Otomatisasi Tagihan Tanggal 1 & Isolir Setelah Tanggal 5 ---

  app.get('/api/finance/automation', requireAuth, (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const branchSettings = getAllBranchBillingSettings(
      user.role === 'staff' ? user.branch_id : null
    );
    res.json({
      settings: getBillingSettings(),
      branchSettings,
    });
  });

  app.put('/api/finance/automation', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const body = req.body as {
      branch_id?: number;
      auto_invoice_enabled?: boolean;
      auto_isolir_enabled?: boolean;
      isolir_cutoff_day?: number;
      isolir_profile_name?: string;
      wa_template_unpaid?: string;
      wa_template_paid?: string;
    };

    const branchId = body.branch_id !== undefined && body.branch_id !== null ? Number(body.branch_id) : null;

    if (branchId && !Number.isNaN(branchId)) {
      const branch = db
        .prepare('SELECT id, name FROM branches WHERE id = ?')
        .get(branchId) as { id: number; name: string } | undefined;

      if (!branch) {
        res.status(404).json({ error: 'Cabang tidak ditemukan.' });
        return;
      }

      const currentBranch = getBranchBillingSettings(branch.id);
      const updatedBranch = updateBranchBillingSettings(branch.id, {
        auto_invoice_enabled:
          body.auto_invoice_enabled !== undefined
            ? Boolean(body.auto_invoice_enabled)
            : currentBranch.auto_invoice_enabled,
        auto_isolir_enabled:
          body.auto_isolir_enabled !== undefined
            ? Boolean(body.auto_isolir_enabled)
            : currentBranch.auto_isolir_enabled,
        isolir_cutoff_day:
          body.isolir_cutoff_day !== undefined
            ? Number(body.isolir_cutoff_day)
            : currentBranch.isolir_cutoff_day,
        isolir_profile_name:
          body.isolir_profile_name !== undefined
            ? String(body.isolir_profile_name)
            : currentBranch.isolir_profile_name,
      });

      recordAuditLog({
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
        branchId: branch.id,
        branchName: branch.name,
        action: 'ATUR_OTOMATISASI_TAGIHAN',
        target: `${branch.name} (${updatedBranch.isolir_profile_name})`,
        details: `Cabang ${branch.name} · Tagihan otomatis tgl 1: ${updatedBranch.auto_invoice_enabled ? 'Aktif' : 'Nonaktif'} · Isolir otomatis > tgl ${updatedBranch.isolir_cutoff_day} (${updatedBranch.isolir_profile_name}): ${updatedBranch.auto_isolir_enabled ? 'Aktif' : 'Nonaktif'}.`,
      });

      res.json({
        settings: getBillingSettings(),
        branchSetting: updatedBranch,
        branchSettings: getAllBranchBillingSettings(),
      });
      return;
    }

    const current = getBillingSettings();
    const hasTemplateUpdate =
      body.wa_template_unpaid !== undefined || body.wa_template_paid !== undefined;

    const updated = updateBillingSettings({
      auto_invoice_enabled:
        body.auto_invoice_enabled !== undefined
          ? Boolean(body.auto_invoice_enabled)
          : current.auto_invoice_enabled,
      auto_isolir_enabled:
        body.auto_isolir_enabled !== undefined
          ? Boolean(body.auto_isolir_enabled)
          : current.auto_isolir_enabled,
      isolir_cutoff_day:
        body.isolir_cutoff_day !== undefined
          ? Number(body.isolir_cutoff_day)
          : current.isolir_cutoff_day,
      isolir_profile_name:
        body.isolir_profile_name !== undefined
          ? String(body.isolir_profile_name)
          : current.isolir_profile_name,
      wa_template_unpaid:
        body.wa_template_unpaid !== undefined
          ? String(body.wa_template_unpaid)
          : undefined,
      wa_template_paid:
        body.wa_template_paid !== undefined
          ? String(body.wa_template_paid)
          : undefined,
    });

    recordAuditLog({
      userId: req.authUser!.id,
      username: req.authUser!.username,
      userFullName: req.authUser!.full_name,
      userRole: 'admin',
      branchId: null,
      branchName: null,
      action: 'ATUR_OTOMATISASI_TAGIHAN',
      target: hasTemplateUpdate ? 'Template WA & Otomatisasi' : updated.isolir_profile_name,
      details: hasTemplateUpdate
        ? `Memperbarui template teks penagihan WhatsApp (Belum Bayar / Lunas).`
        : `Tagihan otomatis tgl 1: ${updated.auto_invoice_enabled ? 'Aktif' : 'Nonaktif'} · Isolir otomatis > tgl ${updated.isolir_cutoff_day} (${updated.isolir_profile_name}): ${updated.auto_isolir_enabled ? 'Aktif' : 'Nonaktif'}.`,
    });

    res.json({ settings: updated, branchSettings: getAllBranchBillingSettings() });
  });

  app.post('/api/finance/automation/run', requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
    const { forceInvoice, forceIsolir, branchId } = (req.body || {}) as {
      forceInvoice?: boolean;
      forceIsolir?: boolean;
      branchId?: number | null;
    };

    const parsedBranchId =
      branchId !== undefined && branchId !== null && !Number.isNaN(Number(branchId))
        ? Number(branchId)
        : null;

    const result = await runBillingAutomationCycle({
      forceInvoice: Boolean(forceInvoice),
      forceIsolir: Boolean(forceIsolir),
      branchId: parsedBranchId,
      actor: {
        userId: req.authUser!.id,
        username: req.authUser!.username,
        userFullName: req.authUser!.full_name,
        userRole: 'admin',
      },
    });

    res.json(result);
  });

  // --- Vite / Static Frontend Serving ---

  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && fs.existsSync(distIndex)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  } else {
    if (isProd && !fs.existsSync(distIndex)) {
      console.warn(
        'Folder dist/ belum ditemukan (jalankan "npm run build" untuk mode produksi). Memakai Vite middleware sementara...'
      );
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`NetOps MikroTik server running on http://${HOST}:${PORT}`);

    // Jalankan otomatisasi tagihan tanggal 1 & isolir setelah tanggal 5 saat startup dan berkala setiap 15 menit
    setTimeout(() => {
      runBillingAutomationCycle().catch((err) => {
        console.error('Billing automation startup cycle failed:', err);
      });
    }, 3000);

    setInterval(() => {
      runBillingAutomationCycle().catch((err) => {
        console.error('Billing automation periodic cycle failed:', err);
      });
    }, 15 * 60 * 1000);

    // Pantau status online/offline cabang secara berkala agar durasi offline tercatat akurat
    const pollBranchHealth = async () => {
      const branches = db.prepare('SELECT * FROM branches ORDER BY id ASC').all() as DbBranch[];
      await Promise.all(branches.map((b) => getBranchStatus(b).catch(() => null)));
    };
    setTimeout(() => {
      pollBranchHealth().catch(() => {});
    }, 10000);
    setInterval(() => {
      pollBranchHealth().catch(() => {});
    }, 2 * 60 * 1000);
  });
}

startServer();
