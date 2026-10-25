/**
 * Video-model adapters. Each adapter exposes the same small surface so the job
 * runner, the panel and the agent tools stay provider-agnostic:
 *
 *   create  - submit one generation, resolve a remote task id
 *   poll    - read task state, resolving to pending/running/succeeded/failed
 *   download- fetch the finished bytes (some need the API key, some a signed URL)
 *   cancel  - best-effort remote cancellation
 *
 * `settings` carries the per-provider base URL and model; `key` is the resolved
 * secret. Adapters never read configuration or environment themselves.
 */
import { ProviderError, requestBytes, requestJson, trimBase } from './http.js';

const RATIO_SIZES = {
  '16:9': { sora: '1280x720', dashscope: '1280*720' },
  '9:16': { sora: '720x1280', dashscope: '720*1280' },
  '1:1': { sora: '1280x720', dashscope: '1280*720' },
};

function authHeaders(key) {
  return { authorization: `Bearer ${key}` };
}

function requireKey(key, provider) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new ProviderError(`尚未配置 ${provider} 的 API Key`, { code: 'missing-credential' });
  }
  return key;
}

/**
 * Agnes Video (agnes-video-2.5 / agnes-video-2.5-flash).
 *
 * OpenAI Videos-compatible create (`POST /v1/videos`) but the task is read from
 * the account-level `GET /agnesapi?video_id=…&model_name=…` route, so the
 * polling URL is derived from the base URL's origin.
 */
export const agnesProvider = {
  id: 'agnes',
  label: { zh: 'Agnes Video（视频模型）', en: 'Agnes Video' },
  hint: {
    zh: 'Agnes 的 OpenAI Videos 兼容接口：文生视频（mode=text）、首帧控制（mode=keyframe）、参考图（mode=reference）。',
    en: 'Agnes OpenAI-Videos-compatible API: text, keyframe and reference modes.',
  },
  keyRef: 'AGNES_API_KEY',
  keyHint: { zh: 'Agnes 平台 API Key（sk- 开头）', en: 'Agnes platform API key' },
  defaults: { baseUrl: 'https://apihub.agnes-ai.com/v1', model: 'agnes-video-2.5-flash' },
  modelSuggestions: ['agnes-video-2.5-flash', 'agnes-video-2.5'],
  durations: [4, 5, 6, 8, 10, 12],
  ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  supportsImage: true,
  /** The status route is rate limited, so the poll gap grows as the render runs. */
  pollIntervalMs: 5000,
  pollBackoff: 1.8,
  maxPollIntervalMs: 20000,
  /** How long a full upstream queue may keep a job waiting to be submitted. */
  queueWaitMs: 10 * 60 * 1000,

  async create({ baseUrl, key, input, signal }) {
    const secret = requireKey(key, 'Agnes');
    const body = {
      model: input.model,
      prompt: input.prompt,
      mode: input.imageUrl ? 'keyframe' : 'text',
      seconds: String(Math.min(12, Math.max(4, Math.round(input.duration || 5)))),
      size: '720P',
      aspect_ratio: input.aspectRatio || '16:9',
      n: 1,
    };
    if (input.imageUrl) body.first_frame = input.imageUrl;
    if (Number.isFinite(input.seed)) body.seed = input.seed;
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;

    // A busy queue answers 503 video_queue_full. The job runner keeps the task
    // in "queued" and retries the submission for `queueWaitMs`, so the user sees
    // a waiting task instead of an instant failure.
    let response;
    try {
      response = await requestJson(`${trimBase(baseUrl)}/videos`, {
        method: 'POST',
        headers: authHeaders(secret),
        body,
        signal,
      });
    } catch (error) {
      if (error?.status === 403 && error?.detail?.code === 'insufficient_user_quota') {
        throw new ProviderError(
          'Agnes 账户余额不足：agnes-video-2.5 按秒计费，当前余额为 0；可改用限时免费的 agnes-video-2.5-flash',
          { code: 'insufficient-quota', status: 403, detail: error.detail },
        );
      }
      if (error?.status === 503 || error?.detail?.code === 'video_queue_full') {
        throw new ProviderError('Agnes 免费视频队列已满（上游容量限制）', {
          code: 'queue-full',
          detail: error.detail,
        });
      }
      throw error;
    }
    const id = response.json?.video_id ?? response.json?.id ?? response.json?.task_id;
    if (typeof id !== 'string' || id === '') {
      throw new ProviderError('Agnes 没有返回 video_id', { detail: response.json });
    }
    return { id, model: input.model };
  },

  async poll({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Agnes');
    const origin = new URL(trimBase(baseUrl)).origin;
    const query = new URLSearchParams({ video_id: remote.id, model_name: remote.model });
    let response;
    try {
      response = await requestJson(`${origin}/agnesapi?${query.toString()}`, {
        headers: authHeaders(secret),
        signal,
      });
    } catch (error) {
      // Status queries are rate limited per account; that is not a failed render.
      if (error?.status === 429 || /too many video status queries/iu.test(error?.message ?? '')) {
        return { state: 'running', retryAfterMs: 25000 };
      }
      throw error;
    }
    const payload = response.json ?? {};
    const status = String(payload.status ?? '').toLowerCase();
    const progress = Number.isFinite(payload.progress) ? Math.round(payload.progress) : undefined;
    if (status === 'completed' || status === 'succeeded') {
      const url = payload.url ?? payload.output?.url;
      if (typeof url !== 'string' || url === '') {
        return { state: 'failed', error: '任务完成但没有返回视频地址' };
      }
      return { state: 'succeeded', progress: 100, url };
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      const reason = typeof payload.error === 'string' ? payload.error : payload.error?.message;
      return { state: 'failed', error: reason ?? '视频生成失败' };
    }
    return {
      state: status === 'queued' || status === 'pending' || status === 'submitted' ? 'pending' : 'running',
      progress,
    };
  },

  async download({ url, signal }) {
    return requestBytes(url, { signal });
  },
};

/** OpenAI Sora (/v1/videos) and any relay that mirrors that shape. */
export const soraProvider = {
  id: 'sora',
  label: { zh: 'OpenAI Sora（兼容接口）', en: 'OpenAI Sora (compatible)' },
  hint: {
    zh: '走 OpenAI /v1/videos 协议，也能接入同协议的第三方中转服务。',
    en: 'Uses the OpenAI /v1/videos protocol, including compatible relays.',
  },
  keyRef: 'DSH_VIDEO_SORA_API_KEY',
  keyHint: { zh: 'sk- 开头的 OpenAI 或中转服务密钥', en: 'OpenAI or relay key' },
  defaults: { baseUrl: 'https://api.openai.com/v1', model: 'sora-2' },
  modelSuggestions: ['sora-2', 'sora-2-pro'],
  durations: [4, 8, 12],
  ratios: ['16:9', '9:16'],
  supportsImage: false,

  async create({ baseUrl, key, input, signal }) {
    const secret = requireKey(key, 'Sora');
    const size = RATIO_SIZES[input.aspectRatio]?.sora ?? RATIO_SIZES['16:9'].sora;
    const body = {
      model: input.model,
      prompt: input.prompt,
      seconds: String(input.duration),
      size,
    };
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    const response = await requestJson(`${trimBase(baseUrl)}/videos`, {
      method: 'POST',
      headers: authHeaders(secret),
      body,
      signal,
    });
    const id = response.json?.id;
    if (typeof id !== 'string' || id === '') {
      throw new ProviderError('接口没有返回视频任务 id', { detail: response.json });
    }
    return { id };
  },

  async poll({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Sora');
    const response = await requestJson(`${trimBase(baseUrl)}/videos/${encodeURIComponent(remote.id)}`, {
      headers: authHeaders(secret),
      signal,
    });
    const status = String(response.json?.status ?? '').toLowerCase();
    const progress = Number.isFinite(response.json?.progress) ? Math.round(response.json.progress) : undefined;
    if (status === 'completed' || status === 'succeeded') {
      return { state: 'succeeded', progress: 100, url: `${trimBase(baseUrl)}/videos/${encodeURIComponent(remote.id)}/content` };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      return { state: 'failed', error: response.json?.error?.message ?? '视频生成失败' };
    }
    return { state: status === 'queued' || status === 'pending' ? 'pending' : 'running', progress };
  },

  async download({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Sora');
    const url = `${trimBase(baseUrl)}/videos/${encodeURIComponent(remote.id)}/content`;
    return requestBytes(url, { headers: authHeaders(secret), signal });
  },

  async cancel({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Sora');
    await requestJson(`${trimBase(baseUrl)}/videos/${encodeURIComponent(remote.id)}`, {
      method: 'DELETE',
      headers: authHeaders(secret),
      signal,
      timeoutMs: 15000,
    }).catch(() => undefined);
  },
};

/** Alibaba Cloud DashScope: 通义万相 text-to-video / image-to-video (async task API). */
export const dashscopeProvider = {
  id: 'dashscope',
  label: { zh: '阿里云百炼 · 通义万相', en: 'Alibaba DashScope · Wan' },
  hint: {
    zh: '百炼平台异步任务接口，支持文生视频与首帧图生视频（wan2.x / wanx2.1）。',
    en: 'DashScope async task API for Wan text-to-video and image-to-video.',
  },
  keyRef: 'DSH_VIDEO_DASHSCOPE_API_KEY',
  keyHint: { zh: '百炼控制台创建的 API Key（sk- 开头）', en: 'DashScope API key' },
  defaults: { baseUrl: 'https://dashscope.aliyuncs.com', model: 'wan2.2-t2v-plus' },
  modelSuggestions: [
    'wan2.5-t2v-preview',
    'wan2.2-t2v-plus',
    'wanx2.1-t2v-turbo',
    'wan2.2-i2v-plus',
    'wanx2.1-i2v-turbo',
  ],
  durations: [5, 10],
  ratios: ['16:9', '9:16'],
  supportsImage: true,

  /** An image first frame needs an i2v model; swap the documented twin. */
  modelFor(input) {
    const model = input.model || this.defaults.model;
    if (input.imageUrl && model.includes('t2v')) return model.replace('t2v', 'i2v');
    return model;
  },

  async create({ baseUrl, key, input, signal }) {
    const secret = requireKey(key, '百炼');
    const model = this.modelFor(input);
    const size = RATIO_SIZES[input.aspectRatio]?.dashscope ?? RATIO_SIZES['16:9'].dashscope;
    const parameters = { size, prompt_extend: true };
    // Wan 2.2 and later accept a duration; 2.1 is fixed at 5 seconds.
    if (/wan2\.[2-9]|wan2\.5|wan2\.6/u.test(model)) parameters.duration = input.duration;
    if (Number.isFinite(input.seed)) parameters.seed = input.seed;
    const body = {
      model,
      input: {
        prompt: input.prompt,
        ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
        ...(input.imageUrl ? { img_url: input.imageUrl } : {}),
      },
      parameters,
    };
    const response = await requestJson(
      `${trimBase(baseUrl)}/api/v1/services/aigc/video-generation/video-synthesis`,
      {
        method: 'POST',
        headers: { ...authHeaders(secret), 'X-DashScope-Async': 'enable' },
        body,
        signal,
      },
    );
    const id = response.json?.output?.task_id;
    if (typeof id !== 'string' || id === '') {
      throw new ProviderError('接口没有返回 task_id', { detail: response.json });
    }
    return { id, model };
  },

  async poll({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, '百炼');
    const response = await requestJson(`${trimBase(baseUrl)}/api/v1/tasks/${encodeURIComponent(remote.id)}`, {
      headers: authHeaders(secret),
      signal,
    });
    const output = response.json?.output ?? {};
    const status = String(output.task_status ?? '').toUpperCase();
    if (status === 'SUCCEEDED') {
      const url = output.video_url
        ?? output.results?.find?.((entry) => typeof entry?.url === 'string')?.url;
      if (typeof url !== 'string' || url === '') {
        return { state: 'failed', error: '任务完成但没有返回视频地址' };
      }
      return { state: 'succeeded', progress: 100, url };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return { state: 'failed', error: output.message ?? output.code ?? '视频生成失败' };
    }
    return { state: status === 'PENDING' ? 'pending' : 'running' };
  },

  async download({ key, url, signal }) {
    // The returned OSS URL is pre-signed, so no credentials are attached.
    return requestBytes(url, { signal });
  },
};

/** Replicate: one endpoint in front of many hosted video models. */
export const replicateProvider = {
  id: 'replicate',
  label: { zh: 'Replicate（聚合模型市场）', en: 'Replicate (model hub)' },
  hint: {
    zh: '通过 Replicate 调用 Veo、Kling、Wan、Hailuo 等托管视频模型，模型名写 owner/name。',
    en: 'Call hosted video models such as Veo, Kling, Wan or Hailuo; model is owner/name.',
  },
  keyRef: 'DSH_VIDEO_REPLICATE_API_TOKEN',
  keyHint: { zh: 'Replicate API Token（r8_ 开头）', en: 'Replicate API token' },
  defaults: { baseUrl: 'https://api.replicate.com/v1', model: 'minimax/video-01' },
  modelSuggestions: ['minimax/video-01', 'kwaivgi/kling-v2.1', 'google/veo-3', 'wan-video/wan-2.5-t2v'],
  durations: [],
  ratios: [],
  supportsImage: true,

  async create({ baseUrl, key, input, signal }) {
    const secret = requireKey(key, 'Replicate');
    const base = trimBase(baseUrl);
    const model = (input.model || this.defaults.model).trim();
    const payload = { prompt: input.prompt };
    // Model-specific input keys differ across the hub; the two below are the
    // common denominator, and a 422 surfaces the model's own rejection.
    if (input.imageUrl) payload.image = input.imageUrl;
    if (Number.isFinite(input.seed)) payload.seed = input.seed;
    const [name, version] = model.includes(':') ? model.split(':') : [model, undefined];
    const url = version
      ? `${base}/predictions`
      : `${base}/models/${name.split('/').map(encodeURIComponent).join('/')}/predictions`;
    const body = version ? { version, input: payload } : { input: payload };
    const response = await requestJson(url, { method: 'POST', headers: authHeaders(secret), body, signal });
    const id = response.json?.id;
    if (typeof id !== 'string' || id === '') {
      throw new ProviderError('Replicate 没有返回 prediction id', { detail: response.json });
    }
    return { id };
  },

  async poll({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Replicate');
    const response = await requestJson(`${trimBase(baseUrl)}/predictions/${encodeURIComponent(remote.id)}`, {
      headers: authHeaders(secret),
      signal,
    });
    const status = String(response.json?.status ?? '').toLowerCase();
    if (status === 'succeeded') {
      const output = response.json?.output;
      const url = Array.isArray(output)
        ? output.find((entry) => typeof entry === 'string')
        : typeof output === 'string' ? output : undefined;
      if (typeof url !== 'string' || url === '') {
        return { state: 'failed', error: '任务完成但没有返回视频地址' };
      }
      return { state: 'succeeded', progress: 100, url };
    }
    if (status === 'failed' || status === 'canceled') {
      return { state: 'failed', error: response.json?.error ?? 'Replicate 任务失败' };
    }
    return { state: status === 'starting' ? 'pending' : 'running' };
  },

  async download({ url, signal }) {
    return requestBytes(url, { signal });
  },

  async cancel({ baseUrl, key, remote, signal }) {
    const secret = requireKey(key, 'Replicate');
    await requestJson(`${trimBase(baseUrl)}/predictions/${encodeURIComponent(remote.id)}/cancel`, {
      method: 'POST',
      headers: authHeaders(secret),
      signal,
      timeoutMs: 15000,
    }).catch(() => undefined);
  },
};

export const PROVIDERS = [agnesProvider, soraProvider, dashscopeProvider, replicateProvider];

/** Look up one adapter by id. */
export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id);
}
