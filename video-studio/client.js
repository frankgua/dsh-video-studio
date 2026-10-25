/**
 * Video Studio — browser half.
 *
 * Registers the sidebar row and the center-column page. The page is a plain
 * React component over the Host's local JSON routes: it composes a request,
 * starts jobs, polls the journal, and plays the finished file from the same
 * origin. All copy goes through the Client locale service when present.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-video-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    /** Locale namespace and panel id (the sidebar id and the `main` key match). */
    const NS = 'video-studio';
    const PANEL_ID = 'video-studio';
    const PANEL_ORDER = 50;
    const API = '/api/video-studio';

    const zh = {
      'entry.label': '视频工作室',
      'entry.tooltip': '视频工作室：用视频模型生成视频',
      'panel.title': '视频工作室',
      'panel.subtitle': '用视频模型生成短视频，成片保存在工作区里。',
      'compose.title': '新建生成',
      'compose.prompt': '描述',
      'compose.promptPlaceholder': '描述主体、动作、环境、镜头运动、光线与风格……',
      'compose.provider': '提供方',
      'compose.model': '模型',
      'compose.modelPlaceholder': '留空使用默认模型',
      'compose.duration': '时长',
      'compose.durationDefault': '默认',
      'compose.ratio': '画面比例',
      'compose.advanced': '高级选项',
      'compose.negative': '负向提示',
      'compose.negativePlaceholder': '不希望出现的内容（可选）',
      'compose.image': '首帧图地址',
      'compose.imagePlaceholder': 'https://…（图生视频时填写）',
      'compose.seed': '随机种子',
      'compose.seedPlaceholder': '可选',
      'compose.submit': '生成视频',
      'compose.submitting': '提交中…',
      'compose.promptRequired': '请先填写视频描述。',
      'compose.keyReady': 'API Key 已配置',
      'compose.keyMissing': '未配置 API Key',
      'compose.keyConfig': '去设置',
      'compose.output': '保存到 {path}',
      'jobs.title': '生成记录',
      'jobs.count': '{count} 个任务',
      'jobs.empty': '还没有生成任务',
      'jobs.emptyHint': '在上方填写描述，然后点「生成视频」。',
      'jobs.refresh': '刷新',
      'jobs.cancel': '取消',
      'jobs.retry': '重试',
      'jobs.remove': '删除',
      'jobs.copyPath': '复制路径',
      'jobs.copied': '已复制',
      'jobs.open': '新标签打开',
      'jobs.file': '文件',
      'jobs.generating': '生成中',
      'jobs.elapsed': '已用时 {time}',
      'status.queued': '排队中',
      'status.running': '生成中',
      'status.succeeded': '已完成',
      'status.failed': '失败',
      'status.canceled': '已取消',
      'settings.title': '视频工作室设置',
      'settings.button': '设置',
      'settings.provider': '默认提供方',
      'settings.outputDir': '输出目录',
      'settings.outputDirHint': '相对路径基于工作区目录，例如 videos；也可以填绝对路径。',
      'settings.apiKey': 'API Key',
      'settings.apiKeySet': '已配置，留空则不修改',
      'settings.apiKeyUnset': '粘贴 API Key',
      'settings.clearKey': '清除已保存的密钥',
      'settings.envHint': '也可以设置环境变量 {name}',
      'settings.baseUrl': '接口地址',
      'settings.model': '默认模型',
      'settings.save': '保存',
      'settings.saving': '保存中…',
      'settings.cancel': '取消',
      'settings.close': '关闭',
      'settings.saved': '设置已保存',
      'settings.storedSafe': '密钥写入 Harness 凭据库，不会存进插件文件。',
      'settings.needKey': '请先配置当前提供方的 API Key。',
      'error.load': '读取状态失败：{error}',
      'error.action': '操作失败：{error}',
      'notice.submitted': '已提交，生成通常需要 1–5 分钟。',
      'meta.size': '{size}',
      'meta.seconds': '{value} 秒',
    };

    const en = {
      'entry.label': 'Video Studio',
      'entry.tooltip': 'Video Studio: generate videos with video models',
      'panel.title': 'Video Studio',
      'panel.subtitle': 'Generate short videos with video models; finished files are saved in the workspace.',
      'compose.title': 'New generation',
      'compose.prompt': 'Prompt',
      'compose.promptPlaceholder': 'Describe subject, action, setting, camera movement, lighting and style…',
      'compose.provider': 'Provider',
      'compose.model': 'Model',
      'compose.modelPlaceholder': 'Leave blank for the default model',
      'compose.duration': 'Duration',
      'compose.durationDefault': 'Default',
      'compose.ratio': 'Aspect ratio',
      'compose.advanced': 'Advanced',
      'compose.negative': 'Negative prompt',
      'compose.negativePlaceholder': 'What the video should avoid (optional)',
      'compose.image': 'First-frame image URL',
      'compose.imagePlaceholder': 'https://… (for image-to-video)',
      'compose.seed': 'Seed',
      'compose.seedPlaceholder': 'Optional',
      'compose.submit': 'Generate video',
      'compose.submitting': 'Submitting…',
      'compose.promptRequired': 'Enter a prompt first.',
      'compose.keyReady': 'API key configured',
      'compose.keyMissing': 'No API key yet',
      'compose.keyConfig': 'Configure',
      'compose.output': 'Saved under {path}',
      'jobs.title': 'History',
      'jobs.count': '{count} jobs',
      'jobs.empty': 'No generations yet',
      'jobs.emptyHint': 'Write a prompt above, then press Generate video.',
      'jobs.refresh': 'Refresh',
      'jobs.cancel': 'Cancel',
      'jobs.retry': 'Retry',
      'jobs.remove': 'Delete',
      'jobs.copyPath': 'Copy path',
      'jobs.copied': 'Copied',
      'jobs.open': 'Open in tab',
      'jobs.file': 'File',
      'jobs.generating': 'Generating',
      'jobs.elapsed': 'elapsed {time}',
      'status.queued': 'Queued',
      'status.running': 'Running',
      'status.succeeded': 'Done',
      'status.failed': 'Failed',
      'status.canceled': 'Canceled',
      'settings.title': 'Video Studio settings',
      'settings.button': 'Settings',
      'settings.provider': 'Default provider',
      'settings.outputDir': 'Output directory',
      'settings.outputDirHint': 'Relative paths resolve against the workspace, e.g. videos; absolute paths are used as-is.',
      'settings.apiKey': 'API key',
      'settings.apiKeySet': 'Configured — leave blank to keep it',
      'settings.apiKeyUnset': 'Paste the API key',
      'settings.clearKey': 'Clear the stored key',
      'settings.envHint': 'Or set the environment variable {name}',
      'settings.baseUrl': 'Base URL',
      'settings.model': 'Default model',
      'settings.save': 'Save',
      'settings.saving': 'Saving…',
      'settings.cancel': 'Cancel',
      'settings.close': 'Close',
      'settings.saved': 'Settings saved',
      'settings.storedSafe': 'Keys go to the Harness credential store, never into plugin files.',
      'settings.needKey': 'Configure an API key for the selected provider first.',
      'error.load': 'Could not read state: {error}',
      'error.action': 'Action failed: {error}',
      'notice.submitted': 'Submitted; generation usually takes 1–5 minutes.',
      'meta.size': '{size}',
      'meta.seconds': '{value}s',
    };

    /** Runtime translate seat, wired once the locale service is bound. */
    let runtimeT;
    function fallbackDictionary() {
      const lang = typeof document !== 'undefined' ? (document.documentElement.lang || 'zh') : 'zh';
      return lang.toLowerCase().startsWith('en') ? en : zh;
    }
    function tt(key, values) {
      let text;
      if (runtimeT) {
        text = runtimeT(key, values);
      } else {
        text = fallbackDictionary()[key] ?? key;
      }
      if (values) {
        for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value));
      }
      return text;
    }

    /** One JSON call to the Host routes; a failure carries the Host's reason. */
    async function callApi(path, body) {
      const init = body === undefined
        ? { credentials: 'same-origin' }
        : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
      const response = await fetch(`${API}${path}`, init);
      const text = await response.text();
      let value;
      try {
        value = text === '' ? undefined : JSON.parse(text);
      } catch {
        value = undefined;
      }
      if (!response.ok) {
        throw new Error(value?.error ?? `${response.status} ${response.statusText}`);
      }
      return value;
    }

    function messageOf(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '';
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatClock(iso) {
      if (typeof iso !== 'string') return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (value) => String(value).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    function formatElapsed(job, now) {
      const start = Date.parse(job.startedAt ?? job.createdAt);
      if (!Number.isFinite(start)) return '';
      const seconds = Math.max(0, Math.round(((job.finishedAt ? Date.parse(job.finishedAt) : now) - start) / 1000));
      if (seconds < 60) return `${seconds}s`;
      return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
    }

    function statusTone(status) {
      if (status === 'succeeded') return 'var(--dsw-alias-state-success-primary)';
      if (status === 'failed') return 'var(--dsw-alias-state-error-primary)';
      if (status === 'canceled') return 'var(--dsw-alias-state-idle-primary)';
      if (status === 'running') return 'var(--dsw-alias-brand-primary)';
      return 'var(--dsw-alias-state-warn-primary)';
    }

    /** The sidebar glyph the shell draws at its own size. */
    function StudioGlyph({ size }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.3',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'data-dsh-panel-entry': PANEL_ID,
        'aria-hidden': 'true',
      }, [
        h('rect', { key: 'b', x: '2', y: '3.6', width: '12', height: '9.4', rx: '2' }),
        h('path', { key: 'p', d: 'M6.8 6.5v4l3.4-2z' }),
        h('path', { key: 'l', d: 'M2.6 3.6 4.4 1.9M6.6 3.6 8.4 1.9M10.6 3.6 12.4 1.9' }),
      ]);
    }

    function Chip({ color, children }) {
      return h('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '1px 8px',
          borderRadius: '999px',
          border: `1px solid ${color}`,
          color,
          fontSize: '11px',
          lineHeight: '18px',
          whiteSpace: 'nowrap',
        },
      }, children);
    }

    function Field({ label, hint, children }) {
      return h('label', { className: 'vs_field' }, [
        h('span', { key: 'l', className: 'vs_fieldLabel' }, label),
        children,
        hint ? h('span', { key: 'h', className: 'vs_hint' }, hint) : null,
      ]);
    }

    function JobCard({ job, now, onCancel, onRemove, onRetry }) {
      const [copied, setCopied] = useState(false);
      const timer = useRef(null);
      useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
      }, []);
      const copyPath = useCallback(async () => {
        if (!job.file) return;
        try {
          await navigator.clipboard.writeText(job.file);
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }, [job.file]);

      const active = job.status === 'queued' || job.status === 'running';
      const meta = [];
      if (job.duration > 0) meta.push(tt('meta.seconds', { value: job.duration }));
      if (job.aspectRatio) meta.push(job.aspectRatio);
      if (job.fileBytes) meta.push(formatBytes(job.fileBytes));

      return h('article', { className: 'vs_job', 'data-status': job.status }, [
        h('div', { key: 'head', className: 'vs_jobHead' }, [
          h(Chip, { key: 'chip', color: statusTone(job.status) }, tt(`status.${job.status}`)),
          h('span', { key: 'model', className: 'vs_jobModel' }, `${job.providerLabel ?? job.provider} · ${job.model}`),
          h('span', { key: 'time', className: 'vs_jobTime' }, formatClock(job.createdAt)),
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          active
            ? h('button', { key: 'cancel', type: 'button', className: 'vs_button vs_buttonGhost', onClick: () => onCancel(job) }, tt('jobs.cancel'))
            : null,
          h('button', { key: 'retry', type: 'button', className: 'vs_button vs_buttonGhost', onClick: () => onRetry(job) }, tt('jobs.retry')),
          h('button', { key: 'remove', type: 'button', className: 'vs_button vs_buttonGhost vs_danger', onClick: () => onRemove(job) }, tt('jobs.remove')),
        ]),
        job.status === 'succeeded' && job.mediaUrl
          ? h('video', {
            key: 'video',
            className: 'vs_video',
            src: job.mediaUrl,
            controls: true,
            preload: 'metadata',
            playsInline: true,
          })
          : null,
        active
          ? h('div', { key: 'progress', className: 'vs_progressWrap' }, [
            h('div', { key: 'bar', className: `vs_progress${Number.isFinite(job.progress) ? '' : ' vs_indeterminate'}` }, [
              h('span', {
                key: 'fill',
                style: Number.isFinite(job.progress) ? { width: `${Math.max(2, Math.min(100, job.progress))}%` } : undefined,
              }),
            ]),
            h('span', { key: 'elapsed', className: 'vs_hint' }, tt('jobs.elapsed', { time: formatElapsed(job, now) })),
          ])
          : null,
        h('p', { key: 'prompt', className: 'vs_prompt' }, job.prompt),
        job.error
          ? h('p', { key: 'error', className: 'vs_error' }, job.error)
          : null,
        h('div', { key: 'foot', className: 'vs_jobFoot' }, [
          meta.length > 0 ? h('span', { key: 'meta', className: 'vs_hint' }, meta.join(' · ')) : null,
          job.file
            ? h('code', { key: 'path', className: 'vs_path', title: job.file }, job.fileName ?? job.file)
            : null,
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          job.file
            ? h('button', { key: 'copy', type: 'button', className: 'vs_button vs_buttonGhost', onClick: copyPath }, copied ? tt('jobs.copied') : tt('jobs.copyPath'))
            : null,
          job.mediaUrl
            ? h('a', {
              key: 'open',
              className: 'vs_button vs_buttonGhost',
              href: job.mediaUrl,
              target: '_blank',
              rel: 'noreferrer',
            }, tt('jobs.open'))
            : null,
        ]),
      ]);
    }

    function ComposeCard({ providers, settings, form, setForm, onSubmit, submitting, notice, onOpenSettings }) {
      const providerId = form.provider || settings.provider;
      const provider = providers.find((entry) => entry.id === providerId) ?? providers[0];
      const [advanced, setAdvanced] = useState(false);
      if (!provider) return null;
      const update = (patch) => setForm((current) => ({ ...current, ...patch }));
      const suggestions = provider.modelSuggestions ?? [];
      const durationChoices = provider.durations ?? [];
      const ratioChoices = provider.ratios ?? [];
      const canSubmit = !submitting && form.prompt.trim() !== '';

      return h('section', { className: 'vs_card' }, [
        h('div', { key: 'head', className: 'vs_cardHead' }, [
          h('h2', { key: 'title', className: 'vs_cardTitle' }, tt('compose.title')),
          h('span', { key: 'spacer', className: 'vs_spacer' }),
        ]),
        h('div', { key: 'row', className: 'vs_row' }, [
          h(Field, { key: 'provider', label: tt('compose.provider') },
            h('select', {
              className: 'vs_input',
              value: providerId,
              onChange: (event) => update({ provider: event.target.value, model: '', duration: '', aspectRatio: '' }),
            }, providers.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.label.zh)))),
          h(Field, { key: 'model', label: tt('compose.model') },
            h('input', {
              className: 'vs_input',
              list: 'vs-model-suggestions',
              placeholder: provider.model || tt('compose.modelPlaceholder'),
              value: form.model,
              onChange: (event) => update({ model: event.target.value }),
            })),
        ]),
        h('datalist', { key: 'models', id: 'vs-model-suggestions' },
          suggestions.map((name) => h('option', { key: name, value: name }))),
        h(Field, { key: 'prompt', label: tt('compose.prompt') },
          h('textarea', {
            className: 'vs_textarea',
            rows: 3,
            placeholder: tt('compose.promptPlaceholder'),
            value: form.prompt,
            onChange: (event) => update({ prompt: event.target.value }),
          })),
        h('div', { key: 'controls', className: 'vs_row' }, [
          durationChoices.length > 0
            ? h(Field, { key: 'duration', label: tt('compose.duration') },
              h('select', {
                className: 'vs_input',
                value: form.duration,
                onChange: (event) => update({ duration: event.target.value }),
              }, [
                h('option', { key: 'default', value: '' }, `${tt('compose.durationDefault')}${settings.defaults?.duration ? ` (${settings.defaults.duration}s)` : ''}`),
                ...durationChoices.map((value) => h('option', { key: String(value), value: String(value) }, `${value}s`)),
              ]))
            : null,
          ratioChoices.length > 0
            ? h(Field, { key: 'ratio', label: tt('compose.ratio') },
              h('select', {
                className: 'vs_input',
                value: form.aspectRatio,
                onChange: (event) => update({ aspectRatio: event.target.value }),
              }, [
                h('option', { key: 'default', value: '' }, tt('compose.durationDefault')),
                ...ratioChoices.map((value) => h('option', { key: value, value }, value)),
              ]))
            : null,
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          h('button', {
            key: 'advanced',
            type: 'button',
            className: 'vs_button vs_buttonGhost',
            onClick: () => setAdvanced((value) => !value),
          }, `${tt('compose.advanced')} ${advanced ? '▾' : '▸'}`),
        ]),
        advanced
          ? h('div', { key: 'advanced', className: 'vs_advanced' }, [
            h(Field, { key: 'negative', label: tt('compose.negative') },
              h('input', {
                className: 'vs_input',
                placeholder: tt('compose.negativePlaceholder'),
                value: form.negativePrompt,
                onChange: (event) => update({ negativePrompt: event.target.value }),
              })),
            provider.supportsImage
              ? h(Field, { key: 'image', label: tt('compose.image') },
                h('input', {
                  className: 'vs_input',
                  placeholder: tt('compose.imagePlaceholder'),
                  value: form.imageUrl,
                  onChange: (event) => update({ imageUrl: event.target.value }),
                }))
              : null,
            h(Field, { key: 'seed', label: tt('compose.seed') },
              h('input', {
                className: 'vs_input',
                inputMode: 'numeric',
                placeholder: tt('compose.seedPlaceholder'),
                value: form.seed,
                onChange: (event) => update({ seed: event.target.value.replace(/[^0-9-]/gu, '') }),
              })),
          ])
          : null,
        h('div', { key: 'foot', className: 'vs_composeFoot' }, [
          h('span', { key: 'key', className: 'vs_keyState', 'data-ready': provider.keyConfigured ? 'true' : 'false' }, [
            h('span', { key: 'dot', className: 'vs_dot' }),
            provider.keyConfigured ? tt('compose.keyReady') : tt('compose.keyMissing'),
            provider.keyConfigured
              ? null
              : h('button', { key: 'go', type: 'button', className: 'vs_link', onClick: onOpenSettings }, tt('compose.keyConfig')),
          ]),
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          notice ? h('span', { key: 'notice', className: 'vs_notice' }, notice) : null,
          h('button', {
            key: 'submit',
            type: 'button',
            className: 'vs_button vs_buttonPrimary',
            disabled: !canSubmit,
            onClick: onSubmit,
          }, submitting ? tt('compose.submitting') : tt('compose.submit')),
        ]),
      ]);
    }

    function SettingsDialog({ providers, settings, onClose, onSaved }) {
      const [draft, setDraft] = useState(() => ({
        provider: settings.provider,
        outputDir: settings.outputDir,
        providers: Object.fromEntries(providers.map((entry) => [entry.id, { baseUrl: entry.baseUrl, model: entry.model }])),
        keys: {},
        clear: {},
        providerId: providers[0]?.id ?? '',
      }));
      const [saving, setSaving] = useState(false);
      const [error, setError] = useState('');
      const [saved, setSaved] = useState(false);

      const patchProvider = (id, patch) => setDraft((current) => ({
        ...current,
        providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } },
      }));

      const save = async () => {
        setSaving(true);
        setError('');
        try {
          const apiKeys = {};
          for (const [id, value] of Object.entries(draft.keys)) {
            if (typeof value === 'string' && value.trim() !== '') apiKeys[id] = value.trim();
          }
          const clearKeys = Object.keys(draft.clear).filter((id) => draft.clear[id]);
          await callApi('/settings', {
            settings: {
              provider: draft.provider,
              outputDir: draft.outputDir,
              providers: draft.providers,
            },
            apiKeys,
            clearKeys,
          });
          setSaved(true);
          await onSaved();
        } catch (failure) {
          setError(tt('error.action', { error: messageOf(failure) }));
        } finally {
          setSaving(false);
        }
      };

      const provider = providers.find((entry) => entry.id === draft.providerId) ?? providers[0];

      return h('div', {
        className: 'vs_backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose();
        },
      }, h('div', { className: 'vs_modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': tt('settings.title') }, [
        h('div', { key: 'head', className: 'vs_modalHead' }, [
          h('h2', { key: 'title', className: 'vs_cardTitle' }, tt('settings.title')),
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          h('button', { key: 'close', type: 'button', className: 'vs_button vs_buttonGhost', onClick: onClose }, '✕'),
        ]),
        h('div', { key: 'body', className: 'vs_modalBody' }, [
          h('div', { key: 'row', className: 'vs_row' }, [
            h(Field, { key: 'default', label: tt('settings.provider') },
              h('select', {
                className: 'vs_input',
                value: draft.provider,
                onChange: (event) => setDraft((current) => ({ ...current, provider: event.target.value })),
              }, providers.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.label.zh)))),
            h(Field, { key: 'out', label: tt('settings.outputDir'), hint: tt('settings.outputDirHint') },
              h('input', {
                className: 'vs_input',
                value: draft.outputDir,
                onChange: (event) => setDraft((current) => ({ ...current, outputDir: event.target.value })),
              })),
          ]),
          h('div', { key: 'tabs', className: 'vs_modalTabs' }, providers.map((entry) => h('button', {
            key: entry.id,
            type: 'button',
            className: 'vs_tab',
            'data-active': entry.id === draft.providerId ? 'true' : 'false',
            onClick: () => setDraft((current) => ({ ...current, providerId: entry.id })),
          }, entry.label.zh))),
          provider
            ? h('div', { key: 'provider', className: 'vs_providerCard' }, [
              h('p', { key: 'hint', className: 'vs_hint' }, provider.hint?.zh ?? ''),
              h('div', { key: 'row1', className: 'vs_row' }, [
                h(Field, { key: 'base', label: tt('settings.baseUrl') },
                  h('input', {
                    className: 'vs_input',
                    value: draft.providers[provider.id]?.baseUrl ?? '',
                    onChange: (event) => patchProvider(provider.id, { baseUrl: event.target.value }),
                  })),
                h(Field, { key: 'model', label: tt('settings.model') },
                  h('input', {
                    className: 'vs_input',
                    value: draft.providers[provider.id]?.model ?? '',
                    onChange: (event) => patchProvider(provider.id, { model: event.target.value }),
                  })),
              ]),
              h(Field, {
                key: 'key',
                label: tt('settings.apiKey'),
                hint: tt('settings.envHint', { name: provider.keyRef }),
              }, h('input', {
                className: 'vs_input',
                type: 'password',
                autoComplete: 'off',
                placeholder: provider.keyConfigured ? tt('settings.apiKeySet') : tt('settings.apiKeyUnset'),
                value: draft.keys[provider.id] ?? '',
                onChange: (event) => setDraft((current) => ({
                  ...current,
                  keys: { ...current.keys, [provider.id]: event.target.value },
                })),
              })),
              h('label', { key: 'clear', className: 'vs_check' }, [
                h('input', {
                  key: 'box',
                  type: 'checkbox',
                  checked: Boolean(draft.clear[provider.id]),
                  onChange: (event) => setDraft((current) => ({
                    ...current,
                    clear: { ...current.clear, [provider.id]: event.target.checked },
                  })),
                }),
                h('span', { key: 'text' }, tt('settings.clearKey')),
              ]),
            ])
            : null,
          h('p', { key: 'safe', className: 'vs_hint' }, tt('settings.storedSafe')),
          error ? h('p', { key: 'error', className: 'vs_error' }, error) : null,
          saved && !error ? h('p', { key: 'saved', className: 'vs_ok' }, tt('settings.saved')) : null,
        ]),
        h('div', { key: 'foot', className: 'vs_modalFoot' }, [
          h('button', { key: 'cancel', type: 'button', className: 'vs_button vs_buttonGhost', onClick: onClose }, tt('settings.cancel')),
          h('button', {
            key: 'save',
            type: 'button',
            className: 'vs_button vs_buttonPrimary',
            disabled: saving,
            onClick: save,
          }, saving ? tt('settings.saving') : tt('settings.save')),
        ]),
      ]));
    }

    function StudioPage() {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [submitting, setSubmitting] = useState(false);
      const [settingsOpen, setSettingsOpen] = useState(false);
      const [now, setNow] = useState(() => Date.now());
      const [form, setForm] = useState({
        prompt: '',
        negativePrompt: '',
        provider: '',
        model: '',
        duration: '',
        aspectRatio: '',
        imageUrl: '',
        seed: '',
      });
      const mounted = useRef(true);

      useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
        };
      }, []);

      const refresh = useCallback(async () => {
        try {
          const next = await callApi('/state');
          if (!mounted.current) return;
          setState(next);
          setError('');
        } catch (failure) {
          if (mounted.current) setError(tt('error.load', { error: messageOf(failure) }));
        }
      }, []);

      useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
          await refresh();
          if (alive) timer = setTimeout(tick, 2500);
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [refresh]);

      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
      }, []);

      const submit = async () => {
        if (!state) return;
        if (form.prompt.trim() === '') {
          setNotice(tt('compose.promptRequired'));
          return;
        }
        setSubmitting(true);
        setNotice('');
        try {
          const job = await callApi('/generate', {
            provider: form.provider || state.settings.provider,
            prompt: form.prompt,
            model: form.model.trim() || undefined,
            duration: form.duration ? Number(form.duration) : undefined,
            aspectRatio: form.aspectRatio || undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            negativePrompt: form.negativePrompt.trim() || undefined,
            seed: form.seed.trim() === '' ? undefined : Number(form.seed),
          });
          if (!mounted.current) return;
          setForm((current) => ({ ...current, prompt: '', imageUrl: '' }));
          setNotice(tt('notice.submitted'));
          setState((current) => current ? { ...current, jobs: [job, ...current.jobs] } : current);
          await refresh();
        } catch (failure) {
          setNotice(tt('error.action', { error: messageOf(failure) }));
        } finally {
          if (mounted.current) setSubmitting(false);
        }
      };

      const cancelJob = async (job) => {
        try {
          await callApi('/cancel', { id: job.id });
          await refresh();
        } catch (failure) {
          setNotice(tt('error.action', { error: messageOf(failure) }));
        }
      };

      const removeJob = async (job) => {
        try {
          await callApi('/remove', { id: job.id, deleteFile: true });
          await refresh();
        } catch (failure) {
          setNotice(tt('error.action', { error: messageOf(failure) }));
        }
      };

      const retryJob = async (job) => {
        setSubmitting(true);
        setNotice('');
        try {
          await callApi('/generate', {
            provider: job.provider,
            prompt: job.prompt,
            model: job.model,
            duration: job.duration || undefined,
            aspectRatio: job.aspectRatio || undefined,
            imageUrl: job.imageUrl || undefined,
            negativePrompt: job.negativePrompt || undefined,
            seed: job.seed,
          });
          await refresh();
        } catch (failure) {
          setNotice(tt('error.action', { error: messageOf(failure) }));
        } finally {
          if (mounted.current) setSubmitting(false);
        }
      };

      const settings = state?.settings;

      return h('div', { className: 'vs_root' }, [
        h('style', { key: 'css' }, CSS_TEXT),
        h('div', { key: 'header', className: 'vs_header' }, [
          h('span', { key: 'mark', className: 'vs_mark' }, h(StudioGlyph, { size: 18 })),
          h('div', { key: 'titles', className: 'vs_titles' }, [
            h('h1', { key: 'title', className: 'vs_title' }, tt('panel.title')),
            h('p', { key: 'sub', className: 'vs_subtitle' }, tt('panel.subtitle')),
          ]),
          h('span', { key: 'spacer', className: 'vs_spacer' }),
          h('button', {
            key: 'settings',
            type: 'button',
            className: 'vs_button vs_buttonGhost',
            onClick: () => setSettingsOpen(true),
          }, tt('settings.button')),
        ]),
        h('div', { key: 'body', className: 'vs_body' }, [
          error ? h('p', { key: 'error', className: 'vs_error vs_banner' }, error) : null,
          state && settings
            ? h(ComposeCard, {
              key: 'compose',
              providers: state.providers,
              settings,
              form,
              setForm,
              onSubmit: submit,
              submitting,
              notice,
              onOpenSettings: () => setSettingsOpen(true),
            })
            : h('div', { key: 'loading', className: 'vs_card vs_loading' }, '…'),
          h('section', { key: 'jobs', className: 'vs_jobs' }, [
            h('div', { key: 'head', className: 'vs_jobsHead' }, [
              h('h2', { key: 'title', className: 'vs_cardTitle' }, tt('jobs.title')),
              h('span', { key: 'count', className: 'vs_hint' }, tt('jobs.count', { count: state?.jobs?.length ?? 0 })),
              h('span', { key: 'spacer', className: 'vs_spacer' }),
              h('button', {
                key: 'refresh',
                type: 'button',
                className: 'vs_button vs_buttonGhost',
                onClick: () => void refresh(),
              }, tt('jobs.refresh')),
            ]),
            state && state.jobs.length === 0
              ? h('div', { key: 'empty', className: 'vs_empty' }, [
                h('p', { key: 'title', className: 'vs_emptyTitle' }, tt('jobs.empty')),
                h('p', { key: 'hint', className: 'vs_hint' }, tt('jobs.emptyHint')),
              ])
              : null,
            (state?.jobs ?? []).map((job) => h(JobCard, {
              key: job.id,
              job,
              now,
              onCancel: cancelJob,
              onRemove: removeJob,
              onRetry: retryJob,
            })),
          ]),
        ]),
        settingsOpen && state && settings
          ? h(SettingsDialog, {
            key: 'settings-dialog',
            providers: state.providers,
            settings,
            onClose: () => setSettingsOpen(false),
            onSaved: async () => {
              await refresh();
            },
          })
          : null,
      ]);
    }

    const CSS_TEXT = `
.vs_root{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif)}
.vs_header{flex:none;display:flex;align-items:center;gap:10px;padding:16px 20px 10px}
.vs_mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-brand-primary)}
.vs_titles{display:flex;flex-direction:column;gap:2px;min-width:0}
.vs_title{margin:0;font-size:16px;font-weight:700;line-height:1.3}
.vs_subtitle{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vs_body{flex:1;min-height:0;overflow-y:auto;padding:6px 20px 28px;display:flex;flex-direction:column;gap:16px}
.vs_card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.vs_cardHead{display:flex;align-items:center;gap:8px}
.vs_cardTitle{margin:0;font-size:14px;font-weight:650}
.vs_row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.vs_field{display:flex;flex-direction:column;gap:5px;min-width:150px;flex:1}
.vs_fieldLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}
.vs_hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.vs_input,.vs_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:13px;font-family:inherit;outline:none;min-width:0;width:100%;box-sizing:border-box}
.vs_input:focus,.vs_textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.vs_textarea{resize:vertical;min-height:64px;line-height:1.55}
.vs_button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;border:1px solid transparent;padding:6px 12px;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;background:0 0;color:var(--dsw-alias-label-primary)}
.vs_button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.vs_buttonGhost{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}
.vs_buttonGhost:hover{color:var(--dsw-alias-label-primary)}
.vs_buttonPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground);border:none;padding:8px 18px;font-size:13px;font-weight:600}
.vs_buttonPrimary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));opacity:.92}
.vs_buttonPrimary:disabled{opacity:.45;cursor:not-allowed}
.vs_danger:hover{color:var(--dsw-alias-state-error-primary)}
.vs_spacer{flex:1}
.vs_composeFoot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.vs_keyState{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.vs_keyState[data-ready="false"]{color:var(--dsw-alias-state-warn-primary)}
.vs_dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.vs_link{border:none;background:0 0;color:var(--dsw-alias-brand-primary);font-size:11px;cursor:pointer;padding:0 2px;text-decoration:underline}
.vs_notice{font-size:11px;color:var(--dsw-alias-label-secondary);max-width:420px}
.vs_advanced{display:flex;gap:10px;flex-wrap:wrap;padding-top:2px}
.vs_jobs{display:flex;flex-direction:column;gap:10px}
.vs_jobsHead{display:flex;align-items:center;gap:8px;margin-top:2px}
.vs_empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:26px 16px;text-align:center}
.vs_emptyTitle{margin:0 0 4px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.vs_job{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:9px}
.vs_job[data-status="failed"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1))}
.vs_jobHead{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.vs_jobModel{font-size:12px;color:var(--dsw-alias-label-secondary)}
.vs_jobTime{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.vs_prompt{margin:0;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.vs_error{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.vs_ok{margin:0;font-size:12px;color:var(--dsw-alias-state-success-primary)}
.vs_video{width:100%;max-height:360px;border-radius:8px;background:#000;display:block}
.vs_jobFoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.vs_path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(420px,60%)}
.vs_progressWrap{display:flex;align-items:center;gap:10px}
.vs_progress{flex:1;height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.vs_progress span{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .4s ease}
.vs_progress.vs_indeterminate span{width:35%;animation:vs-slide 1.4s ease-in-out infinite}
@keyframes vs-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
.vs_banner{padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-state-error-primary)}
.vs_loading{padding:26px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.vs_backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:24px}
.vs_modal{width:min(720px,100%);max-height:min(86vh,860px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.vs_modalHead{display:flex;align-items:center;gap:8px;padding:14px 16px 10px}
.vs_modalBody{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 14px;display:flex;flex-direction:column;gap:12px}
.vs_modalTabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:6px}
.vs_tab{border:none;background:0 0;color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 10px;border-radius:6px;cursor:pointer;font-family:inherit}
.vs_tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.vs_tab[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.vs_providerCard{display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px}
.vs_check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.vs_modalFoot{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--dsw-alias-border-l1)}
`;

    /** Required client services: the slot registry (locale is used when present). */
    const inject = ['slots'];

    /**
     * Mount the sidebar row, the page and the locale dictionaries.
     * @param {any} ctx - client root context.
     */
    function apply(ctx) {
      const locale = ctx.get?.('locale');
      if (locale && typeof locale.register === 'function') {
        ctx.effect(() => {
          try {
            return locale.register(NS, { zh, en });
          } catch {
            return () => {};
          }
        }, 'video-studio: dictionaries');
        try {
          runtimeT = locale.bind(NS);
        } catch {
          runtimeT = undefined;
        }
      }

      const slots = ctx.slots;
      ctx.effect(() => {
        const disposers = [
          slots.inject('sidebar.panellist', () => slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: () => tt('entry.label'),
          }, StudioGlyph)),
          slots.inject('main', () => slots.register({
            name: 'main',
            key: PANEL_ID,
          }, StudioPage)),
        ];
        return () => {
          for (const dispose of disposers.splice(0)) dispose();
        };
      }, 'video-studio: panel');
    }

    return { inject, apply };
  },
});
