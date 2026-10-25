/**
 * The panel's HTTP surface, mounted on the Harness Web server. Every route is
 * local-only: a loopback socket, a loopback Host header and a same-origin fetch
 * marker are all required, so a page opened from another origin (or a LAN
 * client) cannot spend the user's model quota or read their videos.
 */
import { createReadStream } from 'node:fs';
import { ProviderError } from './http.js';
import { providerById } from './providers.js';

const PREFIX = '/api/video-studio';
const BODY_LIMIT = 2 * 1024 * 1024;

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false;
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return isLoopbackAddress(normalized.slice(7));
  return /^127\./u.test(normalized);
}

function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader === '') return true;
  try {
    const { hostname } = new URL(`http://${hostHeader}`);
    return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./u.test(hostname);
  } catch {
    return false;
  }
}

/** Loopback socket + loopback Host + same-origin fetch marker. */
function allows(request) {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false;
  if (!isLoopbackHost(request.headers.host)) return false;
  const site = request.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function mediaType(fileName) {
  const name = String(fileName ?? '').toLowerCase();
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.mkv')) return 'video/x-matroska';
  return 'video/mp4';
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new ProviderError('请求体过大', { code: 'body-too-large' });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw new ProviderError('请求体不是合法 JSON', { code: 'invalid-json' });
  }
}

function statusFor(error) {
  if (error instanceof ProviderError) {
    if (error.code === 'missing-credential') return 400;
    if (error.code === 'unknown-job') return 404;
    return 400;
  }
  return 500;
}

/**
 * Build the route table.
 * @param {{ studio: import('./studio.js').VideoStudio, setKey: (ref: string, value: string) => Promise<void>, unsetKey: (ref: string) => Promise<void>, credentialsAvailable: () => boolean }} deps
 * @returns {Array<{ kind: 'exact', path: string, handler: (req: any, res: any) => Promise<void> }>}
 */
export function makeRoutes(deps) {
  const { studio, setKey, unsetKey, credentialsAvailable } = deps;

  const guard = (request, response, method) => {
    if (!allows(request)) {
      sendJson(response, 403, { error: '仅允许本机同源访问' });
      return false;
    }
    if (request.method !== method) {
      sendJson(response, 405, { error: `不支持 ${request.method}，请用 ${method}` });
      return false;
    }
    return true;
  };

  const handler = (method, run) => async (request, response) => {
    if (!guard(request, response, method)) return;
    try {
      const value = await run(request, response);
      if (value !== undefined) sendJson(response, 200, value);
    } catch (error) {
      const message = error?.message ?? String(error);
      sendJson(response, statusFor(error), { error: message, code: error?.code ?? 'error' });
    }
  };

  const state = handler('GET', async () => studio.publicState());

  const settings = handler('POST', async (request) => {
    const body = await readJsonBody(request);
    const patch = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const apiKeys = body.apiKeys && typeof body.apiKeys === 'object' ? body.apiKeys : {};
    const clearKeys = Array.isArray(body.clearKeys) ? body.clearKeys : [];
    const touchesSecrets = Object.keys(apiKeys).length > 0 || clearKeys.length > 0;
    if (touchesSecrets && !credentialsAvailable()) {
      throw new ProviderError('当前组合没有可用的凭据服务，请改用环境变量配置密钥', { code: 'no-credentials' });
    }
    return studio.updateSettings(patch, async () => {
      for (const [id, value] of Object.entries(apiKeys)) {
        const provider = providerById(id);
        if (!provider || typeof value !== 'string' || value.trim() === '') continue;
        await setKey(provider.keyRef, value.trim());
      }
      for (const id of clearKeys) {
        const provider = providerById(id);
        if (provider) await unsetKey(provider.keyRef);
      }
    });
  });

  const generate = handler('POST', async (request) => {
    const body = await readJsonBody(request);
    return studio.start(body, { source: 'panel' });
  });

  const cancel = handler('POST', async (request) => {
    const body = await readJsonBody(request);
    if (typeof body.id !== 'string' || body.id === '') {
      throw new ProviderError('缺少任务 id', { code: 'missing-id' });
    }
    return studio.cancel(body.id);
  });

  const remove = handler('POST', async (request) => {
    const body = await readJsonBody(request);
    if (typeof body.id !== 'string' || body.id === '') {
      throw new ProviderError('缺少任务 id', { code: 'missing-id' });
    }
    return studio.remove(body.id, { deleteFile: body.deleteFile !== false });
  });

  const media = async (request, response) => {
    if (!guard(request, response, 'GET')) return;
    const url = new URL(request.url ?? '/', 'http://localhost');
    const id = url.searchParams.get('id') ?? '';
    const entry = await studio.mediaFile(id);
    if (!entry) {
      sendJson(response, 404, { error: '没有可播放的视频文件（任务未完成或文件已删除）' });
      return;
    }
    const headers = {
      'content-type': mediaType(entry.fileName),
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
    };
    const range = request.headers.range;
    const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/u.exec(range.trim()) : null;
    if (match) {
      const start = match[1] === '' ? Math.max(0, entry.size - Number(match[2] || 0)) : Number(match[1]);
      const end = match[1] === '' || match[2] === '' ? entry.size - 1 : Math.min(entry.size - 1, Number(match[2]));
      if (!Number.isFinite(start) || start >= entry.size || end < start) {
        response.writeHead(416, { 'content-range': `bytes */${entry.size}` });
        response.end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${entry.size}`,
        'content-length': end - start + 1,
      });
      createReadStream(entry.path, { start, end }).on('error', () => response.destroy()).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, 'content-length': entry.size });
    createReadStream(entry.path).on('error', () => response.destroy()).pipe(response);
  };

  return [
    { kind: 'exact', path: `${PREFIX}/state`, handler: state },
    { kind: 'exact', path: `${PREFIX}/settings`, handler: settings },
    { kind: 'exact', path: `${PREFIX}/generate`, handler: generate },
    { kind: 'exact', path: `${PREFIX}/cancel`, handler: cancel },
    { kind: 'exact', path: `${PREFIX}/remove`, handler: remove },
    { kind: 'exact', path: `${PREFIX}/media`, handler: media },
  ];
}
