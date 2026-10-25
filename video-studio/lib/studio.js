/**
 * The generation service shared by both callers: the Web panel's HTTP routes
 * and the agent's tools. It owns the job journal, the polling loop, the saved
 * file and the failure text, so a job looks the same from either side.
 */
import { existsSync } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProviderError } from './http.js';
import { PROVIDERS, providerById } from './providers.js';

const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
const PROMPT_LIMIT = 4000;

function isTerminal(status) {
  return TERMINAL.has(status);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError('任务已取消', { code: 'aborted' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError('任务已取消', { code: 'aborted' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function extensionOf(contentType, url) {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('webm')) return 'webm';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('matroska')) return 'mkv';
  const match = /\.(mp4|m4v|webm|mov|mkv)(?:$|\?)/iu.exec(String(url ?? ''));
  return match ? match[1].toLowerCase() : 'mp4';
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export class VideoStudio {
  /**
   * @param {{
   *   store: import('./store.js').StudioStore,
   *   resolveKey: (ref: string) => Promise<string>,
   *   describeKey: (ref: string) => Promise<boolean>,
   *   defaultDirectory: () => string,
   *   logger?: { warn: (message: unknown) => void },
   * }} options
   */
  constructor(options) {
    this.store = options.store;
    this.resolveKey = options.resolveKey;
    this.describeKey = options.describeKey;
    this.defaultDirectory = options.defaultDirectory;
    this.logger = options.logger;
    /** @type {Map<string, any>} */
    this.jobs = new Map();
    this.controllers = new Map();
    this.settings = null;
  }

  async init() {
    this.settings = await this.store.loadSettings();
    const stored = await this.store.loadJobs();
    for (const job of stored) {
      if (!isTerminal(job.status)) {
        job.status = 'failed';
        job.error = '宿主重启，任务已中断（可在视频工作室重新提交）';
        job.errorCode = 'interrupted';
        job.finishedAt = job.finishedAt ?? new Date().toISOString();
      }
      this.jobs.set(job.id, job);
    }
    if (stored.length > 0) await this.persist();
    return this;
  }

  /** Serialize jobs: never expose the abort controller or provider payloads. */
  async persist() {
    const jobs = [...this.jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 200);
    await this.store.saveJobs(jobs).catch((error) => this.logger?.warn(`[video-studio] jobs not saved: ${error}`));
  }

  /**
   * Public projection of one job (what the panel and the tools read).
   * Absent values are omitted rather than set to `undefined`, because a tool
   * result must be lossless JSON.
   */
  view(job) {
    const view = {
      id: job.id,
      provider: job.provider,
      providerLabel: job.providerLabel,
      model: job.model,
      prompt: job.prompt,
      negativePrompt: job.negativePrompt ?? '',
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      imageUrl: job.imageUrl ?? '',
      seed: job.seed,
      status: job.status,
      progress: job.progress,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      remoteId: job.remoteId ?? null,
      file: job.file ?? null,
      fileName: job.file ? basename(job.file) : null,
      fileBytes: job.fileBytes ?? null,
      mediaUrl: job.file ? `/api/video-studio/media?id=${encodeURIComponent(job.id)}` : null,
      error: job.error ?? null,
      errorCode: job.errorCode ?? null,
    };
    for (const key of Object.keys(view)) {
      if (view[key] === undefined) delete view[key];
    }
    return view;
  }

  list(limit = 50) {
    return [...this.jobs.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(200, limit)))
      .map((job) => this.view(job));
  }

  get(id) {
    const job = this.jobs.get(id);
    return job ? this.view(job) : undefined;
  }

  rawJob(id) {
    return this.jobs.get(id);
  }

  /** Settings plus per-provider capability and credential state. */
  async publicState() {
    const providers = [];
    for (const provider of PROVIDERS) {
      const configured = await this.describeKey(provider.keyRef).catch(() => false);
      providers.push({
        id: provider.id,
        label: provider.label,
        hint: provider.hint,
        keyRef: provider.keyRef,
        keyHint: provider.keyHint,
        keyConfigured: configured,
        baseUrl: this.settings.providers[provider.id].baseUrl,
        model: this.settings.providers[provider.id].model,
        modelSuggestions: provider.modelSuggestions,
        durations: provider.durations,
        ratios: provider.ratios,
        supportsImage: provider.supportsImage,
      });
    }
    return {
      settings: {
        provider: this.settings.provider,
        outputDir: this.settings.outputDir,
        pollIntervalMs: this.settings.pollIntervalMs,
        maxWaitMinutes: this.settings.maxWaitMinutes,
        defaults: this.settings.defaults,
        providers: this.settings.providers,
      },
      providers,
      jobs: this.list(100),
    };
  }

  /** Apply a settings patch from the panel; `apiKeys`/`clearKeys` touch the secret store. */
  async updateSettings(patch, secrets) {
    const next = {
      ...this.settings,
      ...(typeof patch?.provider === 'string' ? { provider: patch.provider } : {}),
      ...(typeof patch?.outputDir === 'string' ? { outputDir: patch.outputDir } : {}),
      ...(patch?.pollIntervalMs !== undefined ? { pollIntervalMs: patch.pollIntervalMs } : {}),
      ...(patch?.maxWaitMinutes !== undefined ? { maxWaitMinutes: patch.maxWaitMinutes } : {}),
      ...(patch?.defaults && typeof patch.defaults === 'object' ? { defaults: { ...this.settings.defaults, ...patch.defaults } } : {}),
      providers: { ...this.settings.providers },
    };
    if (patch?.providers && typeof patch.providers === 'object') {
      for (const provider of PROVIDERS) {
        const entry = patch.providers[provider.id];
        if (!entry || typeof entry !== 'object') continue;
        next.providers[provider.id] = {
          baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl.trim() !== ''
            ? entry.baseUrl.trim()
            : next.providers[provider.id].baseUrl,
          model: typeof entry.model === 'string' && entry.model.trim() !== ''
            ? entry.model.trim()
            : next.providers[provider.id].model,
        };
      }
    }
    this.settings = await this.store.saveSettings(next);
    await secrets?.();
    return this.publicState();
  }

  /** Validate one request into a job record, then run it in the background. */
  async start(input, options = {}) {
    if (!this.settings) throw new ProviderError('视频工作室尚未初始化', { code: 'not-ready' });
    const provider = providerById(input?.provider ?? this.settings.provider);
    if (!provider) throw new ProviderError(`未知的视频提供方：${input?.provider ?? ''}`, { code: 'unknown-provider' });
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (prompt === '') throw new ProviderError('请填写视频描述（prompt）', { code: 'missing-prompt' });
    if (prompt.length > PROMPT_LIMIT) {
      throw new ProviderError(`视频描述不能超过 ${PROMPT_LIMIT} 个字符`, { code: 'prompt-too-long' });
    }
    const configured = this.settings.providers[provider.id];
    const requestedModel = typeof input?.model === 'string' ? input.model.trim() : '';
    const model = requestedModel || configured.model;
    if (model === '') throw new ProviderError('请先填写模型名', { code: 'missing-model' });

    let duration = 0;
    if (provider.durations.length > 0) {
      const requested = Number(input?.duration);
      duration = provider.durations.includes(requested)
        ? requested
        : provider.durations.reduce(
          (best, value) => Math.abs(value - (Number.isFinite(requested) ? requested : this.settings.defaults.duration)) < Math.abs(best - (Number.isFinite(requested) ? requested : this.settings.defaults.duration)) ? value : best,
          provider.durations[0],
        );
    }
    let aspectRatio = '';
    if (provider.ratios.length > 0) {
      aspectRatio = provider.ratios.includes(input?.aspectRatio) ? input.aspectRatio : provider.ratios[0];
    }

    const imageUrl = input?.imageUrl === undefined || input?.imageUrl === null || input?.imageUrl === ''
      ? undefined
      : httpUrl(input.imageUrl);
    if (input?.imageUrl && !imageUrl) {
      throw new ProviderError('首帧图必须是 http(s) 图片地址', { code: 'invalid-image' });
    }
    if (imageUrl && !provider.supportsImage) {
      throw new ProviderError(`${provider.label.zh} 不支持首帧图，请换一个提供方或去掉图片`, { code: 'image-unsupported' });
    }
    const seedValue = Number(input?.seed);
    const seed = Number.isFinite(seedValue) ? Math.trunc(seedValue) : undefined;

    const now = new Date();
    const id = randomUUID();
    const cwd = typeof options.cwd === 'string' && options.cwd !== '' && existsSync(options.cwd)
      ? options.cwd
      : this.defaultDirectory();
    const job = {
      id,
      provider: provider.id,
      providerLabel: provider.label.zh,
      model,
      prompt,
      negativePrompt: typeof input?.negativePrompt === 'string' ? input.negativePrompt.trim() : '',
      duration,
      aspectRatio,
      imageUrl,
      seed,
      status: 'queued',
      progress: 0,
      createdAt: now.toISOString(),
      cwd,
      source: options.source === 'tool' ? 'tool' : 'panel',
    };
    this.jobs.set(id, job);
    await this.persist();
    void this.run(job).catch((error) => this.logger?.warn(`[video-studio] job ${id} crashed: ${error}`));
    return this.view(job);
  }

  inputOf(job) {
    return {
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      model: job.model,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      imageUrl: job.imageUrl,
      seed: job.seed,
    };
  }

  outputDirectoryFor(job) {
    const configured = this.settings.outputDir || 'videos';
    const root = job.cwd || this.defaultDirectory();
    return isAbsolute(configured) ? configured : join(root, configured);
  }

  async run(job) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const provider = providerById(job.provider);
    const settings = this.settings.providers[job.provider];
    try {
      const key = await this.resolveKey(provider.keyRef).catch(() => '');
      if (!key) {
        throw new ProviderError(
          `尚未配置 ${provider.label.zh} 的 API Key：在视频工作室的「设置」里填写，或设置环境变量 ${provider.keyRef}`,
          { code: 'missing-credential' },
        );
      }
      job.startedAt = new Date().toISOString();
      await this.persist();

      // A provider with a contended queue may ask the runner to keep retrying
      // the submission; the job stays "queued" (and cancellable) meanwhile.
      const queueWaitMs = Number.isFinite(provider.queueWaitMs) && provider.queueWaitMs > 0 ? provider.queueWaitMs : 0;
      const queueDeadline = Date.now() + queueWaitMs;
      let remote;
      for (;;) {
        try {
          remote = await provider.create({
            baseUrl: settings.baseUrl,
            key,
            input: this.inputOf(job),
            signal: controller.signal,
          });
          break;
        } catch (error) {
          if (error?.code !== 'queue-full' || Date.now() >= queueDeadline) throw error;
          job.status = 'queued';
          job.error = null;
          job.errorCode = null;
          await this.persist();
          await delay(20000, controller.signal);
        }
      }
      job.status = 'running';
      job.remoteId = remote.id;
      if (typeof remote.model === 'string' && remote.model !== '') job.model = remote.model;
      await this.persist();

      const deadline = Date.now() + this.settings.maxWaitMinutes * 60000;
      const pollInterval = Number.isFinite(provider.pollIntervalMs) && provider.pollIntervalMs > 0
        ? provider.pollIntervalMs
        : this.settings.pollIntervalMs;
      const pollGrowth = Number.isFinite(provider.pollBackoff) && provider.pollBackoff > 1 ? provider.pollBackoff : 1;
      const pollCeiling = Number.isFinite(provider.maxPollIntervalMs) && provider.maxPollIntervalMs > pollInterval
        ? provider.maxPollIntervalMs
        : pollInterval;
      let nextDelay = pollInterval;
      let pollCount = 0;
      for (;;) {
        await delay(nextDelay, controller.signal);
        pollCount += 1;
        const state = await provider.poll({
          baseUrl: settings.baseUrl,
          key,
          remote,
          signal: controller.signal,
        });
        // A provider may ask for a longer gap (for example after a rate limit).
        nextDelay = Number.isFinite(state.retryAfterMs) && state.retryAfterMs > 0
          ? state.retryAfterMs
          : Math.min(pollCeiling, Math.round(pollInterval * pollGrowth ** pollCount));
        if (Number.isFinite(state.progress)) job.progress = state.progress;
        if (state.state === 'failed') {
          throw new ProviderError(state.error ?? '视频生成失败', { code: 'provider-failed' });
        }
        if (state.state === 'succeeded') {
          if (job.progress !== 100) job.progress = 99;
          await this.persist();
          const { bytes, contentType } = await provider.download({
            baseUrl: settings.baseUrl,
            key,
            remote,
            url: state.url,
            signal: controller.signal,
          });
          const directory = this.outputDirectoryFor(job);
          await mkdir(directory, { recursive: true });
          const fileName = `${stamp()}-${job.provider}-${job.id.slice(0, 8)}.${extensionOf(contentType, state.url)}`;
          const file = join(directory, fileName);
          await writeFile(file, bytes);
          job.file = file;
          job.fileBytes = bytes.byteLength;
          job.progress = 100;
          job.status = 'succeeded';
          job.finishedAt = new Date().toISOString();
          return;
        }
        if (Date.now() > deadline) {
          throw new ProviderError(
            `超过 ${this.settings.maxWaitMinutes} 分钟仍未完成，已停止等待（远端任务可能还在跑）`,
            { code: 'timeout' },
          );
        }
        await this.persist();
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || error?.code === 'aborted';
      job.status = cancelled ? 'canceled' : 'failed';
      job.error = cancelled ? '已取消' : error?.message ?? String(error);
      job.errorCode = cancelled ? 'canceled' : error?.code ?? 'error';
      job.finishedAt = new Date().toISOString();
    } finally {
      this.controllers.delete(job.id);
      await this.persist();
    }
  }

  /** Wait for a terminal state without cancelling the background job. */
  async wait(id, timeoutMs, signal) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const job = this.jobs.get(id);
      if (!job) throw new ProviderError(`没有这个任务：${id}`, { code: 'unknown-job' });
      if (isTerminal(job.status)) return this.view(job);
      const remaining = deadline - Date.now();
      if (remaining <= 0) return this.view(job);
      try {
        await delay(Math.min(1500, remaining), signal);
      } catch {
        return this.view(job);
      }
    }
  }

  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new ProviderError(`没有这个任务：${id}`, { code: 'unknown-job' });
    if (isTerminal(job.status)) return this.view(job);
    this.controllers.get(id)?.abort();
    const provider = providerById(job.provider);
    const settings = this.settings.providers[job.provider];
    if (provider?.cancel && job.remoteId) {
      const key = await this.resolveKey(provider.keyRef).catch(() => '');
      if (key) {
        await provider.cancel({
          baseUrl: settings.baseUrl,
          key,
          remote: { id: job.remoteId },
          signal: new AbortController().signal,
        }).catch(() => undefined);
      }
    }
    if (!isTerminal(job.status)) {
      job.status = 'canceled';
      job.error = '已取消';
      job.errorCode = 'canceled';
      job.finishedAt = new Date().toISOString();
    }
    await this.persist();
    return this.view(job);
  }

  async remove(id, { deleteFile = true } = {}) {
    const job = this.jobs.get(id);
    if (!job) throw new ProviderError(`没有这个任务：${id}`, { code: 'unknown-job' });
    if (!isTerminal(job.status)) await this.cancel(id);
    if (deleteFile && job.file) {
      await unlink(job.file).catch(() => undefined);
    }
    this.jobs.delete(id);
    await this.persist();
    return { id, removed: true };
  }

  /** Media route lookup: only a finished job with an existing file is servable. */
  async mediaFile(id) {
    const job = this.jobs.get(id);
    if (!job?.file) return undefined;
    try {
      const info = await stat(job.file);
      if (!info.isFile()) return undefined;
      return { path: job.file, size: info.size, fileName: basename(job.file) };
    } catch {
      return undefined;
    }
  }
}
