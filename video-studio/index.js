/**
 * Video Studio — host half.
 *
 * Owns the generation service, the local HTTP surface the Web panel calls, and
 * the agent tools. The client half (`./client`) renders the panel; both halves
 * read and write the same job journal through this service.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { makeTools } from './lib/tools.js';
import { makeRoutes } from './lib/routes.js';
import { StudioStore, normalizeSettings } from './lib/store.js';
import { VideoStudio } from './lib/studio.js';

/** Stable plugin name. */
export const name = 'video-studio';

/** The panel needs the Web carrier; tools attach only when the Host has them. */
export const inject = ['webServer'];

/**
 * @param {any} ctx - host plugin context.
 * @param {any} config - this row's configuration from cordis.patch.yml.
 */
export async function apply(ctx, config) {
  if (config?.enabled === false) return;

  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  const store = new StudioStore(dshHome);
  const credentials = () => ctx.get('credentials');
  const logger = typeof ctx.logger?.warn === 'function' ? ctx.logger : console;

  const resolveKey = async (ref) => {
    const service = credentials();
    if (typeof service?.resolve === 'function') {
      try {
        const resolved = await service.resolve(ref);
        if (resolved && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value;
      } catch {
        // Fall through to the ambient environment.
      }
    }
    return process.env[ref] ?? '';
  };

  const describeKey = async (ref) => {
    const service = credentials();
    if (typeof service?.describe === 'function') {
      try {
        const info = await service.describe(ref);
        if (info?.configured === true) return true;
      } catch {
        // Fall through to the ambient environment.
      }
    }
    return typeof process.env[ref] === 'string' && process.env[ref] !== '';
  };

  const defaultDirectory = () => {
    try {
      const workingDirectory = ctx.get('workingDirectory');
      if (typeof workingDirectory?.defaultDirectory === 'string' && workingDirectory.defaultDirectory !== '') {
        return workingDirectory.defaultDirectory;
      }
    } catch {
      // Fall through to the process directory.
    }
    return process.cwd();
  };

  const studio = new VideoStudio({ store, resolveKey, describeKey, defaultDirectory, logger });
  try {
    await studio.init();
  } catch (error) {
    logger.warn(`[video-studio] settings could not be loaded, using defaults: ${error}`);
    studio.settings = studio.settings ?? normalizeSettings(undefined);
  }

  // The row's own config stays the operator's layer above the panel's settings.
  if (config && typeof config === 'object') {
    const patch = {};
    if (typeof config.provider === 'string') patch.provider = config.provider;
    if (typeof config.outputDir === 'string') patch.outputDir = config.outputDir;
    if (config.defaults && typeof config.defaults === 'object') patch.defaults = config.defaults;
    if (config.providers && typeof config.providers === 'object') patch.providers = config.providers;
    if (Object.keys(patch).length > 0) {
      await studio.updateSettings(patch).catch((error) => logger.warn(`[video-studio] config not applied: ${error}`));
    }
  }

  ctx.effect(() => {
    const setKey = async (ref, value) => {
      const service = credentials();
      if (typeof service?.set !== 'function') throw new Error('凭据服务不可用');
      await service.set(ref, value);
    };
    const unsetKey = async (ref) => {
      const service = credentials();
      if (typeof service?.unset !== 'function') return;
      await service.unset(ref);
    };
    const routes = makeRoutes({
      studio,
      setKey,
      unsetKey,
      credentialsAvailable: () => typeof credentials()?.set === 'function',
    });
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers.splice(0)) dispose();
    };
  }, 'video-studio: routes');

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const disposers = makeTools(studio).map((definition) => toolCtx.tools.register(definition));
      return () => {
        for (const dispose of disposers.splice(0)) dispose();
      };
    }, 'video-studio: tools');
  });
}
