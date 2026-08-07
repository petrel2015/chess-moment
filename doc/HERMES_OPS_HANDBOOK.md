# 棋刻公众号双版本流水线 Hermes 运行手册

本手册面向 Hermes Agent + GLM-5.2，无需理解实现细节即可操作。

## 前置条件

- Node.js 22+ 已安装
- 项目目录：`/Users/aquarist/Documents/公众号发布自动流水线/chess-moment`
- 当前分支：`main`
- `npm ci` 已执行（运行时依赖：chess.js、pngjs）

## 命令速查

```bash
cd /Users/aquarist/Documents/公众号发布自动流水线/chess-moment

# 1. 校验内容（棋规验证 + 字段检查）
npm run validate

# 2. 构建双版本（互动页 + 公众号预览 + 棋盘PNG + payload）
npm run build

# 3. 运行全部测试
npm test

# 4. 发布器 CLI
node scripts/wechat-publish.mjs prepare --slug <slug> [--check-url]
node scripts/wechat-publish.mjs publish  --slug <slug> --mode dry-run
node scripts/wechat-publish.mjs publish  --slug <slug> --mode mock --mock-url <url>
node scripts/wechat-publish.mjs status   --slug <slug>
node scripts/wechat-publish.mjs retry    --slug <slug> --mode <mode>
node scripts/wechat-publish.mjs list
```

## 两个阶段

### 阶段一：Prepare（08:30）

```bash
# 1. 确认内容校验通过
npm run validate

# 2. 构建双版本站点
npm run build

# 3. 验证互动页可访问（如果已部署到 Pages）
node scripts/wechat-publish.mjs prepare --slug <最新slug> --check-url
```

如果 `--check-url` 失败，说明互动页尚未部署到 GitHub Pages，**不得进入阶段二**。

### 阶段二：Publish（09:00）

只有阶段一产生"已验证可发布"的 payload 后才执行。

```bash
# Dry-run 模式（默认，不联网）
node scripts/wechat-publish.mjs publish --slug <slug> --mode dry-run

# Mock 模式（需要先启动 mock 服务器）
# 在另一个终端启动 mock 服务器：
node -e "import('./scripts/mock-wechat-server.mjs').then(m => { const {server,url} = m.startMockWechatServer(); server.listen(3000, () => console.log('Mock server:', url)); })"
# 然后发布：
node scripts/wechat-publish.mjs publish --slug <slug> --mode mock --mock-url http://127.0.0.1:3000
```

### Production 模式

**当前未配置凭证，禁止使用 production 模式。**

启用条件（尚未满足）：
1. 微信公众号 AppID 已配置
2. AppSecret 存储在运行时秘密存储（`WECHAT_APP_SECRET` 环境变量）
3. 服务器公网 IP 已加入公众号白名单
4. Hermes Gateway 已确认网络可达 `api.weixin.qq.com`

## 查询状态

```bash
# 查询单期发布状态
node scripts/wechat-publish.mjs status --slug <slug>

# 列出所有发布记录
node scripts/wechat-publish.mjs list
```

状态文件位置：`_artifacts/wechat/state/publish-state.json`

## 重试失败

```bash
# 重试瞬时错误（429/5xx/网络超时）导致的失败
node scripts/wechat-publish.mjs retry --slug <slug> --mode <mode>
```

**不可重试的错误类型：**
- `AUTH_ERROR`：认证失败，检查 AppID/AppSecret
- `PERMISSION_DENIED`：权限不足，检查公众号类型和接口权限
- `AUDIT_FAILED`：内容审核未通过，修改内容后重新 prepare
- `INVALID_CONFIG`：配置错误，检查参数

## 失败诊断

发布器输出结构化诊断，包含：

| 字段 | 说明 |
|------|------|
| `final_status` | `success` / `failed` / `dry_run_validated` / `in_progress` |
| `error_code` | `AUTH_ERROR` / `PERMISSION_DENIED` / `AUDIT_FAILED` / `TRANSIENT_ERROR` / `POLL_TIMEOUT` / `INVALID_CONFIG` |
| `error_message` | 人类可读的错误描述 |
| `stages` | 各阶段状态：token / upload_images / upload_cover / add_draft / submit_publish / poll_result |
| `attempts` | 总尝试次数 |
| `summary` | 一行人类可读汇总 |

### 判断错误类型

| error_code | 含义 | 处理 |
|------------|------|------|
| `AUTH_ERROR` | 认证失败 | 检查 AppID/AppSecret，**不可重试** |
| `PERMISSION_DENIED` | 权限不足 | 检查公众号类型和接口权限，**不可重试** |
| `AUDIT_FAILED` | 内容审核失败 | 修改内容后重新 prepare，**不可重试** |
| `TRANSIENT_ERROR` | 429/5xx/网络超时 | 可重试 |
| `POLL_TIMEOUT` | 发布状态轮询超时 | 检查网络，可重试 |
| `INVALID_CONFIG` | 配置错误 | 修复配置，**不可重试** |

## 幂等性

- 幂等键格式：`wechat:<publishedAt>:<slug>`
- 同一幂等键重复执行不会创建第二份草稿或第二次发布
- 已存在成功记录时，直接返回已有结果

## Cron 示例（不创建生产任务）

以下为示例格式，**当前不创建任何生产定时任务**：

```yaml
# 阶段一：08:30 prepare
schedule: "30 8 * * *"
prompt: "执行棋刻 prepare：npm run validate && npm run build && node scripts/wechat-publish.mjs prepare --slug <slug> --check-url"

# 阶段二：09:00 publish（仅 dry-run）
schedule: "0 9 * * *"
prompt: "执行棋刻 publish：node scripts/wechat-publish.mjs publish --slug <slug> --mode dry-run"
```

## 新增依赖说明

| 依赖 | 版本 | 用途 |
|------|------|------|
| chess.js | ^1.4.0 | 真实国际象棋规则校验：FEN 解析、走法合法性验证、将军/将死判定 |
| pngjs | ^7.0.0 | 棋盘 PNG 生成：像素级合成棋子素材，支持从行棋方视角翻转 |

## 安全约束

- 仓库不保存 AppSecret、access token、Cookie 或任何凭证
- 日志和错误消息自动遮蔽 token、secret 和请求头
- payload 经过自动审计，确保不含本机绝对路径或凭证
- dry-run 模式不发起任何网络请求
- production 模式需要显式配置，默认禁止
