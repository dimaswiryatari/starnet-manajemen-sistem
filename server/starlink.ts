import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';

// gRPC frame containing SpaceX.API.Device.Request { reboot: RebootRequest {} }
// Protobuf field 1001 (reboot), wire type 2 (length-delimited), length 0 -> bytes [0xca, 0x3e, 0x00]
// 5-byte gRPC / gRPC-Web header: flags=0x00, length=3 (big-endian uint32)
const STARLINK_GRPC_REBOOT_FRAME = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x03, 0xca, 0x3e, 0x00,
]);

// gRPC frame containing SpaceX.API.Device.Request { get_status: GetStatusRequest {} }
// Protobuf field 1004 (get_status), wire type 2 (length-delimited), length 0 -> bytes [0xe2, 0x3e, 0x00]
const STARLINK_GRPC_STATUS_FRAME = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x03, 0xe2, 0x3e, 0x00,
]);

export type StarlinkProtocolMode = 'grpc-http2' | 'grpc-web' | 'web-ui-only' | 'sandbox';

export interface StarlinkRebootResult {
  ok: boolean;
  mode: 'grpc-http2' | 'grpc-web' | 'sandbox';
  message: string;
}

export type StarlinkDishState =
  | 'CONNECTED'
  | 'SEARCHING'
  | 'BOOTING'
  | 'OFFLINE'
  | 'WEB_UI_ONLY'
  | 'UNKNOWN';

export interface StarlinkTestResult {
  reachable: boolean;
  grpcReady: boolean;
  online: boolean;
  dishState: StarlinkDishState;
  statusLabel: string;
  uptimeSeconds: number | null;
  uptimeFormatted: string | null;
  mode: StarlinkProtocolMode;
  message: string;
}

export interface StarlinkLiveStatus {
  id: number;
  online: boolean;
  reachable: boolean;
  grpcReady: boolean;
  dishState: StarlinkDishState;
  statusLabel: string;
  uptimeSeconds: number | null;
  uptimeFormatted: string | null;
  mode: StarlinkProtocolMode;
  error: string | null;
  checkedAt: string;
}

interface RawStarlinkResponse {
  transport: 'http2-grpc' | 'http1-grpc-web';
  status: number;
  contentType: string;
  grpcStatus: string | undefined;
  grpcMessage: string | undefined;
  body: Buffer;
}

export function formatStarlinkUptime(totalSeconds: number | null | undefined): string | null {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return null;
  }
  const whole = Math.floor(totalSeconds);
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;

  if (days > 0) {
    return `${days} hari ${hours} jam ${minutes} mnt`;
  }
  if (hours > 0) {
    return `${hours} jam ${minutes} mnt ${seconds} dtk`;
  }
  if (minutes > 0) {
    return `${minutes} mnt ${seconds} dtk`;
  }
  return `${seconds} dtk`;
}

function readVarint(buf: Buffer, start: number): { value: bigint; nextOffset: number } | null {
  let result = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < buf.length && offset - start < 10) {
    const byte = BigInt(buf[offset]);
    offset += 1;
    result |= (byte & 0x7fn) << shift;
    if ((byte & 0x80n) === 0n) {
      return { value: result, nextOffset: offset };
    }
    shift += 7n;
  }
  return null;
}

function iterateProtobufFields(
  buf: Buffer,
  onField: (fieldNumber: number, wireType: number, varintVal: bigint | null, bytesVal: Buffer | null) => void
): void {
  let offset = 0;
  while (offset < buf.length) {
    const tagRes = readVarint(buf, offset);
    if (!tagRes) break;
    offset = tagRes.nextOffset;
    const tagNum = Number(tagRes.value);
    const fieldNumber = tagNum >>> 3;
    const wireType = tagNum & 0x07;
    if (fieldNumber <= 0) break;

    if (wireType === 0) {
      const valRes = readVarint(buf, offset);
      if (!valRes) break;
      offset = valRes.nextOffset;
      onField(fieldNumber, wireType, valRes.value, null);
    } else if (wireType === 1) {
      if (offset + 8 > buf.length) break;
      offset += 8;
      onField(fieldNumber, wireType, null, null);
    } else if (wireType === 2) {
      const lenRes = readVarint(buf, offset);
      if (!lenRes) break;
      offset = lenRes.nextOffset;
      const len = Number(lenRes.value);
      if (!Number.isFinite(len) || len < 0 || offset + len > buf.length) break;
      const slice = buf.subarray(offset, offset + len);
      offset += len;
      onField(fieldNumber, wireType, null, slice);
    } else if (wireType === 5) {
      if (offset + 4 > buf.length) break;
      offset += 4;
      onField(fieldNumber, wireType, null, null);
    } else {
      break;
    }
  }
}

function parseDeviceStateUptime(buf: Buffer): number | null {
  let uptimeSeconds: number | null = null;
  iterateProtobufFields(buf, (fieldNumber, wireType, varintVal) => {
    if (fieldNumber === 1 && wireType === 0 && varintVal !== null) {
      const num = Number(varintVal);
      if (Number.isFinite(num) && num >= 0) {
        uptimeSeconds = num;
      }
    }
  });
  return uptimeSeconds;
}

function parseStarlinkStatusPayload(rawBody: Buffer): {
  uptimeSeconds: number | null;
  dishStateCode: number | null;
  grpcWebStatus?: string;
  grpcWebMessage?: string;
} {
  const frames: Buffer[] = [];
  let grpcWebStatus: string | undefined;
  let grpcWebMessage: string | undefined;

  // Parse standard 5-byte gRPC / gRPC-Web length-prefixed frames
  let pos = 0;
  let parsedAnyFrame = false;
  while (pos + 5 <= rawBody.length) {
    const flags = rawBody[pos];
    const frameLen = rawBody.readUInt32BE(pos + 1);
    if (pos + 5 + frameLen > rawBody.length) {
      break;
    }
    const payload = rawBody.subarray(pos + 5, pos + 5 + frameLen);
    pos += 5 + frameLen;
    parsedAnyFrame = true;

    if (flags === 0x00) {
      frames.push(payload);
    } else if ((flags & 0x80) !== 0) {
      const trailerText = payload.toString('utf8');
      for (const line of trailerText.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        const val = line.slice(idx + 1).trim();
        if (key === 'grpc-status') grpcWebStatus = val;
        if (key === 'grpc-message') grpcWebMessage = val;
      }
    }
  }

  if (!parsedAnyFrame && rawBody.length > 0) {
    frames.push(rawBody);
  }

  let uptimeSeconds: number | null = null;
  let dishStateCode: number | null = null;

  for (const frameBuf of frames) {
    iterateProtobufFields(frameBuf, (fieldNumber, wireType, _varintVal, bytesVal) => {
      if (wireType !== 2 || !bytesVal) return;

      // SpaceX.API.Device.Response.dish_get_status = 2004
      if (fieldNumber === 2004) {
        iterateProtobufFields(bytesVal, (subField, subWire, subVarint, subBytes) => {
          if (subField === 2 && subWire === 2 && subBytes) {
            const parsed = parseDeviceStateUptime(subBytes);
            if (parsed !== null) uptimeSeconds = parsed;
          } else if (subField === 1006 && subWire === 0 && subVarint !== null) {
            dishStateCode = Number(subVarint);
          }
        });
      }

      // SpaceX.API.Device.Response.wifi_get_status = 3001 (fallback if pointing to Starlink router)
      if (fieldNumber === 3001 && uptimeSeconds === null) {
        iterateProtobufFields(bytesVal, (subField, subWire, _subVarint, subBytes) => {
          if ((subField === 4 || subField === 2) && subWire === 2 && subBytes && uptimeSeconds === null) {
            const parsed = parseDeviceStateUptime(subBytes);
            if (parsed !== null) uptimeSeconds = parsed;
          }
        });
      }
    });
  }

  return { uptimeSeconds, dishStateCode, grpcWebStatus, grpcWebMessage };
}

function mapDishState(dishStateCode: number | null): {
  online: boolean;
  dishState: StarlinkDishState;
  statusLabel: string;
} {
  if (dishStateCode === 2) {
    return { online: false, dishState: 'SEARCHING', statusLabel: 'Mencari Satelit' };
  }
  if (dishStateCode === 3) {
    return { online: false, dishState: 'BOOTING', statusLabel: 'Booting' };
  }
  // State 1 = CONNECTED, atau pada firmware baru field legacy 1006 dihilangkan namun gRPC get_status merespon sukses
  return { online: true, dishState: 'CONNECTED', statusLabel: 'Online' };
}

class ProtocolMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolMismatchError';
  }
}

function isPrivateIp(hostname: string): boolean {
  if (!net.isIPv4(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function buildNetworkErrorMessage(
  cleanBase: string,
  hostname: string,
  reason: string,
  isTimeout: boolean
): string {
  const hints: string[] = [
    'Pastikan di MikroTik terdapat rule NAT srcnat/masquerade ke 192.168.100.1 (chain=srcnat dst-address=192.168.100.1 action=masquerade) dan IP subnet 192.168.100.x di interface Starlink.',
  ];
  if (isPrivateIp(hostname)) {
    hints.push(
      `Alamat ${hostname} merupakan IP privat/VPN; pastikan server aplikasi ini berada pada jaringan/tunnel yang sama atau gunakan IP Publik/DDNS/Tunnel.`
    );
  }
  const prefix = isTimeout
    ? `Timeout menghubungi remote Starlink (${cleanBase})`
    : `Gagal menghubungi remote Starlink (${cleanBase}): ${reason}`;
  return `${prefix}. ${hints.join(' ')}`;
}

async function sendStarlinkHttp2Grpc(
  parsed: URL,
  frame: Buffer,
  timeoutMs = 6500
): Promise<RawStarlinkResponse> {
  const cleanBase = parsed.toString().replace(/\/+$/, '');
  const basePath = parsed.pathname.replace(/\/+$/, '');
  const rpcPath = `${basePath}/SpaceX.API.Device.Device/Handle`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let status = 500;
    let contentType = '';
    let grpcStatus: string | undefined;
    let grpcMessage: string | undefined;
    const chunks: Buffer[] = [];

    const client = http2.connect(parsed.origin, {
      rejectUnauthorized: false,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch {
        // ignore
      }
      reject(
        new Error(
          buildNetworkErrorMessage(cleanBase, parsed.hostname, 'Koneksi timeout', true)
        )
      );
    }, timeoutMs);

    const finishError = (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.destroy();
      } catch {
        // ignore
      }
      const code = err.code || '';
      const msg = err.message || '';
      const looksLikeHttp1OrProtocol =
        code.startsWith('ERR_HTTP2') ||
        code === 'EPROTO' ||
        code === 'ECONNRESET' ||
        /http\/1|http2|frame|protocol|goaway|alpn|reset/i.test(msg);

      if (looksLikeHttp1OrProtocol) {
        reject(new ProtocolMismatchError(msg || code));
        return;
      }

      reject(
        new Error(
          buildNetworkErrorMessage(cleanBase, parsed.hostname, msg || code || 'Error jaringan', false)
        )
      );
    };

    client.on('error', finishError);

    client.on('connect', () => {
      // Wait for first response; if HTTP/1.1 server replies with plain HTTP, client emits error
    });

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request({
        ':method': 'POST',
        ':path': rpcPath,
        'content-type': 'application/grpc',
        te: 'trailers',
        'user-agent': 'starnet-starlink-grpc/1.0',
      });
    } catch (err) {
      finishError(err instanceof Error ? err : new Error('Gagal membuka stream HTTP/2'));
      return;
    }

    req.on('error', finishError);

    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 500);
      contentType = String(headers['content-type'] || '').toLowerCase();
      if (headers['grpc-status'] !== undefined) {
        grpcStatus = String(headers['grpc-status']);
      }
      if (headers['grpc-message'] !== undefined) {
        grpcMessage = String(headers['grpc-message']);
      }
    });

    req.on('trailers', (trailers) => {
      if (trailers['grpc-status'] !== undefined) {
        grpcStatus = String(trailers['grpc-status']);
      }
      if (trailers['grpc-message'] !== undefined) {
        grpcMessage = String(trailers['grpc-message']);
      }
    });

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        // ignore
      }
      resolve({
        transport: 'http2-grpc',
        status,
        contentType,
        grpcStatus,
        grpcMessage,
        body: Buffer.concat(chunks),
      });
    });

    req.write(frame);
    req.end();
  });
}

async function sendStarlinkHttp1GrpcWeb(
  parsed: URL,
  frame: Buffer,
  timeoutMs = 7000
): Promise<RawStarlinkResponse> {
  const cleanBase = parsed.toString().replace(/\/+$/, '');
  const basePath = parsed.pathname.replace(/\/+$/, '');
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port,
        path: `${basePath}/SpaceX.API.Device.Device/Handle${parsed.search}`,
        method: 'POST',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/grpc-web+proto',
          'X-Grpc-Web': '1',
          Accept: 'application/grpc-web+proto',
          'Content-Length': frame.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 500;
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          const rawGrpcStatus = res.headers['grpc-status'];
          const rawGrpcMsg = res.headers['grpc-message'];
          resolve({
            transport: 'http1-grpc-web',
            status,
            contentType,
            grpcStatus: rawGrpcStatus !== undefined ? String(rawGrpcStatus) : undefined,
            grpcMessage: rawGrpcMsg !== undefined ? String(rawGrpcMsg) : undefined,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(
        new Error(
          buildNetworkErrorMessage(cleanBase, parsed.hostname, 'Koneksi timeout', true)
        )
      );
    });

    req.on('error', (err) => {
      reject(
        new Error(
          buildNetworkErrorMessage(cleanBase, parsed.hostname, err.message, false)
        )
      );
    });

    req.write(frame);
    req.end();
  });
}

async function sendStarlinkFrame(
  remoteUrl: string,
  frame: Buffer,
  timeoutMs = 6500
): Promise<RawStarlinkResponse> {
  const cleanBase = remoteUrl.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(cleanBase);
  } catch {
    throw new Error('Alamat remote Starlink tidak valid.');
  }

  // Starlink port 9200 menggunakan native gRPC HTTP/2 (h2c),
  // sedangkan port 9201 menggunakan gRPC-Web HTTP/1.1.
  // Coba HTTP/2 gRPC terlebih dahulu, lalu otomatis fallback ke HTTP/1.1 gRPC-Web.
  try {
    return await sendStarlinkHttp2Grpc(parsed, frame, timeoutMs);
  } catch (err) {
    if (err instanceof ProtocolMismatchError) {
      return await sendStarlinkHttp1GrpcWeb(parsed, frame, timeoutMs);
    }
    throw err;
  }
}

function isHtmlPort80Response(contentType: string, body: Buffer): boolean {
  if (contentType.includes('text/html')) return true;
  const head = body.subarray(0, 64).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function computeSandboxUptimeSeconds(lastRebootAt?: string | null, createdAt?: string | null): number {
  const now = Date.now();
  if (lastRebootAt) {
    const rebootMs = Date.parse(lastRebootAt);
    if (!Number.isNaN(rebootMs)) {
      return Math.max(12, Math.floor((now - rebootMs) / 1000));
    }
  }
  if (createdAt) {
    const createdMs = Date.parse(createdAt);
    if (!Number.isNaN(createdMs)) {
      // Tambahkan offset dasar agar perangkat sandbox tampak sudah berjalan beberapa hari
      return Math.max(3600, Math.floor((now - createdMs) / 1000) + 4 * 86400 + 7 * 3600 + 1840);
    }
  }
  return 4 * 86400 + 7 * 3600 + 1840;
}

export async function testStarlinkViaRemote(
  remoteUrl: string,
  isSandbox: boolean,
  options?: { lastRebootAt?: string | null; createdAt?: string | null }
): Promise<StarlinkTestResult> {
  if (isSandbox) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    const uptimeSeconds = computeSandboxUptimeSeconds(options?.lastRebootAt, options?.createdAt);
    return {
      reachable: true,
      grpcReady: true,
      online: true,
      dishState: 'CONNECTED',
      statusLabel: 'Online',
      uptimeSeconds,
      uptimeFormatted: formatStarlinkUptime(uptimeSeconds),
      mode: 'sandbox',
      message: 'Starlink merespon dan siap untuk perintah reboot.',
    };
  }

  const res = await sendStarlinkFrame(remoteUrl, STARLINK_GRPC_STATUS_FRAME);

  if (isHtmlPort80Response(res.contentType, res.body) || res.status === 404 || res.status === 405) {
    return {
      reachable: true,
      grpcReady: false,
      online: false,
      dishState: 'WEB_UI_ONLY',
      statusLabel: 'Port Web UI (Bukan gRPC)',
      uptimeSeconds: null,
      uptimeFormatted: null,
      mode: 'web-ui-only',
      message:
        'Remote masih terhubung ke Web UI Starlink (port 80), bukan port kontrol gRPC (9200 / 9201). Pastikan To Ports pada MikroTik dst-nat ke 192.168.100.1 mengarah ke 9200 (gRPC HTTP/2) atau 9201 (gRPC-Web).',
    };
  }

  if (res.status >= 400) {
    throw new Error(
      `Remote Starlink merespons HTTP ${res.status}. Periksa kembali Dst. Port, rule dst-nat, dan rule srcnat masquerade ke 192.168.100.1 di MikroTik.`
    );
  }

  const parsedPayload = parseStarlinkStatusPayload(res.body);
  const effectiveGrpcStatus = res.grpcStatus ?? parsedPayload.grpcWebStatus;
  const effectiveGrpcMessage = res.grpcMessage ?? parsedPayload.grpcWebMessage;

  if (effectiveGrpcStatus !== undefined && effectiveGrpcStatus !== '0') {
    const decodedMsg = effectiveGrpcMessage
      ? decodeURIComponent(effectiveGrpcMessage)
      : `gRPC status ${effectiveGrpcStatus}`;
    throw new Error(`Endpoint gRPC Starlink merespons error: ${decodedMsg}`);
  }

  const isGrpcContent =
    res.contentType.includes('application/grpc') || effectiveGrpcStatus !== undefined;

  if (!isGrpcContent) {
    return {
      reachable: true,
      grpcReady: false,
      online: false,
      dishState: 'WEB_UI_ONLY',
      statusLabel: 'Port Web UI (Bukan gRPC)',
      uptimeSeconds: null,
      uptimeFormatted: null,
      mode: 'web-ui-only',
      message:
        'Alamat remote merespons HTTP biasa, bukan gRPC Starlink. Pastikan To Ports pada NAT MikroTik mengarah ke 9200 (192.168.100.1:9200) atau 9201.',
    };
  }

  const detectedMode = res.transport === 'http2-grpc' ? 'grpc-http2' : 'grpc-web';
  const mappedState = mapDishState(parsedPayload.dishStateCode);

  return {
    reachable: true,
    grpcReady: true,
    online: mappedState.online,
    dishState: mappedState.dishState,
    statusLabel: mappedState.statusLabel,
    uptimeSeconds: parsedPayload.uptimeSeconds,
    uptimeFormatted: formatStarlinkUptime(parsedPayload.uptimeSeconds),
    mode: detectedMode,
    message: 'Starlink merespon dan siap untuk perintah reboot.',
  };
}

export async function getStarlinkStatusViaRemote(
  id: number,
  remoteUrl: string,
  isSandbox: boolean,
  options?: { lastRebootAt?: string | null; createdAt?: string | null }
): Promise<StarlinkLiveStatus> {
  const checkedAt = new Date().toISOString();

  if (isSandbox) {
    const uptimeSeconds = computeSandboxUptimeSeconds(options?.lastRebootAt, options?.createdAt);
    return {
      id,
      online: true,
      reachable: true,
      grpcReady: true,
      dishState: 'CONNECTED',
      statusLabel: 'Online',
      uptimeSeconds,
      uptimeFormatted: formatStarlinkUptime(uptimeSeconds),
      mode: 'sandbox',
      error: null,
      checkedAt,
    };
  }

  try {
    const res = await sendStarlinkFrame(remoteUrl, STARLINK_GRPC_STATUS_FRAME, 4500);

    if (isHtmlPort80Response(res.contentType, res.body) || res.status === 404 || res.status === 405) {
      return {
        id,
        online: false,
        reachable: true,
        grpcReady: false,
        dishState: 'WEB_UI_ONLY',
        statusLabel: 'Port Web UI (80)',
        uptimeSeconds: null,
        uptimeFormatted: null,
        mode: 'web-ui-only',
        error: 'Remote terhubung ke Web UI (port 80), bukan port gRPC 9200/9201.',
        checkedAt,
      };
    }

    if (res.status >= 400) {
      return {
        id,
        online: false,
        reachable: false,
        grpcReady: false,
        dishState: 'OFFLINE',
        statusLabel: 'Offline',
        uptimeSeconds: null,
        uptimeFormatted: null,
        mode: res.transport === 'http2-grpc' ? 'grpc-http2' : 'grpc-web',
        error: `HTTP ${res.status}`,
        checkedAt,
      };
    }

    const parsedPayload = parseStarlinkStatusPayload(res.body);
    const effectiveGrpcStatus = res.grpcStatus ?? parsedPayload.grpcWebStatus;
    const effectiveGrpcMessage = res.grpcMessage ?? parsedPayload.grpcWebMessage;

    if (effectiveGrpcStatus !== undefined && effectiveGrpcStatus !== '0') {
      const decodedMsg = effectiveGrpcMessage
        ? decodeURIComponent(effectiveGrpcMessage)
        : `gRPC status ${effectiveGrpcStatus}`;
      return {
        id,
        online: false,
        reachable: true,
        grpcReady: false,
        dishState: 'OFFLINE',
        statusLabel: 'Offline',
        uptimeSeconds: null,
        uptimeFormatted: null,
        mode: res.transport === 'http2-grpc' ? 'grpc-http2' : 'grpc-web',
        error: decodedMsg,
        checkedAt,
      };
    }

    const isGrpcContent =
      res.contentType.includes('application/grpc') || effectiveGrpcStatus !== undefined;

    if (!isGrpcContent) {
      return {
        id,
        online: false,
        reachable: true,
        grpcReady: false,
        dishState: 'WEB_UI_ONLY',
        statusLabel: 'Bukan Port gRPC',
        uptimeSeconds: null,
        uptimeFormatted: null,
        mode: 'web-ui-only',
        error: 'Respon bukan format gRPC Starlink.',
        checkedAt,
      };
    }

    const mappedState = mapDishState(parsedPayload.dishStateCode);
    return {
      id,
      online: mappedState.online,
      reachable: true,
      grpcReady: true,
      dishState: mappedState.dishState,
      statusLabel: mappedState.statusLabel,
      uptimeSeconds: parsedPayload.uptimeSeconds,
      uptimeFormatted: formatStarlinkUptime(parsedPayload.uptimeSeconds),
      mode: res.transport === 'http2-grpc' ? 'grpc-http2' : 'grpc-web',
      error: null,
      checkedAt,
    };
  } catch (err) {
    return {
      id,
      online: false,
      reachable: false,
      grpcReady: false,
      dishState: 'OFFLINE',
      statusLabel: 'Offline',
      uptimeSeconds: null,
      uptimeFormatted: null,
      mode: 'grpc-http2',
      error: err instanceof Error ? err.message : 'Tidak terjangkau',
      checkedAt,
    };
  }
}

export async function rebootStarlinkViaRemote(
  remoteUrl: string,
  isSandbox: boolean
): Promise<StarlinkRebootResult> {
  if (isSandbox) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      ok: true,
      mode: 'sandbox',
      message: 'Perintah reboot Starlink berhasil dikirim (Mode Lab Sandbox).',
    };
  }

  const res = await sendStarlinkFrame(remoteUrl, STARLINK_GRPC_REBOOT_FRAME);

  if (isHtmlPort80Response(res.contentType, res.body) || res.status === 404 || res.status === 405) {
    throw new Error(
      'Alamat remote terhubung ke Web UI Starlink (To Ports: 80), bukan port gRPC (9200 / 9201). Pastikan To Ports NAT di MikroTik mengarah ke 9200 (192.168.100.1:9200).'
    );
  }

  if (res.status >= 400) {
    const bodyText = res.body.toString('utf8').trim();
    throw new Error(
      `Perangkat remote merespons HTTP ${res.status}${bodyText ? ` (${bodyText.slice(0, 140)})` : ''}. Pastikan NAT mengarah ke 192.168.100.1:9200.`
    );
  }

  if (res.grpcStatus !== undefined && res.grpcStatus !== '0') {
    const decodedMsg = res.grpcMessage
      ? decodeURIComponent(res.grpcMessage)
      : `gRPC status ${res.grpcStatus}`;
    throw new Error(`Perintah reboot ditolak oleh Starlink: ${decodedMsg}`);
  }

  const isGrpcContent =
    res.contentType.includes('application/grpc') || res.grpcStatus !== undefined;

  if (!isGrpcContent) {
    throw new Error(
      'Respon dari alamat remote bukan format gRPC Starlink. Pastikan To Ports pada NAT MikroTik mengarah ke 9200 (192.168.100.1:9200) dan terdapat rule srcnat masquerade ke 192.168.100.1.'
    );
  }

  const mode = res.transport === 'http2-grpc' ? 'grpc-http2' : 'grpc-web';
  return {
    ok: true,
    mode,
    message: `Perintah reboot berhasil dikirim ke perangkat Starlink (${mode === 'grpc-http2' ? 'gRPC HTTP/2 port 9200' : 'gRPC-Web port 9201'}).`,
  };
}
