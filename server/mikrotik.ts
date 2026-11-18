import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import {
  db,
  ensureSandboxRemoteNatRule,
  nowIso,
  recordBranchHealthCheck,
  type ConnectionMode,
  type DbBranch,
} from './db.ts';

export interface BranchStatusSummary {
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
  offlineSince: string | null;
  offlineDuration: string | null;
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

type RouterRow = Record<string, string>;

// --- RouterOS Binary API Protocol (Port 8728 / 8729) ---

function encodeWordLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x10000000) {
    const v = len | 0xe0000000;
    return Buffer.from([(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  return Buffer.from([
    0xf0,
    (len >>> 24) & 0xff,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
  ]);
}

function encodeSentence(words: string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const w of words) {
    const wb = Buffer.from(w, 'utf8');
    chunks.push(encodeWordLength(wb.length), wb);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function tryReadLength(buf: Buffer, offset: number): { length: number; bytesRead: number } | null {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  if ((b0 & 0x80) === 0) {
    return { length: b0, bytesRead: 1 };
  }
  if ((b0 & 0xc0) === 0x80) {
    if (offset + 2 > buf.length) return null;
    return { length: ((b0 & 0x3f) << 8) | buf[offset + 1], bytesRead: 2 };
  }
  if ((b0 & 0xe0) === 0xc0) {
    if (offset + 3 > buf.length) return null;
    return {
      length: ((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2],
      bytesRead: 3,
    };
  }
  if ((b0 & 0xf0) === 0xe0) {
    if (offset + 4 > buf.length) return null;
    return {
      length:
        ((b0 & 0x0f) << 24) |
        (buf[offset + 1] << 16) |
        (buf[offset + 2] << 8) |
        buf[offset + 3],
      bytesRead: 4,
    };
  }
  if (offset + 5 > buf.length) return null;
  return {
    length:
      (buf[offset + 1] << 24) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 8) |
      buf[offset + 4],
    bytesRead: 5,
  };
}

class RouterOsApiClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private currentSentence: string[] = [];
  private sentenceQueue: string[][] = [];
  private waiters: Array<(sentence: string[]) => void> = [];
  private closedError: Error | null = null;
  private commandChain: Promise<unknown> = Promise.resolve();

  async connect(host: string, port: number, useSsl: boolean, timeoutMs = 4500): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.close();
          reject(new Error(`Timeout koneksi ke ${host}:${port}`));
        }
      }, timeoutMs);

      const onConnect = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };

      const sock = useSsl
        ? tls.connect({ host, port, rejectUnauthorized: false }, onConnect)
        : net.createConnection({ host, port }, onConnect);

      this.socket = sock;

      sock.on('data', (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.drainBuffer();
      });

      sock.on('error', (err: Error) => {
        this.closedError = err;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Gagal terhubung ke ${host}:${port} (${err.message})`));
        }
      });

      sock.on('close', () => {
        if (!this.closedError) {
          this.closedError = new Error('Koneksi ke MikroTik terputus');
        }
        while (this.waiters.length > 0) {
          const w = this.waiters.shift();
          if (w) w(['!fatal', `=message=${this.closedError.message}`]);
        }
      });
    });
  }

  private drainBuffer(): void {
    let offset = 0;
    while (offset < this.buffer.length) {
      const lenInfo = tryReadLength(this.buffer, offset);
      if (!lenInfo) break;
      if (offset + lenInfo.bytesRead + lenInfo.length > this.buffer.length) break;

      offset += lenInfo.bytesRead;
      if (lenInfo.length === 0) {
        const completed = this.currentSentence;
        this.currentSentence = [];
        if (completed.length > 0) {
          const waiter = this.waiters.shift();
          if (waiter) {
            waiter(completed);
          } else {
            this.sentenceQueue.push(completed);
          }
        }
      } else {
        const word = this.buffer.subarray(offset, offset + lenInfo.length).toString('utf8');
        offset += lenInfo.length;
        this.currentSentence.push(word);
      }
    }
    if (offset > 0) {
      this.buffer = this.buffer.subarray(offset);
    }
  }

  private nextSentence(timeoutMs = 7000): Promise<string[]> {
    const queued = this.sentenceQueue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closedError) return Promise.reject(this.closedError);

    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(handler);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('Timeout menunggu respon MikroTik'));
      }, timeoutMs);

      const handler = (sentence: string[]) => {
        clearTimeout(timer);
        resolve(sentence);
      };

      this.waiters.push(handler);
    });
  }

  command(words: string[], timeoutMs = 8000): Promise<RouterRow[]> {
    const run = this.commandChain.then(() => this.executeCommand(words, timeoutMs));
    this.commandChain = run.catch(() => undefined);
    return run;
  }

  private async executeCommand(words: string[], timeoutMs = 8000): Promise<RouterRow[]> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Socket RouterOS tidak terhubung');
    }
    this.socket.write(encodeSentence(words));

    const rows: RouterRow[] = [];
    while (true) {
      const sentence = await this.nextSentence(timeoutMs);
      const replyType = sentence[0];
      const attrs: RouterRow = {};
      for (let i = 1; i < sentence.length; i++) {
        const w = sentence[i];
        if (w.startsWith('=')) {
          const eq = w.indexOf('=', 1);
          if (eq !== -1) {
            attrs[w.slice(1, eq)] = w.slice(eq + 1);
          } else {
            attrs[w.slice(1)] = '';
          }
        }
      }

      if (replyType === '!re') {
        rows.push(attrs);
      } else if (replyType === '!done') {
        if (Object.keys(attrs).length > 0) {
          rows.push(attrs);
        }
        return rows;
      } else if (replyType === '!trap' || replyType === '!fatal') {
        throw new Error(attrs.message || 'Perintah RouterOS ditolak (!trap)');
      }
    }
  }

  async login(username: string, password: string): Promise<void> {
    // RouterOS v6.43+ uses post-login cleartext parameters directly.
    // Legacy RouterOS (<6.43) returns =ret=<challenge> on bare /login.
    const firstTry = await this.command(['/login', `=name=${username}`, `=password=${password}`]);
    if (firstTry.length > 0 && firstTry[0].ret) {
      const challenge = Buffer.from(firstTry[0].ret, 'hex');
      const md5 = crypto.createHash('md5');
      md5.update(Buffer.from([0]));
      md5.update(Buffer.from(password, 'utf8'));
      md5.update(challenge);
      const responseHex = '00' + md5.digest('hex');
      await this.command(['/login', `=name=${username}`, `=response=${responseHex}`]);
    }
  }

  close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
  }
}

async function withApiClient<T>(branch: DbBranch, fn: (client: RouterOsApiClient) => Promise<T>): Promise<T> {
  const client = new RouterOsApiClient();
  try {
    await client.connect(branch.host, branch.port, branch.connection_mode === 'api-ssl');
    await client.login(branch.username, branch.password);
    return await fn(client);
  } finally {
    client.close();
  }
}

// --- RouterOS v7 REST API Client (HTTP / HTTPS) ---

async function restRequest<T>(
  branch: DbBranch,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  pathUrl: string,
  body?: unknown,
  timeoutMs = 7000
): Promise<T> {
  const isHttps = branch.connection_mode === 'rest-https';
  const transport = isHttps ? https : http;
  const authHeader =
    'Basic ' + Buffer.from(`${branch.username}:${branch.password}`, 'utf8').toString('base64');
  const payload = body !== undefined ? JSON.stringify(body) : undefined;

  return new Promise<T>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: branch.host,
        port: branch.port,
        path: `/rest${pathUrl}`,
        method,
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 500;
          if (status >= 400) {
            let msg = `HTTP ${status}`;
            try {
              const parsed = JSON.parse(text) as { detail?: string; message?: string };
              msg = parsed.detail || parsed.message || msg;
            } catch {
              if (text) msg = text.slice(0, 180);
            }
            reject(new Error(`REST API MikroTik gagal: ${msg}`));
            return;
          }
          if (!text) {
            resolve([] as unknown as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            resolve(text as unknown as T);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout koneksi REST ke ${branch.host}:${branch.port}`));
    });
    req.on('error', (err) => {
      reject(new Error(`Gagal terhubung ke ${branch.host}:${branch.port} (${err.message})`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// --- Helper functions ---

function parseRttMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/([\d.]+)\s*(ms|us|s)?/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  if (Number.isNaN(val)) return null;
  const unit = (match[2] || 'ms').toLowerCase();
  if (unit === 'us') return Number((val / 1000).toFixed(2));
  if (unit === 's') return Number((val * 1000).toFixed(2));
  return Number(val.toFixed(2));
}

function parseWifiComment(comment: string | undefined): { wifiName: string; wifiPassword: string } {
  const raw = (comment || '').trim();
  if (!raw) return { wifiName: '', wifiPassword: '' };

  const fullMatch = raw.match(/^WiFi:\s*(.*?)\s*\|\s*Pass:\s*(.*)$/i);
  if (fullMatch) {
    return { wifiName: fullMatch[1].trim(), wifiPassword: fullMatch[2].trim() };
  }
  const wifiOnlyMatch = raw.match(/^WiFi:\s*(.*)$/i);
  if (wifiOnlyMatch) {
    return { wifiName: wifiOnlyMatch[1].trim(), wifiPassword: '' };
  }
  const passOnlyMatch = raw.match(/^Pass WiFi:\s*(.*)$/i);
  if (passOnlyMatch) {
    return { wifiName: '', wifiPassword: passOnlyMatch[1].trim() };
  }
  return { wifiName: raw, wifiPassword: '' };
}

function formatWifiComment(wifiName: string | undefined, wifiPassword: string | undefined): string {
  const ssid = (wifiName || '').replace(/[\r\n]+/g, ' ').trim();
  const pass = (wifiPassword || '').replace(/[\r\n]+/g, ' ').trim();
  if (ssid && pass) return `WiFi: ${ssid} | Pass: ${pass}`;
  if (ssid) return `WiFi: ${ssid}`;
  if (pass) return `Pass WiFi: ${pass}`;
  return '';
}

function mapCustomers(
  secrets: RouterRow[],
  actives: RouterRow[]
): PppoeCustomer[] {
  const activeByName = new Map<string, RouterRow>();
  for (const a of actives) {
    if (a.name) activeByName.set(a.name, a);
  }

  return secrets.map((s) => {
    const active = s.name ? activeByName.get(s.name) : undefined;
    const isDisabled = s.disabled === 'true' || s.disabled === 'yes';
    const wifi = parseWifiComment(s.comment);
    return {
      id: s['.id'] || s.id || s.name || '',
      name: s.name || '',
      password: s.password || '',
      service: s.service || 'pppoe',
      profile: s.profile || 'default',
      wifiName: wifi.wifiName,
      wifiPassword: wifi.wifiPassword,
      disabled: isDisabled,
      status: active ? 'aktif' : 'tidak_aktif',
      activeAddress: active?.address || null,
      activeUptime: active?.uptime || null,
      callerId: active?.['caller-id'] || null,
    };
  });
}

// --- Sandbox Engine ---

interface SandboxSecretRow {
  id: number;
  branch_id: number;
  name: string;
  password: string;
  service: string;
  profile: string;
  wifi_name: string;
  wifi_password: string;
  disabled: number;
  is_online: number;
  active_address: string | null;
  caller_id: string | null;
  uptime: string | null;
}

function getSandboxProfiles(branchId: number): string[] {
  const rows = db
    .prepare('SELECT name FROM sandbox_profiles WHERE branch_id = ? ORDER BY id ASC')
    .all(branchId) as Array<{ name: string }>;
  if (rows.length === 0) {
    return ['default', '10Mbps-Rumahan', '20Mbps-Keluarga', '35Mbps-Bisnis'];
  }
  return rows.map((r) => r.name);
}

function getSandboxCustomers(branchId: number): PppoeCustomer[] {
  const rows = db
    .prepare('SELECT * FROM sandbox_secrets WHERE branch_id = ? ORDER BY id DESC')
    .all(branchId) as SandboxSecretRow[];

  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    password: r.password,
    service: r.service,
    profile: r.profile,
    wifiName: r.wifi_name || '',
    wifiPassword: r.wifi_password || '',
    disabled: r.disabled === 1,
    status: r.is_online === 1 && r.disabled === 0 ? 'aktif' : 'tidak_aktif',
    activeAddress: r.is_online === 1 ? r.active_address || `172.16.${branchId}.${10 + (r.id % 200)}` : null,
    activeUptime: r.is_online === 1 ? r.uptime || '02:18:44' : null,
    callerId: r.is_online === 1 ? r.caller_id || 'D4:CA:6D:00:11:22' : null,
  }));
}

async function performSandboxPing(branch: DbBranch, target: string, count: number): Promise<PingResult> {
  const packets: PingPacketResult[] = [];
  const cleanTarget = target.trim();
  const isHostname = /[a-zA-Z]/.test(cleanTarget);

  // Measure real TCP probe latency if target looks like public domain/host, otherwise realistic local LAN RTT
  for (let i = 0; i < count; i++) {
    let rttMs: number | null = null;
    let status = 'ok';
    if (cleanTarget === '0.0.0.0' || cleanTarget.endsWith('.254.254')) {
      status = 'timeout';
    } else if (isHostname) {
      const start = performance.now();
      const reachable = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ host: cleanTarget, port: 443, timeout: 1500 }, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => {
          sock.destroy();
          resolve(false);
        });
        sock.on('timeout', () => {
          sock.destroy();
          resolve(false);
        });
      });
      if (reachable) {
        rttMs = Number((performance.now() - start).toFixed(2));
      } else {
        // Fallback deterministic LAN-like check if outbound 443 blocked
        rttMs = Number((12.4 + Math.random() * 4.2).toFixed(2));
      }
    } else {
      const base = cleanTarget.startsWith('192.168.') || cleanTarget.startsWith('10.') || cleanTarget.startsWith('172.') ? 2.1 : 14.5;
      rttMs = Number((base + Math.random() * 3.8).toFixed(2));
    }

    packets.push({
      seq: i,
      host: cleanTarget,
      size: rttMs !== null ? 56 : null,
      ttl: rttMs !== null ? 64 : null,
      timeMs: rttMs,
      status,
    });
  }

  const rtts = packets.map((p) => p.timeMs).filter((v): v is number => v !== null);
  const received = rtts.length;
  const packetLossPct = Math.round(((count - received) / count) * 100);

  return {
    branchId: branch.id,
    branchName: branch.name,
    target: cleanTarget,
    sent: count,
    received,
    packetLossPct,
    minRttMs: rtts.length ? Math.min(...rtts) : null,
    avgRttMs: rtts.length ? Number((rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(2)) : null,
    maxRttMs: rtts.length ? Math.max(...rtts) : null,
    packets,
    checkedAt: new Date().toISOString(),
  };
}

// --- Public Service Operations ---

export async function getBranchStatus(branch: DbBranch): Promise<BranchStatusSummary> {
  const checkedAt = new Date().toISOString();

  if (branch.connection_mode === 'sandbox') {
    const customers = getSandboxCustomers(branch.id);
    const activeCount = customers.filter((c) => c.status === 'aktif').length;
    recordBranchHealthCheck(branch.id, true, checkedAt);
    return {
      branchId: branch.id,
      branchName: branch.name,
      location: branch.location,
      connectionMode: branch.connection_mode,
      host: branch.host,
      port: branch.port,
      online: true,
      error: null,
      identity: `${branch.name} (RB750Gr3 Sandbox)`,
      version: '7.15.3 (stable)',
      uptime: '18d 09:42:11',
      offlineSince: null,
      offlineDuration: null,
      cpuLoad: '14%',
      activeCount,
      inactiveCount: customers.length - activeCount,
      totalSecrets: customers.length,
      checkedAt,
    };
  }

  try {
    if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
      const [resource, identityRes, secrets, actives] = await Promise.all([
        restRequest<RouterRow>(branch, 'GET', '/system/resource'),
        restRequest<RouterRow>(branch, 'GET', '/system/identity').catch(() => ({ name: branch.name })),
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/secret'),
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/active'),
      ]);
      const mapped = mapCustomers(Array.isArray(secrets) ? secrets : [], Array.isArray(actives) ? actives : []);
      const activeCount = mapped.filter((c) => c.status === 'aktif').length;
      recordBranchHealthCheck(branch.id, true, checkedAt);
      return {
        branchId: branch.id,
        branchName: branch.name,
        location: branch.location,
        connectionMode: branch.connection_mode,
        host: branch.host,
        port: branch.port,
        online: true,
        error: null,
        identity: identityRes.name || resource['board-name'] || branch.name,
        version: resource.version || null,
        uptime: resource.uptime || null,
        offlineSince: null,
        offlineDuration: null,
        cpuLoad: resource['cpu-load'] ? `${resource['cpu-load']}%` : null,
        activeCount,
        inactiveCount: mapped.length - activeCount,
        totalSecrets: mapped.length,
        checkedAt,
      };
    }

    return await withApiClient(branch, async (client) => {
      const [resources, identities, secrets, actives] = await Promise.all([
        client.command(['/system/resource/print']),
        client.command(['/system/identity/print']).catch(() => [] as RouterRow[]),
        client.command(['/ppp/secret/print']),
        client.command(['/ppp/active/print']),
      ]);
      const res0 = resources[0] || {};
      const id0 = identities[0] || {};
      const mapped = mapCustomers(secrets, actives);
      const activeCount = mapped.filter((c) => c.status === 'aktif').length;
      recordBranchHealthCheck(branch.id, true, checkedAt);
      return {
        branchId: branch.id,
        branchName: branch.name,
        location: branch.location,
        connectionMode: branch.connection_mode,
        host: branch.host,
        port: branch.port,
        online: true,
        error: null,
        identity: id0.name || res0['board-name'] || branch.name,
        version: res0.version || null,
        uptime: res0.uptime || null,
        offlineSince: null,
        offlineDuration: null,
        cpuLoad: res0['cpu-load'] ? `${res0['cpu-load']}%` : null,
        activeCount,
        inactiveCount: mapped.length - activeCount,
        totalSecrets: mapped.length,
        checkedAt,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Koneksi gagal';
    const health = recordBranchHealthCheck(branch.id, false, checkedAt);
    return {
      branchId: branch.id,
      branchName: branch.name,
      location: branch.location,
      connectionMode: branch.connection_mode,
      host: branch.host,
      port: branch.port,
      online: false,
      error: message,
      identity: null,
      version: null,
      uptime: null,
      offlineSince: health.offlineSince,
      offlineDuration: health.offlineDuration,
      cpuLoad: null,
      activeCount: 0,
      inactiveCount: 0,
      totalSecrets: 0,
      checkedAt,
    };
  }
}

export async function getBranchCustomers(branch: DbBranch): Promise<{
  online: boolean;
  error: string | null;
  profiles: string[];
  customers: PppoeCustomer[];
}> {
  if (branch.connection_mode === 'sandbox') {
    return {
      online: true,
      error: null,
      profiles: getSandboxProfiles(branch.id),
      customers: getSandboxCustomers(branch.id),
    };
  }

  try {
    if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
      const [secrets, actives, profiles] = await Promise.all([
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/secret'),
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/active'),
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/profile').catch(() => [] as RouterRow[]),
      ]);
      const profNames = (Array.isArray(profiles) ? profiles : [])
        .map((p) => p.name)
        .filter((n): n is string => Boolean(n));
      return {
        online: true,
        error: null,
        profiles: profNames.length > 0 ? profNames : ['default'],
        customers: mapCustomers(Array.isArray(secrets) ? secrets : [], Array.isArray(actives) ? actives : []),
      };
    }

    return await withApiClient(branch, async (client) => {
      const [secrets, actives, profiles] = await Promise.all([
        client.command(['/ppp/secret/print']),
        client.command(['/ppp/active/print']),
        client.command(['/ppp/profile/print']).catch(() => [] as RouterRow[]),
      ]);
      const profNames = profiles.map((p) => p.name).filter((n): n is string => Boolean(n));
      return {
        online: true,
        error: null,
        profiles: profNames.length > 0 ? profNames : ['default'],
        customers: mapCustomers(secrets, actives),
      };
    });
  } catch (err) {
    return {
      online: false,
      error: err instanceof Error ? err.message : 'Gagal mengambil data pelanggan dari MikroTik',
      profiles: ['default'],
      customers: [],
    };
  }
}

export async function addBranchCustomer(
  branch: DbBranch,
  input: {
    name: string;
    password: string;
    service: string;
    profile: string;
    wifiName?: string;
    wifiPassword?: string;
  }
): Promise<void> {
  const comment = formatWifiComment(input.wifiName, input.wifiPassword);

  if (branch.connection_mode === 'sandbox') {
    const existing = db
      .prepare('SELECT id FROM sandbox_secrets WHERE branch_id = ? AND name = ?')
      .get(branch.id, input.name);
    if (existing) {
      throw new Error(`Pelanggan "${input.name}" sudah terdaftar di cabang ini.`);
    }
    db.prepare(
      `INSERT INTO sandbox_secrets (branch_id, name, password, service, profile, wifi_name, wifi_password, disabled, is_online)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      branch.id,
      input.name,
      input.password,
      input.service,
      input.profile,
      (input.wifiName || '').trim(),
      (input.wifiPassword || '').trim()
    );
    return;
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    const body: Record<string, string> = {
      name: input.name,
      password: input.password,
      service: input.service,
      profile: input.profile,
    };
    if (comment) body.comment = comment;
    await restRequest(branch, 'PUT', '/ppp/secret', body);
    return;
  }

  await withApiClient(branch, async (client) => {
    const args = [
      '/ppp/secret/add',
      `=name=${input.name}`,
      `=password=${input.password}`,
      `=service=${input.service}`,
      `=profile=${input.profile}`,
    ];
    if (comment) args.push(`=comment=${comment}`);
    await client.command(args);
  });
}

export async function updateBranchCustomer(
  branch: DbBranch,
  secretId: string,
  input: {
    name: string;
    password: string;
    service: string;
    profile: string;
    wifiName?: string;
    wifiPassword?: string;
  }
): Promise<{ removedActiveCount: number }> {
  const comment = formatWifiComment(input.wifiName, input.wifiPassword);

  if (branch.connection_mode === 'sandbox') {
    const numericId = Number(secretId);
    const existing = db
      .prepare('SELECT id, is_online FROM sandbox_secrets WHERE id = ? AND branch_id = ?')
      .get(numericId, branch.id) as { id: number; is_online: number } | undefined;
    if (!existing) {
      throw new Error('Data pelanggan tidak ditemukan.');
    }
    db.prepare(
      `UPDATE sandbox_secrets
       SET name = ?, password = ?, service = ?, profile = ?, wifi_name = ?, wifi_password = ?, is_online = 0, active_address = NULL, uptime = NULL
       WHERE id = ? AND branch_id = ?`
    ).run(
      input.name,
      input.password,
      input.service,
      input.profile,
      (input.wifiName || '').trim(),
      (input.wifiPassword || '').trim(),
      numericId,
      branch.id
    );
    return { removedActiveCount: existing.is_online === 1 ? 1 : 0 };
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    const currentSecret = await restRequest<RouterRow>(
      branch,
      'GET',
      `/ppp/secret/${encodeURIComponent(secretId)}`
    ).catch(() => ({} as RouterRow));
    const oldName = currentSecret.name;

    await restRequest(branch, 'PATCH', `/ppp/secret/${encodeURIComponent(secretId)}`, {
      name: input.name,
      password: input.password,
      service: input.service,
      profile: input.profile,
      comment,
    });

    const actives = await restRequest<RouterRow[]>(branch, 'GET', '/ppp/active').catch(
      () => [] as RouterRow[]
    );
    const targetNames = new Set([input.name]);
    if (oldName) targetNames.add(oldName);

    let removedActiveCount = 0;
    for (const active of Array.isArray(actives) ? actives : []) {
      const activeId = active['.id'] || active.id;
      if (activeId && active.name && targetNames.has(active.name)) {
        await restRequest(branch, 'DELETE', `/ppp/active/${encodeURIComponent(activeId)}`);
        removedActiveCount++;
      }
    }
    return { removedActiveCount };
  }

  return await withApiClient(branch, async (client) => {
    const secrets = await client.command(['/ppp/secret/print']).catch(() => [] as RouterRow[]);
    const existing = secrets.find((s) => s['.id'] === secretId);
    const oldName = existing?.name;

    await client.command([
      '/ppp/secret/set',
      `=.id=${secretId}`,
      `=name=${input.name}`,
      `=password=${input.password}`,
      `=service=${input.service}`,
      `=profile=${input.profile}`,
      `=comment=${comment}`,
    ]);

    const actives = await client.command(['/ppp/active/print']);
    const targetNames = new Set([input.name]);
    if (oldName) targetNames.add(oldName);

    let removedActiveCount = 0;
    for (const active of actives) {
      const activeId = active['.id'];
      if (activeId && active.name && targetNames.has(active.name)) {
        await client.command(['/ppp/active/remove', `=.id=${activeId}`]);
        removedActiveCount++;
      }
    }
    return { removedActiveCount };
  });
}

export async function deleteBranchCustomer(branch: DbBranch, secretId: string): Promise<void> {
  if (branch.connection_mode === 'sandbox') {
    const numericId = Number(secretId);
    db.prepare('DELETE FROM sandbox_secrets WHERE id = ? AND branch_id = ?').run(numericId, branch.id);
    return;
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    await restRequest(branch, 'DELETE', `/ppp/secret/${encodeURIComponent(secretId)}`);
    return;
  }

  await withApiClient(branch, async (client) => {
    await client.command(['/ppp/secret/remove', `=.id=${secretId}`]);
  });
}

export async function setBranchCustomerProfile(
  branch: DbBranch,
  secretId: string,
  customerName: string,
  targetProfile: string
): Promise<{ removedActiveCount: number }> {
  if (branch.connection_mode === 'sandbox') {
    const numericId = Number(secretId);
    const existing = db
      .prepare('SELECT id, is_online FROM sandbox_secrets WHERE id = ? AND branch_id = ?')
      .get(numericId, branch.id) as { id: number; is_online: number } | undefined;
    if (!existing) {
      throw new Error(`Pelanggan "${customerName}" tidak ditemukan di sandbox.`);
    }
    const hasProfile = db
      .prepare('SELECT id FROM sandbox_profiles WHERE branch_id = ? AND name = ?')
      .get(branch.id, targetProfile);
    if (!hasProfile) {
      db.prepare('INSERT INTO sandbox_profiles (branch_id, name) VALUES (?, ?)').run(
        branch.id,
        targetProfile
      );
    }
    db.prepare(
      `UPDATE sandbox_secrets
       SET profile = ?, is_online = 0, active_address = NULL, uptime = NULL
       WHERE id = ? AND branch_id = ?`
    ).run(targetProfile, numericId, branch.id);
    return { removedActiveCount: existing.is_online === 1 ? 1 : 0 };
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    await restRequest(branch, 'PATCH', `/ppp/secret/${encodeURIComponent(secretId)}`, {
      profile: targetProfile,
    });

    const actives = await restRequest<RouterRow[]>(branch, 'GET', '/ppp/active').catch(
      () => [] as RouterRow[]
    );
    let removedActiveCount = 0;
    for (const active of Array.isArray(actives) ? actives : []) {
      const activeId = active['.id'] || active.id;
      if (activeId && active.name === customerName) {
        await restRequest(branch, 'DELETE', `/ppp/active/${encodeURIComponent(activeId)}`);
        removedActiveCount++;
      }
    }
    return { removedActiveCount };
  }

  return await withApiClient(branch, async (client) => {
    await client.command([
      '/ppp/secret/set',
      `=.id=${secretId}`,
      `=profile=${targetProfile}`,
    ]);

    const actives = await client.command(['/ppp/active/print']);
    let removedActiveCount = 0;
    for (const active of actives) {
      const activeId = active['.id'];
      if (activeId && active.name === customerName) {
        await client.command(['/ppp/active/remove', `=.id=${activeId}`]);
        removedActiveCount++;
      }
    }
    return { removedActiveCount };
  });
}

// --- PPPoE Profiles (Paket Internet) ---

interface SandboxProfileRow {
  id: number;
  branch_id: number;
  name: string;
  local_address: string;
  remote_address: string;
  rate_limit: string;
  dns_server: string;
  only_one: string;
  parent_queue: string;
}

function mapProfiles(rows: RouterRow[]): PppoeProfile[] {
  return rows.map((r) => ({
    id: r['.id'] || r.id || r.name || '',
    name: r.name || '',
    localAddress: r['local-address'] || '',
    remoteAddress: r['remote-address'] || '',
    rateLimit: r['rate-limit'] || '',
    dnsServer: r['dns-server'] || '',
    onlyOne: r['only-one'] || 'default',
    parentQueue: r['parent-queue'] || '',
    isDefault: r.default === 'true' || r.default === 'yes',
  }));
}

export interface ProfileInput {
  name: string;
  localAddress: string;
  remoteAddress: string;
  rateLimit: string;
  dnsServer: string;
  onlyOne: string;
  parentQueue: string;
}

export async function getBranchProfiles(branch: DbBranch): Promise<{
  online: boolean;
  error: string | null;
  packages: PppoeProfile[];
  ipPools: string[];
}> {
  if (branch.connection_mode === 'sandbox') {
    const rows = db
      .prepare('SELECT * FROM sandbox_profiles WHERE branch_id = ? ORDER BY id ASC')
      .all(branch.id) as SandboxProfileRow[];
    return {
      online: true,
      error: null,
      packages: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        localAddress: r.local_address || '',
        remoteAddress: r.remote_address || '',
        rateLimit: r.rate_limit || '',
        dnsServer: r.dns_server || '',
        onlyOne: r.only_one || 'yes',
        parentQueue: r.parent_queue || '',
        isDefault: r.name === 'default',
      })),
      ipPools: ['pool1-pppoe', 'pool1-ppp-isolir'],
    };
  }

  try {
    if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
      const [profiles, pools] = await Promise.all([
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/profile'),
        restRequest<RouterRow[]>(branch, 'GET', '/ip/pool').catch(() => [] as RouterRow[]),
      ]);
      const poolNames = (Array.isArray(pools) ? pools : [])
        .map((p) => p.name)
        .filter((n): n is string => Boolean(n));
      return {
        online: true,
        error: null,
        packages: mapProfiles(Array.isArray(profiles) ? profiles : []),
        ipPools: poolNames,
      };
    }

    return await withApiClient(branch, async (client) => {
      const [profiles, pools] = await Promise.all([
        client.command(['/ppp/profile/print']),
        client.command(['/ip/pool/print']).catch(() => [] as RouterRow[]),
      ]);
      const poolNames = pools.map((p) => p.name).filter((n): n is string => Boolean(n));
      return {
        online: true,
        error: null,
        packages: mapProfiles(profiles),
        ipPools: poolNames,
      };
    });
  } catch (err) {
    return {
      online: false,
      error: err instanceof Error ? err.message : 'Gagal mengambil daftar paket internet dari MikroTik',
      packages: [],
      ipPools: [],
    };
  }
}

export async function addBranchProfile(branch: DbBranch, input: ProfileInput): Promise<void> {
  if (branch.connection_mode === 'sandbox') {
    const dup = db
      .prepare('SELECT id FROM sandbox_profiles WHERE branch_id = ? AND name = ?')
      .get(branch.id, input.name);
    if (dup) {
      throw new Error(`Paket internet "${input.name}" sudah ada di cabang ini.`);
    }
    db.prepare(
      `INSERT INTO sandbox_profiles (branch_id, name, local_address, remote_address, rate_limit, dns_server, only_one, parent_queue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      branch.id,
      input.name,
      input.localAddress,
      input.remoteAddress,
      input.rateLimit,
      input.dnsServer,
      input.onlyOne || 'yes',
      input.parentQueue
    );
    return;
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    const body: Record<string, string> = { name: input.name };
    if (input.localAddress) body['local-address'] = input.localAddress;
    if (input.remoteAddress) body['remote-address'] = input.remoteAddress;
    if (input.rateLimit) body['rate-limit'] = input.rateLimit;
    if (input.dnsServer) body['dns-server'] = input.dnsServer;
    if (input.onlyOne) body['only-one'] = input.onlyOne;
    if (input.parentQueue) body['parent-queue'] = input.parentQueue;
    await restRequest(branch, 'PUT', '/ppp/profile', body);
    return;
  }

  await withApiClient(branch, async (client) => {
    const args = ['/ppp/profile/add', `=name=${input.name}`];
    if (input.localAddress) args.push(`=local-address=${input.localAddress}`);
    if (input.remoteAddress) args.push(`=remote-address=${input.remoteAddress}`);
    if (input.rateLimit) args.push(`=rate-limit=${input.rateLimit}`);
    if (input.dnsServer) args.push(`=dns-server=${input.dnsServer}`);
    if (input.onlyOne) args.push(`=only-one=${input.onlyOne}`);
    if (input.parentQueue) args.push(`=parent-queue=${input.parentQueue}`);
    await client.command(args);
  });
}

export async function updateBranchProfile(
  branch: DbBranch,
  profileId: string,
  input: ProfileInput
): Promise<void> {
  if (branch.connection_mode === 'sandbox') {
    const numId = Number(profileId);
    const existing = db
      .prepare('SELECT id FROM sandbox_profiles WHERE id = ? AND branch_id = ?')
      .get(numId, branch.id);
    if (!existing) {
      throw new Error('Paket internet tidak ditemukan.');
    }
    db.prepare(
      `UPDATE sandbox_profiles
       SET name = ?, local_address = ?, remote_address = ?, rate_limit = ?, dns_server = ?, only_one = ?, parent_queue = ?
       WHERE id = ? AND branch_id = ?`
    ).run(
      input.name,
      input.localAddress,
      input.remoteAddress,
      input.rateLimit,
      input.dnsServer,
      input.onlyOne || 'default',
      input.parentQueue,
      numId,
      branch.id
    );
    return;
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    await restRequest(branch, 'PATCH', `/ppp/profile/${encodeURIComponent(profileId)}`, {
      name: input.name,
      'local-address': input.localAddress,
      'remote-address': input.remoteAddress,
      'rate-limit': input.rateLimit,
      'dns-server': input.dnsServer,
      'only-one': input.onlyOne || 'default',
      'parent-queue': input.parentQueue,
    });
    return;
  }

  await withApiClient(branch, async (client) => {
    const args = [
      '/ppp/profile/set',
      `=.id=${profileId}`,
      `=name=${input.name}`,
      `=local-address=${input.localAddress}`,
      `=remote-address=${input.remoteAddress}`,
      `=rate-limit=${input.rateLimit}`,
      `=dns-server=${input.dnsServer}`,
      `=only-one=${input.onlyOne || 'default'}`,
      `=parent-queue=${input.parentQueue}`,
    ];
    await client.command(args);
  });
}

export async function deleteBranchProfile(branch: DbBranch, profileId: string): Promise<void> {
  if (branch.connection_mode === 'sandbox') {
    db.prepare('DELETE FROM sandbox_profiles WHERE id = ? AND branch_id = ?').run(
      Number(profileId),
      branch.id
    );
    return;
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    await restRequest(branch, 'DELETE', `/ppp/profile/${encodeURIComponent(profileId)}`);
    return;
  }

  await withApiClient(branch, async (client) => {
    await client.command(['/ppp/profile/remove', `=.id=${profileId}`]);
  });
}

export async function pingFromBranch(
  branch: DbBranch,
  target: string,
  count = 4
): Promise<PingResult> {
  const safeCount = Math.min(Math.max(count, 1), 10);

  if (branch.connection_mode === 'sandbox') {
    return performSandboxPing(branch, target, safeCount);
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    const rows = await restRequest<RouterRow[]>(
      branch,
      'POST',
      '/ping',
      { address: target, count: String(safeCount) },
      15000
    );
    const list = Array.isArray(rows) ? rows : [];
    const packets: PingPacketResult[] = list.map((r, idx) => ({
      seq: r.seq !== undefined ? Number(r.seq) : idx,
      host: r.host || target,
      size: r.size ? Number(r.size) : null,
      ttl: r.ttl ? Number(r.ttl) : null,
      timeMs: parseRttMs(r.time),
      status: r.status || (r.time ? 'ok' : 'timeout'),
    }));
    const last = list[list.length - 1] || {};
    const validRtts = packets.map((p) => p.timeMs).filter((n): n is number => n !== null);
    const sent = last.sent ? Number(last.sent) : packets.length || safeCount;
    const received = last.received ? Number(last.received) : validRtts.length;
    const loss =
      last['packet-loss'] !== undefined
        ? Number(last['packet-loss'])
        : sent > 0
          ? Math.round(((sent - received) / sent) * 100)
          : 100;

    return {
      branchId: branch.id,
      branchName: branch.name,
      target,
      sent,
      received,
      packetLossPct: loss,
      minRttMs: parseRttMs(last['min-rtt']) ?? (validRtts.length ? Math.min(...validRtts) : null),
      avgRttMs:
        parseRttMs(last['avg-rtt']) ??
        (validRtts.length
          ? Number((validRtts.reduce((a, b) => a + b, 0) / validRtts.length).toFixed(2))
          : null),
      maxRttMs: parseRttMs(last['max-rtt']) ?? (validRtts.length ? Math.max(...validRtts) : null),
      packets,
      checkedAt: new Date().toISOString(),
    };
  }

  return await withApiClient(branch, async (client) => {
    const rows = await client.command(
      ['/ping', `=address=${target}`, `=count=${safeCount}`],
      15000
    );
    const packets: PingPacketResult[] = [];
    let summary: RouterRow = {};

    for (const r of rows) {
      if (r.sent !== undefined && r.received !== undefined && r.seq === undefined) {
        summary = r;
      } else {
        packets.push({
          seq: r.seq !== undefined ? Number(r.seq) : packets.length,
          host: r.host || target,
          size: r.size ? Number(r.size) : null,
          ttl: r.ttl ? Number(r.ttl) : null,
          timeMs: parseRttMs(r.time),
          status: r.status || (r.time ? 'ok' : 'timeout'),
        });
        if (r.sent !== undefined) summary = r;
      }
    }

    const validRtts = packets.map((p) => p.timeMs).filter((n): n is number => n !== null);
    const sent = summary.sent ? Number(summary.sent) : packets.length || safeCount;
    const received = summary.received ? Number(summary.received) : validRtts.length;
    const loss =
      summary['packet-loss'] !== undefined
        ? Number(summary['packet-loss'])
        : sent > 0
          ? Math.round(((sent - received) / sent) * 100)
          : 100;

    return {
      branchId: branch.id,
      branchName: branch.name,
      target,
      sent,
      received,
      packetLossPct: loss,
      minRttMs: parseRttMs(summary['min-rtt']) ?? (validRtts.length ? Math.min(...validRtts) : null),
      avgRttMs:
        parseRttMs(summary['avg-rtt']) ??
        (validRtts.length
          ? Number((validRtts.reduce((a, b) => a + b, 0) / validRtts.length).toFixed(2))
          : null),
      maxRttMs: parseRttMs(summary['max-rtt']) ?? (validRtts.length ? Math.max(...validRtts) : null),
      packets,
      checkedAt: new Date().toISOString(),
    };
  });
}

// --- Remote ONU Pelanggan via IP > Firewall > NAT (comment: remot-onu) ---

function findRemoteOnuNatRow(natRows: RouterRow[]): RouterRow | undefined {
  const exact = natRows.find((r) => (r.comment || '').trim() === 'remot-onu');
  if (exact) return exact;
  return natRows.find((r) => (r.comment || '').trim().toLowerCase() === 'remot-onu');
}

function mapNatRow(row: RouterRow | undefined): OnuNatRuleStatus {
  if (!row) {
    return {
      found: false,
      id: null,
      chain: 'dstnat',
      action: 'dst-nat',
      protocol: '',
      dstPort: '',
      toAddresses: '',
      toPorts: '',
      comment: 'remot-onu',
      disabled: false,
    };
  }
  return {
    found: true,
    id: row['.id'] || row.id || null,
    chain: row.chain || 'dstnat',
    action: row.action || 'dst-nat',
    protocol: row.protocol || '',
    dstPort: row['dst-port'] || '',
    toAddresses: row['to-addresses'] || '',
    toPorts: row['to-ports'] || '',
    comment: row.comment || 'remot-onu',
    disabled: row.disabled === 'true' || row.disabled === 'yes',
  };
}

function validateIpv4Address(raw: string): string {
  const trimmed = (raw || '').trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    throw new Error('Alamat IP pelanggan tidak valid. Gunakan format IPv4 yang benar (contoh: 172.16.10.11).');
  }
  return trimmed;
}

export async function getBranchOnuRemoteData(branch: DbBranch): Promise<{
  online: boolean;
  error: string | null;
  customers: PppoeCustomer[];
  natRule: OnuNatRuleStatus;
}> {
  if (branch.connection_mode === 'sandbox') {
    const nat = ensureSandboxRemoteNatRule(branch.id);
    return {
      online: true,
      error: null,
      customers: getSandboxCustomers(branch.id),
      natRule: {
        found: true,
        id: String(nat.id),
        chain: nat.chain,
        action: nat.action,
        protocol: nat.protocol,
        dstPort: nat.dst_port,
        toAddresses: nat.to_addresses,
        toPorts: nat.to_ports,
        comment: nat.comment,
        disabled: nat.disabled === 1,
      },
    };
  }

  try {
    if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
      const [secrets, actives, natRules] = await Promise.all([
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/secret'),
        restRequest<RouterRow[]>(branch, 'GET', '/ppp/active'),
        restRequest<RouterRow[]>(branch, 'GET', '/ip/firewall/nat'),
      ]);
      return {
        online: true,
        error: null,
        customers: mapCustomers(
          Array.isArray(secrets) ? secrets : [],
          Array.isArray(actives) ? actives : []
        ),
        natRule: mapNatRow(findRemoteOnuNatRow(Array.isArray(natRules) ? natRules : [])),
      };
    }

    return await withApiClient(branch, async (client) => {
      const [secrets, actives, natRules] = await Promise.all([
        client.command(['/ppp/secret/print']),
        client.command(['/ppp/active/print']),
        client.command(['/ip/firewall/nat/print']),
      ]);
      return {
        online: true,
        error: null,
        customers: mapCustomers(secrets, actives),
        natRule: mapNatRow(findRemoteOnuNatRow(natRules)),
      };
    });
  } catch (err) {
    return {
      online: false,
      error: err instanceof Error ? err.message : 'Gagal membaca data NAT dan pelanggan dari MikroTik',
      customers: [],
      natRule: mapNatRow(undefined),
    };
  }
}

export async function setBranchOnuRemoteTarget(
  branch: DbBranch,
  ipAddress: string
): Promise<OnuNatRuleStatus> {
  const cleanIp = validateIpv4Address(ipAddress);

  if (branch.connection_mode === 'sandbox') {
    const nat = ensureSandboxRemoteNatRule(branch.id);
    db.prepare('UPDATE sandbox_nat_rules SET to_addresses = ?, updated_at = ? WHERE id = ? AND branch_id = ?').run(
      cleanIp,
      nowIso(),
      nat.id,
      branch.id
    );
    return {
      found: true,
      id: String(nat.id),
      chain: nat.chain,
      action: nat.action,
      protocol: nat.protocol,
      dstPort: nat.dst_port,
      toAddresses: cleanIp,
      toPorts: nat.to_ports,
      comment: nat.comment,
      disabled: nat.disabled === 1,
    };
  }

  if (branch.connection_mode === 'rest-http' || branch.connection_mode === 'rest-https') {
    const natRules = await restRequest<RouterRow[]>(branch, 'GET', '/ip/firewall/nat');
    const targetRow = findRemoteOnuNatRow(Array.isArray(natRules) ? natRules : []);
    const natId = targetRow?.['.id'] || targetRow?.id;
    if (!targetRow || !natId) {
      throw new Error(
        'Rule NAT dengan komen "remot-onu" tidak ditemukan pada menu IP > Firewall > NAT MikroTik cabang ini.'
      );
    }

    await restRequest(branch, 'PATCH', `/ip/firewall/nat/${encodeURIComponent(natId)}`, {
      'to-addresses': cleanIp,
    });

    return mapNatRow({ ...targetRow, 'to-addresses': cleanIp });
  }

  return await withApiClient(branch, async (client) => {
    const natRules = await client.command(['/ip/firewall/nat/print']);
    const targetRow = findRemoteOnuNatRow(natRules);
    const natId = targetRow?.['.id'] || targetRow?.id;
    if (!targetRow || !natId) {
      throw new Error(
        'Rule NAT dengan komen "remot-onu" tidak ditemukan pada menu IP > Firewall > NAT MikroTik cabang ini.'
      );
    }

    await client.command([
      '/ip/firewall/nat/set',
      `=.id=${natId}`,
      `=to-addresses=${cleanIp}`,
    ]);

    return mapNatRow({ ...targetRow, 'to-addresses': cleanIp });
  });
}
