import {
  currentPeriod,
  db,
  getBranchBillingSettings,
  getCustomerBillingProfile,
  getPackagePriceMap,
  nowIso,
  recordAuditLog,
  upsertCustomerBillingProfile,
  type BranchBillingAutomationSettings,
  type DbBranch,
  type UserRole,
} from './db.ts';
import { getBranchCustomers, setBranchCustomerProfile } from './mikrotik.ts';

export interface AutomationActor {
  userId: number | null;
  username: string;
  userFullName: string;
  userRole: UserRole;
}

const SYSTEM_ACTOR: AutomationActor = {
  userId: null,
  username: 'system',
  userFullName: 'Sistem Otomatis',
  userRole: 'admin',
};

let isCycleRunning = false;

export function getTodayDayOfMonth(): number {
  return new Date().getDate();
}

export async function generateInvoicesForBranch(
  branch: DbBranch,
  period: string,
  actor: AutomationActor = SYSTEM_ACTOR,
  options?: { silentWhenZero?: boolean }
): Promise<{ createdCount: number; skippedCount: number }> {
  const settings = getBranchBillingSettings(branch.id);
  const isolirLower = settings.isolir_profile_name.toLowerCase();
  const custData = await getBranchCustomers(branch);

  if (!custData.online && custData.customers.length === 0) {
    throw new Error(
      custData.error || 'Router MikroTik sedang offline sehingga daftar pelanggan tidak dapat dibaca.'
    );
  }

  const priceMap = getPackagePriceMap(branch.id);
  const now = nowIso();

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO customer_invoices
      (branch_id, customer_name, profile_name, period, amount_idr, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'belum_bayar', '', ?, ?)
  `);

  let createdCount = 0;
  let skippedCount = 0;

  const tx = db.transaction(() => {
    for (const c of custData.customers) {
      if (c.disabled) {
        skippedCount += 1;
        continue;
      }

      const currentLower = c.profile.toLowerCase();
      let billingProfile = c.profile;

      if (currentLower === isolirLower || currentLower === 'isolir') {
        const tracked = getCustomerBillingProfile(branch.id, c.name);
        if (
          tracked &&
          tracked.original_profile &&
          tracked.original_profile.toLowerCase() !== isolirLower &&
          tracked.original_profile.toLowerCase() !== 'isolir'
        ) {
          billingProfile = tracked.original_profile;
        } else {
          skippedCount += 1;
          continue;
        }
      } else {
        const tracked = getCustomerBillingProfile(branch.id, c.name);
        if (!tracked || (!tracked.is_isolated && tracked.original_profile !== c.profile)) {
          upsertCustomerBillingProfile(branch.id, c.name, c.profile, false);
        }
      }

      const price = priceMap.get(billingProfile) ?? 0;
      const info = insertStmt.run(
        branch.id,
        c.name,
        billingProfile,
        period,
        price,
        now,
        now
      );
      if (info.changes > 0) {
        createdCount += 1;
      } else {
        skippedCount += 1;
      }
    }
  });
  tx();

  if (!options?.silentWhenZero || createdCount > 0) {
    recordAuditLog({
      userId: actor.userId,
      username: actor.username,
      userFullName: actor.userFullName,
      userRole: actor.userRole,
      branchId: branch.id,
      branchName: branch.name,
      action: 'BUAT_TAGIHAN',
      target: period,
      details: `Membuat ${createdCount} tagihan periode ${period} untuk cabang ${branch.name} (${skippedCount} dilewati).`,
    });
  }

  return { createdCount, skippedCount };
}

export async function isolateOverdueCustomersForBranch(
  branch: DbBranch,
  settings: BranchBillingAutomationSettings,
  actor: AutomationActor = SYSTEM_ACTOR,
  options?: { ignoreCutoffDay?: boolean }
): Promise<{ isolatedCount: number; errors: string[] }> {
  const period = currentPeriod();
  const todayDay = getTodayDayOfMonth();

  const isCurrentMonthOverdue = options?.ignoreCutoffDay || todayDay > settings.isolir_cutoff_day;

  const overdueRows = db
    .prepare(
      `SELECT customer_name, profile_name, period
       FROM customer_invoices
       WHERE branch_id = ?
         AND status = 'belum_bayar'
         AND (period < ? OR (period = ? AND ? = 1))
       ORDER BY period ASC`
    )
    .all(branch.id, period, period, isCurrentMonthOverdue ? 1 : 0) as Array<{
    customer_name: string;
    profile_name: string;
    period: string;
  }>;

  if (overdueRows.length === 0) {
    return { isolatedCount: 0, errors: [] };
  }

  const overdueByCustomer = new Map<string, { profile_name: string; period: string }>();
  for (const r of overdueRows) {
    if (!overdueByCustomer.has(r.customer_name)) {
      overdueByCustomer.set(r.customer_name, {
        profile_name: r.profile_name,
        period: r.period,
      });
    }
  }

  const custData = await getBranchCustomers(branch);
  if (!custData.online && custData.customers.length === 0) {
    return {
      isolatedCount: 0,
      errors: [`${branch.name}: ${custData.error || 'Router MikroTik offline'}`],
    };
  }

  const customerMap = new Map(custData.customers.map((c) => [c.name, c]));
  const isolirProfile = settings.isolir_profile_name || 'profile-isolir';
  const isolirLower = isolirProfile.toLowerCase();

  let isolatedCount = 0;
  const errors: string[] = [];

  for (const [customerName, overdueInfo] of overdueByCustomer.entries()) {
    const cust = customerMap.get(customerName);
    if (!cust || cust.disabled) {
      continue;
    }

    if (cust.profile.toLowerCase() === isolirLower) {
      const tracked = getCustomerBillingProfile(branch.id, customerName);
      if (!tracked || !tracked.is_isolated) {
        const orig =
          tracked?.original_profile && tracked.original_profile.toLowerCase() !== isolirLower
            ? tracked.original_profile
            : overdueInfo.profile_name;
        upsertCustomerBillingProfile(branch.id, customerName, orig, true);
      }
      continue;
    }

    const originalProfile =
      cust.profile.toLowerCase() !== 'isolir' && cust.profile.toLowerCase() !== isolirLower
        ? cust.profile
        : overdueInfo.profile_name;

    try {
      upsertCustomerBillingProfile(branch.id, customerName, originalProfile, true);
      await setBranchCustomerProfile(branch, cust.id, cust.name, isolirProfile);
      isolatedCount += 1;

      recordAuditLog({
        userId: actor.userId,
        username: actor.username,
        userFullName: actor.userFullName,
        userRole: actor.userRole,
        branchId: branch.id,
        branchName: branch.name,
        action: 'ISOLIR_OTOMATIS',
        target: customerName,
        details: `Mengubah profile "${customerName}" dari "${originalProfile}" menjadi "${isolirProfile}" karena tagihan periode ${overdueInfo.period} belum lunas setelah tanggal ${settings.isolir_cutoff_day}.`,
      });
    } catch (err) {
      errors.push(
        `${branch.name} (${customerName}): ${err instanceof Error ? err.message : 'Gagal isolir di MikroTik'}`
      );
    }
  }

  return { isolatedCount, errors };
}

export async function restoreCustomerProfileIfEligible(
  branch: DbBranch,
  customerName: string,
  fallbackProfile: string,
  actor: AutomationActor
): Promise<{ restored: boolean; restoredProfile: string | null; warning: string | null }> {
  const settings = getBranchBillingSettings(branch.id);
  const period = currentPeriod();
  const todayDay = getTodayDayOfMonth();
  const isCurrentMonthOverdue = todayDay > settings.isolir_cutoff_day ? 1 : 0;

  const remainingOverdue = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM customer_invoices
       WHERE branch_id = ?
         AND customer_name = ?
         AND status = 'belum_bayar'
         AND (period < ? OR (period = ? AND ? = 1))`
    )
    .get(branch.id, customerName, period, period, isCurrentMonthOverdue) as { c: number };

  if (remainingOverdue.c > 0) {
    return {
      restored: false,
      restoredProfile: null,
      warning: `Pelanggan masih memiliki ${remainingOverdue.c} tagihan jatuh tempo lain yang belum lunas.`,
    };
  }

  const tracked = getCustomerBillingProfile(branch.id, customerName);
  const isolirLower = settings.isolir_profile_name.toLowerCase();

  let custData;
  try {
    custData = await getBranchCustomers(branch);
  } catch {
    return {
      restored: false,
      restoredProfile: null,
      warning: 'Gagal menghubungi router MikroTik untuk mengembalikan profile pelanggan.',
    };
  }

  if (!custData.online && custData.customers.length === 0) {
    return {
      restored: false,
      restoredProfile: null,
      warning: custData.error || 'Router MikroTik sedang offline sehingga profile belum dikembalikan.',
    };
  }

  const cust = custData.customers.find((c) => c.name === customerName);
  if (!cust) {
    if (tracked?.is_isolated) {
      upsertCustomerBillingProfile(branch.id, customerName, tracked.original_profile, false);
    }
    return { restored: false, restoredProfile: null, warning: null };
  }

  const isCurrentlyIsolated =
    cust.profile.toLowerCase() === isolirLower ||
    cust.profile.toLowerCase() === 'isolir' ||
    Boolean(tracked?.is_isolated);

  if (!isCurrentlyIsolated) {
    return { restored: false, restoredProfile: null, warning: null };
  }

  const targetProfile =
    tracked?.original_profile &&
    tracked.original_profile.toLowerCase() !== isolirLower &&
    tracked.original_profile.toLowerCase() !== 'isolir'
      ? tracked.original_profile
      : fallbackProfile &&
          fallbackProfile.toLowerCase() !== isolirLower &&
          fallbackProfile.toLowerCase() !== 'isolir'
        ? fallbackProfile
        : null;

  if (!targetProfile) {
    return {
      restored: false,
      restoredProfile: null,
      warning: 'Profile asal pelanggan tidak diketahui untuk dikembalikan otomatis.',
    };
  }

  try {
    if (cust.profile !== targetProfile) {
      await setBranchCustomerProfile(branch, cust.id, cust.name, targetProfile);
    }
    upsertCustomerBillingProfile(branch.id, customerName, targetProfile, false);

    recordAuditLog({
      userId: actor.userId,
      username: actor.username,
      userFullName: actor.userFullName,
      userRole: actor.userRole,
      branchId: branch.id,
      branchName: branch.name,
      action: 'AKTIFKAN_KEMBALI',
      target: customerName,
      details: `Mengembalikan profile "${customerName}" menjadi "${targetProfile}" karena tagihan sudah lunas.`,
    });

    return { restored: true, restoredProfile: targetProfile, warning: null };
  } catch (err) {
    return {
      restored: false,
      restoredProfile: null,
      warning: err instanceof Error ? err.message : 'Gagal mengembalikan profile pelanggan di MikroTik.',
    };
  }
}

export async function runBillingAutomationCycle(options?: {
  forceInvoice?: boolean;
  forceIsolir?: boolean;
  branchId?: number | null;
  actor?: AutomationActor;
}): Promise<{
  period: string;
  day: number;
  invoicesCreated: number;
  isolatedCount: number;
  errors: string[];
}> {
  const period = currentPeriod();
  const day = getTodayDayOfMonth();

  if (isCycleRunning) {
    return {
      period,
      day,
      invoicesCreated: 0,
      isolatedCount: 0,
      errors: ['Proses otomatisasi sedang berjalan.'],
    };
  }

  isCycleRunning = true;
  try {
    const actor = options?.actor ?? SYSTEM_ACTOR;
    const branches = (
      options?.branchId
        ? db.prepare('SELECT * FROM branches WHERE id = ? ORDER BY id ASC').all(options.branchId)
        : db.prepare('SELECT * FROM branches ORDER BY id ASC').all()
    ) as DbBranch[];

    let invoicesCreated = 0;
    let isolatedCount = 0;
    const errors: string[] = [];

    for (const branch of branches) {
      const settings = getBranchBillingSettings(branch.id);
      const shouldRunAutoInvoice = options?.forceInvoice || (settings.auto_invoice_enabled && day >= 1);
      const shouldRunAutoIsolir =
        options?.forceIsolir || (settings.auto_isolir_enabled && day > settings.isolir_cutoff_day);

      const runRow = db
        .prepare('SELECT * FROM billing_auto_runs WHERE branch_id = ? AND period = ?')
        .get(branch.id, period) as
        | { id: number; auto_invoiced_at: string | null; last_isolir_run_at: string | null }
        | undefined;

      if (shouldRunAutoInvoice && (options?.forceInvoice || !runRow?.auto_invoiced_at)) {
        try {
          const res = await generateInvoicesForBranch(branch, period, actor, {
            silentWhenZero: !options?.forceInvoice,
          });
          invoicesCreated += res.createdCount;
          db.prepare(
            `INSERT INTO billing_auto_runs (branch_id, period, auto_invoiced_at)
             VALUES (?, ?, ?)
             ON CONFLICT(branch_id, period) DO UPDATE SET auto_invoiced_at = excluded.auto_invoiced_at`
          ).run(branch.id, period, nowIso());
        } catch (err) {
          errors.push(
            `${branch.name} (Tagihan): ${err instanceof Error ? err.message : 'Gagal membuat tagihan'}`
          );
        }
      }

      if (shouldRunAutoIsolir) {
        try {
          const isoRes = await isolateOverdueCustomersForBranch(branch, settings, actor, {
            ignoreCutoffDay: options?.forceIsolir,
          });
          isolatedCount += isoRes.isolatedCount;
          errors.push(...isoRes.errors);
          db.prepare(
            `INSERT INTO billing_auto_runs (branch_id, period, last_isolir_run_at)
             VALUES (?, ?, ?)
             ON CONFLICT(branch_id, period) DO UPDATE SET last_isolir_run_at = excluded.last_isolir_run_at`
          ).run(branch.id, period, nowIso());
        } catch (err) {
          errors.push(
            `${branch.name} (Isolir): ${err instanceof Error ? err.message : 'Gagal menjalankan isolir'}`
          );
        }
      }
    }

    return {
      period,
      day,
      invoicesCreated,
      isolatedCount,
      errors,
    };
  } finally {
    isCycleRunning = false;
  }
}
