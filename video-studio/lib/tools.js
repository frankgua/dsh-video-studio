/**
 * Agent-facing tools. Both call the same service the panel calls, so a job
 * started from chat is visible in the panel and vice versa.
 */
const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'];

/** The calling session's workspace, used to place the produced file. */
function callingCwd(exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined;
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * @param {import('./studio.js').VideoStudio} studio
 * @returns {Array<Record<string, unknown>>} tool definitions
 */
export function makeTools(studio) {
  const models = {
    name: 'video_models',
    description:
      'List the video providers this workspace can call, with their configured and suggested model names, '
      + 'supported durations and aspect ratios, and whether each API key is configured. '
      + 'Call it before video_generate when the provider or model is unclear.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    timeoutMs: 20000,
    async execute() {
      const state = await studio.publicState();
      return {
        ok: true,
        defaultProvider: state.settings.provider,
        outputDir: state.settings.outputDir,
        providers: state.providers.map((provider) => ({
          id: provider.id,
          label: provider.label.zh,
          keyConfigured: provider.keyConfigured,
          keyRef: provider.keyRef,
          model: provider.model,
          suggestions: provider.modelSuggestions,
          durations: provider.durations,
          aspectRatios: provider.ratios,
          supportsImage: provider.supportsImage,
        })),
      };
    },
  };

  const generate = {
    name: 'video_generate',
    description:
      'Generate a video from a text prompt, or from a first-frame image, with a video model. '
      + 'Waits for the clip by default and returns the saved file path; a longer job returns its id and status so video_jobs can be polled.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description: 'The shot to generate: subject, action, setting, camera movement, lighting, style.',
        },
        provider: {
          type: 'string',
          description: 'agnes (Agnes Video: agnes-video-2.5-flash / agnes-video-2.5), sora (OpenAI /v1/videos compatible), dashscope (通义万相) or replicate (hosted models). Omit to use the configured default.',
        },
        model: {
          type: 'string',
          description: 'Model name for the chosen provider. video_models lists the configured and suggested names.',
        },
        duration: {
          type: 'number',
          description: 'Clip length in seconds; the nearest value the provider supports is used.',
        },
        aspectRatio: {
          type: 'string',
          enum: ['16:9', '9:16', '1:1'],
          description: 'Frame shape. Providers that do not support it ignore the value.',
        },
        imageUrl: {
          type: 'string',
          description: 'http(s) URL of a first-frame image for image-to-video. Providers without image support reject it.',
        },
        negativePrompt: {
          type: 'string',
          description: 'What the video should avoid.',
        },
        seed: {
          type: 'integer',
          description: 'Reproducibility seed, when the provider accepts one.',
        },
        waitSeconds: {
          type: 'number',
          description: 'How long to wait for the finished clip before returning a running job. Default 120, maximum 240; 0 returns as soon as it is submitted.',
        },
      },
      required: ['prompt'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    timeoutMs: 300000,
    async execute(args, exec) {
      const input = args && typeof args === 'object' ? args : {};
      const job = await studio.start(input, { cwd: callingCwd(exec), source: 'tool' });
      const requested = Number(input.waitSeconds);
      const waitSeconds = Number.isFinite(requested) ? Math.max(0, Math.min(240, Math.round(requested))) : 120;
      if (waitSeconds === 0) {
        return { ok: true, job, note: 'The clip is generating in the background; call video_jobs with this id to poll.' };
      }
      const settled = await studio.wait(job.id, waitSeconds * 1000, exec.signal);
      if (settled.status === 'succeeded') return { ok: true, job: settled };
      if (settled.status === 'failed' || settled.status === 'canceled') {
        return { ok: false, code: settled.errorCode ?? settled.status, message: settled.error, job: settled };
      }
      return {
        ok: true,
        job: settled,
        note: `Still generating after ${waitSeconds}s; call video_jobs with this id to poll.`,
      };
    },
  };

  const jobs = {
    name: 'video_jobs',
    description:
      'List recent video generation jobs, or read one job by id. A job carries its status, progress, '
      + 'saved file path and the provider error message when it failed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Read this job instead of listing recent ones.' },
        limit: { type: 'integer', description: 'How many recent jobs to list. Default 20, maximum 100.' },
        status: {
          type: 'string',
          enum: STATUSES,
          description: 'Only list jobs in this state.',
        },
      },
      required: [],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    timeoutMs: 20000,
    async execute(args) {
      const input = args && typeof args === 'object' ? args : {};
      if (typeof input.id === 'string' && input.id !== '') {
        const job = studio.get(input.id);
        if (!job) return { ok: false, code: 'unknown-job', message: `No job with id ${input.id}` };
        return { ok: true, job };
      }
      const limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 20;
      const list = studio.list(limit).filter((job) => (
        typeof input.status === 'string' && input.status !== '' ? job.status === input.status : true
      ));
      return { ok: true, jobs: list, count: list.length };
    },
  };

  return [models, generate, jobs];
}
