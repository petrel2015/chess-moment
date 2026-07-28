# 棋刻公众号双版本流水线设计

## 1. 总体架构

```text
content/*.json
  -> 内容与棋局校验
  -> 互动渲染器
       -> _site/index.html
       -> _site/<slug>.html
  -> 公众号渲染器
       -> _site/wechat/index.html
       -> _site/wechat/<slug>.html
       -> _site/wechat/assets/boards/<slug>.png
       -> _artifacts/wechat/<slug>.payload.json
  -> 微信发布适配器（dry-run / mock / production）
```

两套页面必须从同一个课程对象派生。公众号版不得保存另一份人工同步的
正文。

## 2. 公众号文章内容

每篇公众号文章至少包含：

- 日期、栏目、标题、摘要和预计阅读时长。
- 故事引入与文化背景。
- 当前局面的静态棋盘图、行棋方和训练目标。
- 明确的问题。
- 正确主线、每一步解释和常见错误。
- 完整复盘及可迁移原则。
- 指向同一期互动页的“阅读原文”行动提示。

答案和讲解必须保留在公众号正文中。互动页提供的是练习体验，不是被藏起来
的答案。

## 3. URL 规则

公开站点基址由 `PUBLIC_BASE_URL` 配置，默认：

```text
https://petrel2015.github.io/chess-moment/
```

每期 URL：

```text
互动页：<base>/<slug>.html
公众号预览：<base>/wechat/<slug>.html
公众号预览索引：<base>/wechat/
```

微信 payload 的 `content_source_url` 必须是该期互动页的绝对 URL。

## 4. 微信安全 HTML

公众号正文产物必须：

- 不包含 `script`、事件处理属性、表单、按钮、输入框或交互依赖。
- 使用受控的基础标签与内联样式。
- HTML 转义所有课程文本。
- 正文图片在 payload 中以本地资产引用描述，真实发布前由上传步骤替换为微信
  返回的 URL。
- 不依赖 GitHub Pages 的 CSS 或 JavaScript 才能读懂。

部署到 Pages 的公众号页面只是排版预览；真正发布时使用同一渲染器生成的
正文片段。

## 5. 静态棋盘

- 从课程 FEN 确定性生成 PNG，默认从当前行棋方视角展示。
- 图片必须包含坐标或在相邻文字中明确行棋方。
- 不通过远程截图服务生成。
- 相同 FEN 和主题应产生相同内容散列，便于缓存和去重。

## 6. 棋局校验

校验器必须使用真实棋规库而不是仅用正则表达式：

- FEN 可以被解析。
- 每个用户走法在当时局面合法。
- 对手回应在用户走法之后合法。
- 所有步骤能按顺序完整执行。
- slug、发布时间和最终 URL 唯一。
- 公众号正文能从课程字段完整派生。

## 7. 微信发布适配器

模块边界：

```text
token -> upload content images (multipart) -> upload cover (multipart add_material)
      -> add draft (JSON, thumb_media_id required) -> optional submit
      -> poll/callback result (numeric publish_status) -> durable record
```

真实微信 API 契约：

- `/media/uploadimg`：multipart/form-data 上传 `media` 文件字段，返回 `{ url }`。
- `/material/add_material?type=image`：multipart/form-data 上传永久封面素材，返回 `{ media_id }`，用于 `draft/add` 的 `thumb_media_id`。
- `/draft/add`：JSON 请求，`articles[].thumb_media_id` 必填；返回 `{ media_id }`。
- `/freepublish/submit`：JSON 请求 `{ media_id }`，返回 `{ publish_id }`。
- `/freepublish/get`：JSON 请求 `{ publish_id }`，返回 `publish_status`（数字）和
  `article_detail.item[0].article_url`。
- `publish_status` 数字含义：0 成功、1 发布中、2 原创失败、3 常规失败、4 审核不通过、
  5 成功后用户删除、6 成功后系统封禁。

运行模式：

- `dry-run`：只生成并校验请求，不联网。
- `mock`：对本地模拟微信服务器执行完整流程。
- `production`：只有显式配置后才能访问真实微信 API。

成功标准不是拿到 `publish_id`，而是最终状态为成功并取得文章 URL。提交成功、
发布成功和消息触达必须分别记录。

## 8. 状态、幂等与失败策略

幂等键：

```text
wechat:<publishedAt>:<slug>
```

状态至少记录：

- 内容散列、构建时间和互动 URL。
- 图片上传结果、草稿 media_id、publish_id。
- 最终状态、文章 URL、错误码、尝试次数和最后更新时间。

处理策略：

- 互动页不可访问：停止，不创建草稿。
- 参数或棋局错误：停止，不重试。
- 权限、认证或平台审核失败：停止并告警。
- 429、5xx 或网络超时：指数退避，有限次数重试。
- 已存在成功记录：直接返回已有结果，禁止重复发布。

## 9. 凭证与运行环境

- AppID 可通过环境注入；AppSecret 必须来自运行时秘密存储。
- 日志和错误消息必须遮蔽 token、secret 和请求头。
- 仓库、构建产物、测试快照均不得包含凭证。
- 本机运行依赖开机、联网和 Hermes Gateway；长期生产部署应使用稳定公网
  IP，并配置公众号 IP 白名单。

## 10. Hermes 调度

正式运行拆成两个有状态阶段：

```text
08:30 prepare
  生成/选择课程 -> 校验 -> 构建 -> 部署 -> HTTP 验证

09:00 publish
  读取已验证构建记录 -> 创建草稿/提交 -> 查询最终状态 -> 汇总
```

若 08:30 阶段没有产生“已验证可发布”记录，09:00 阶段必须安全退出。
