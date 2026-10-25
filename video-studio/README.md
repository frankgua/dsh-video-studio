# 视频工作室 · Video Studio

一个 DeepSeek Harness 插件：在 Web GUI 里用**视频模型**生成视频，同时把同一批模型作为**智能体工具**暴露给模型调用。

- 侧边栏「视频工作室」页面：填写描述 → 选模型 → 生成 → 直接播放 / 打开 / 复制路径 / 删除。
- 智能体工具：`video_models`、`video_generate`、`video_jobs`，和面板共用同一套任务队列与文件。
- 四个内置提供方，接口地址和模型名都可改，因此也能接入同协议的第三方中转服务。

## 安装

已经以本地目录方式安装到 `desktop` profile（`link:.../default-workspace/video-studio`）。

```text
plugin_manager install_bundle  target = <本目录>
```

卸载：`plugin_manager remove_bundle`，目标 `@local/dsh-video-studio`。

## 配置 API Key

任选一种，优先级从高到低：

1. **面板里填**（推荐）：打开「视频工作室」→ 右上角「设置」→ 选提供方 → 粘贴 API Key → 保存。
   密钥写入 Harness 凭据库（`ctx.credentials`），**不会**进插件文件。
2. **环境变量**（改完要重启 Harness）：

   | 提供方 | 变量名 |
   | --- | --- |
   | Agnes Video | `AGNES_API_KEY`（与 `agnes` LLM provider 共用同一个 Key） |
   | OpenAI Sora（兼容接口） | `DSH_VIDEO_SORA_API_KEY` |
   | 阿里云百炼 · 通义万相 | `DSH_VIDEO_DASHSCOPE_API_KEY` |
   | Replicate | `DSH_VIDEO_REPLICATE_API_TOKEN` |

3. **cordis.patch.yml 的 config**（运维层，覆盖面板设置）：

   ```yaml
   - insert:
       - id: video-studio
         name: '@local/dsh-video-studio'
         config:
           provider: agnes
           outputDir: videos          # 相对当前工作区；绝对路径也可
           pollIntervalMs: 5000
           maxWaitMinutes: 15
           providers:
             agnes:
               baseUrl: https://apihub.agnes-ai.com/v1
               model: agnes-video-2.5-flash
   ```

## 内置提供方

| id | 接口 | 说明 | 首帧图 |
| --- | --- | --- | --- |
| `agnes` | `POST {baseUrl}/videos` + `GET /agnesapi?video_id=…` | Agnes Video：`agnes-video-2.5-flash` / `agnes-video-2.5`；`mode=text` 文生视频，填了首帧图走 `mode=keyframe`；`size=720P`，时长 4–12 秒，比例 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。队列满（503 `video_queue_full`）时任务保持「排队中」并每 20 秒重试提交，最长 10 分钟；余额不足（403 `insufficient_user_quota`）会直接提示 | 支持（首帧） |
| `sora` | `POST {baseUrl}/videos` 等 OpenAI 视频协议 | 默认 `https://api.openai.com/v1`、模型 `sora-2`；可指向任何实现了该协议的中转 | 暂不支持 |
| `dashscope` | 百炼异步任务 `.../video-synthesis` + `/api/v1/tasks/{id}` | 默认 `wan2.2-t2v-plus`；填了首帧图会自动换成同系列 `i2v` 模型 | 支持 |
| `replicate` | `POST {baseUrl}/models/{owner}/{name}/predictions` | 聚合 Veo / Kling / Wan / Hailuo 等；模型写 `owner/name`，也支持 `owner/name:version` | 支持（`image` 字段） |

生成流程统一为：**提交任务 → 轮询 → 下载 → 落盘**。轮询间隔与最长等待时间可配；超过 `maxWaitMinutes` 会停止等待但远端任务可能仍在跑。

## 面板

- 描述（prompt，必填）、模型（留空用默认值）、时长、比例、高级项（负向提示 / 首帧图 URL / 种子）。
- 时长和比例只显示当前提供方支持的选项；不支持时自动隐藏。
- 任务卡显示状态、进度、耗时、prompt、文件大小与保存路径；完成后内嵌播放器。
- 操作：取消、重试、删除（连同文件）、复制路径、新标签打开。
- 任务队列持久化，宿主重启后未完成的任务标记为「中断」。

## 智能体工具

| 工具 | 用途 |
| --- | --- |
| `video_models` | 列出提供方、默认/建议模型、支持的时长与比例、Key 是否已配置 |
| `video_generate` | 提交生成，默认等待最多 120 秒（`waitSeconds`，上限 240），返回文件路径或任务 id |
| `video_jobs` | 列出最近任务或按 `id` 读取单个任务 |

面板与工具调用的是同一个服务方法，所以从聊天里发起的任务会出现在面板历史里，反之亦然。

## 文件与状态

- 成片：`<工作区>/videos/`（或 `config.outputDir`），文件名 `时间戳-提供方-任务短 id.mp4|webm`。
- 设置：`<DSH_HOME>/video-studio/settings.json`
- 任务队列：`<DSH_HOME>/video-studio/jobs.json`（最多保留 200 条）
- 密钥：Harness 凭据库（`ctx.credentials`），引用名 `AGNES_API_KEY` / `DSH_VIDEO_*`。Agnes 直接复用 `agnes` provider 已有的 `AGNES_API_KEY`，不必另填。

## HTTP 路由（面板用，仅本机）

所有路由要求：loopback socket、loopback Host 头、同源 fetch 标记。

```text
GET  /api/video-studio/state      设置 + 提供方状态 + 任务列表
POST /api/video-studio/settings   {settings?, apiKeys?, clearKeys?}
POST /api/video-studio/generate   生成请求
POST /api/video-studio/cancel     {id}
POST /api/video-studio/remove     {id, deleteFile?}
GET  /api/video-studio/media?id=  成片播放（支持 Range）
```

## 限制

- `agnes` 只有一个上游队列：返回 503 `video_queue_full` 时任务会停在「排队中」，插件每 20 秒重试提交、最长 10 分钟，队列一有空位就自动开始渲染；超过 10 分钟才把上游提示报出来，点「重试」可再来一轮。`agnes-video-2.5`（非 flash）按秒计费，余额为 0 时会返回 403 `insufficient_user_quota`；`agnes-video-2.5-flash` 当前限时免费。
- Agnes 的 `size` 固定 `720P`（Flash 只允许这个值）；`reference` 模式的参考图/参考音频暂未在面板里暴露，只用了 `text` 与 `keyframe` 两种模式。
- `sora` 适配器暂不支持首帧图；补上需要 multipart 上传，等有明确需求再加。
- `replicate` 的输入字段随模型而异，插件只发送 `prompt`(+`image`/`seed`)；不支持时会原样显示模型的 422 报错。
- 首帧图只接受 http(s) URL，不接收本地上传。
- 面板路由仅限本机访问（含远程 Web UI 场景），远端设备看不到成片。

## 文件结构

```text
video-studio/
  index.js            Host 入口：配置、凭据、路由与工具的装配
  client.js           浏览器入口：侧边栏行 + 主面板 + 设置弹窗
  lib/http.js         超时/取消/错误归一化的 HTTP helper
  lib/providers.js    agnes / sora / dashscope / replicate 适配器
  lib/studio.js       任务生命周期、轮询、下载落盘
  lib/store.js        设置与任务队列的原子持久化
  lib/routes.js       面板 HTTP 路由与同源校验
  lib/tools.js        智能体工具定义
  locale/*.json       Plugin Manager 显示用标题与描述
  icon.svg            插件图标
```

修改 **Host** 代码（`index.js` / `lib/*`）后：在插件管理里停用再启用该行即可重新加载；或重启 Harness。
修改 **Client** 代码（`client.js`）后：刷新页面。
