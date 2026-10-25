/**
 * Durable side of Video Studio: one settings document and one job journal,
 * both under `<DSH_HOME>/video-studio`. Writes are atomic (temp file +
 * rename) so a crash never leaves half a JSON document behind.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROVIDERS, providerById } from './providers.js';

/** Default document; the panel edits a merged copy through the settings route. */
export function defaultSettings() {
  const providers = {};
  for (const provider of PROVIDERS) {
    providers[provider.id] = { baseUrl: provider.defaults.baseUrl, model: provider.defaults.model };
  }
  return {
    provider: 'agnes',
    outputDir: 'videos',
    pollIntervalMs: 5000,
    maxWaitMinutes: 15,
    defaults: { duration: 6, aspectRatio: '16:9' },
    providers,
  };
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** Merge a stored or patched document over the defaults, field by field. */
export function normalizeSettings(raw) {
  const base = defaultSettings();
  const input = raw && typeof raw === 'object' ? raw : {};
  const providers = {};
  for (const provider of PROVIDERS) {
    const current = input.providers?.[provider.id];
    providers[provider.id] = {
      baseUrl: text(current?.baseUrl, base.providers[provider.id].baseUrl),
      model: text(current?.model, base.providers[provider.id].model),
    };
  }
  return {
    provider: providerById(input.provider) ? input.provider : base.provider,
    outputDir: text(input.outputDir, base.outputDir),
    pollIntervalMs: clampInt(input.pollIntervalMs, base.pollIntervalMs, 1000, 60000),
    maxWaitMinutes: clampInt(input.maxWaitMinutes, base.maxWaitMinutes, 1, 60),
    defaults: {
      duration: clampInt(input.defaults?.duration, base.defaults.duration, 1, 30),
      aspectRatio: ['16:9', '9:16', '1:1'].includes(input.defaults?.aspectRatio)
        ? input.defaults.aspectRatio
        : base.defaults.aspectRatio,
    },
    providers,
  };
}

export class StudioStore {
  /** @param {string} dshHome - the profile-wide DSH home directory. */
  constructor(dshHome) {
    this.directory = join(dshHome, 'video-studio');
    this.settingsFile = join(this.directory, 'settings.json');
    this.jobsFile = join(this.directory, 'jobs.json');
    this.writeQueue = Promise.resolve();
  }

  async ensureDirectory() {
    await mkdir(this.directory, { recursive: true });
  }

  async readJson(file, fallback) {
    try {
      const text = await readFile(file, 'utf8');
      const value = JSON.parse(text);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Read the settings document, or the defaults when none was written yet. */
  async loadSettings() {
    return normalizeSettings(await this.readJson(this.settingsFile, undefined));
  }

  /** Persist a whole document; callers pass an already-normalized value. */
  async saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    await this.ensureDirectory();
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.settingsFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      await rename(temporary, this.settingsFile);
    });
    await this.writeQueue;
    return normalized;
  }

  /** Read the job journal (empty when missing or unreadable). */
  async loadJobs() {
    const raw = await this.readJson(this.jobsFile, []);
    return Array.isArray(raw) ? raw.filter((job) => job && typeof job.id === 'string') : [];
  }

  /** Write the journal; serialized so concurrent status updates cannot interleave. */
  async saveJobs(jobs) {
    if (!Array.isArray(jobs)) return;
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureDirectory();
      const temporary = `${this.jobsFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
      await rename(temporary, this.jobsFile);
    });
    await this.writeQueue;
  }
}
