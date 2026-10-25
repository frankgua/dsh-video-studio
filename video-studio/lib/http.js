/**
 * Shared HTTP plumbing for the video providers: one failure type, one JSON
 * request helper, one binary download helper. Every provider reports a remote
 * error through the same `ProviderError` so the panel and the tools can show
 * the provider's own message instead of a transport stack.
 */

export class ProviderError extends Error {
  /**
   * @param {string} message - human-readable reason.
   * @param {{ code?: string, status?: number, detail?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code ?? 'provider-error';
    this.status = options.status;
    this.detail = options.detail;
  }
}

/** Trim a trailing slash so `${base}/path` never doubles a separator. */
export function trimBase(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/u, '');
}

/** Pull the most useful message out of the provider-specific error envelopes. */
export function pickErrorMessage(json, fallback) {
  if (json && typeof json === 'object') {
    const candidates = [
      json.error?.message,
      typeof json.error === 'string' ? json.error : undefined,
      json.output?.message,
      json.message,
      json.detail,
      json.base_resp?.status_msg,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
    }
    if (typeof json.error === 'object' && json.error !== null && typeof json.error.code === 'string') {
      return json.error.code;
    }
  }
  return fallback;
}

/**
 * One JSON request with a hard timeout that also honours the caller's
 * cancellation signal.
 * @param {string} url - absolute request URL.
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown, signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, headers: Headers, json: any, text: string }>}
 */
export async function requestJson(url, options = {}) {
  const { method = 'GET', headers = {}, body, signal, timeoutMs = 60000 } = options;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new ProviderError('已取消', { code: 'aborted' });
    signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = body === undefined
      ? undefined
      : typeof body === 'string' || body instanceof Uint8Array
        ? body
        : JSON.stringify(body);
    const response = await fetch(url, {
      method,
      headers: payload !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      throw new ProviderError(pickErrorMessage(json, text.slice(0, 400) || `${response.status} ${response.statusText}`), {
        status: response.status,
        detail: json ?? text.slice(0, 400),
      });
    }
    return { status: response.status, headers: response.headers, json, text };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw signal?.aborted
        ? new ProviderError('任务已取消', { code: 'aborted' })
        : new ProviderError('请求超时', { code: 'timeout' });
    }
    throw new ProviderError(`网络请求失败：${error?.message ?? String(error)}`, { code: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Download a produced video.
 * @param {string} url - provider CDN URL or authenticated content endpoint.
 * @param {{ headers?: Record<string, string>, signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
export async function requestBytes(url, options = {}) {
  const { headers = {}, signal, timeoutMs = 300000 } = options;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new ProviderError('已取消', { code: 'aborted' });
    signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError(pickErrorMessage(undefined, text.slice(0, 300) || `下载失败：${response.status}`), {
        status: response.status,
        code: 'download',
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new ProviderError('接口返回了空视频文件', { code: 'download' });
    return { bytes, contentType: response.headers.get('content-type') ?? '' };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw signal?.aborted
        ? new ProviderError('任务已取消', { code: 'aborted' })
        : new ProviderError('下载超时', { code: 'timeout' });
    }
    throw new ProviderError(`下载失败：${error?.message ?? String(error)}`, { code: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
