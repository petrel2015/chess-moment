# 棋刻公众号双版本流水线验收标准

以下项目全部通过后才允许发布到 GitHub Pages。

## A. 回归与内容正确性

- [ ] 原有课程数量不少于 5，原互动页均可继续生成。
- [ ] 原有点击走棋、拖动走棋、红绿反馈、复盘和术语帮助没有被移除。
- [ ] FEN 和每一步用户/对手走法由真实棋规库顺序验证。
- [ ] 错误课程能输出包含文件名、字段或步骤号的诊断。
- [ ] slug 唯一，publishedAt 唯一（不只是 slug+publishedAt 组合唯一）。
- [ ] `npm test`、内容校验、构建和 JavaScript 语法检查全部成功。

## B. 双版本生成

- [ ] 每一期 JSON 恰好生成一个互动页和一个公众号预览页。
- [ ] `_site/wechat/index.html` 能访问全部公众号预览。
- [ ] 每一期生成一张有效 PNG 静态棋盘图，使用 assets/pieces 真实棋子素材。
- [ ] 棋盘 PNG 从当前行棋方视角展示（黑方走棋时翻转）。
- [ ] 公众号预览包含引入、文化背景、棋盘、问题（challenge.title + instruction）、
      答案、逐步解释、常见错误、复盘和迁移原则。
- [ ] 公众号预览在答案前明确展示 challenge.title 和 instruction 作为问题。
- [ ] 公众号正文自身完整，不要求跳转后才能看到答案。
- [ ] 公众号预览底部有可点击的同 slug 互动链接。
- [ ] `publish:root` 将 `_site/wechat/**` 和棋盘 PNG 幂等同步到仓库根目录。
- [ ] “阅读原文”指向同一 slug 的绝对互动 URL，而不是首页。

## C. 微信正文安全

- [ ] 公众号正文不含 `script`、`iframe`、`form`、`button`、`textarea`、
      `input`、`onclick` 等事件属性。
- [ ] 所有用户可控文本经过 HTML 转义。
- [ ] 正文不依赖外部 JavaScript 或 CSS 才能理解。
- [ ] payload 不含本机绝对路径、AppSecret、access token 或 Cookie。

## D. 发布器可靠性

- [ ] `dry-run` 默认启用且不会访问真实微信域名。
- [ ] 本地 mock 覆盖 token、图片、封面、草稿、提交和最终状态查询完整链路。
- [ ] mock 服务器校验 multipart/form-data 契约（uploadimg 和 add_material）。
- [ ] `draft/add` 必须携带 `thumb_media_id`（来自 `add_material` 上传的永久封面）。
- [ ] 正文本地棋盘 `src` 必须替换为 `uploadimg` 返回的微信 URL。
- [ ] `freepublish/get` 的 `publish_status` 按数字处理（0-6），`article_url` 从
      `article_detail.item[0].article_url` 取得。
- [ ] 测试证明 `publish_id` 返回后仍会等待最终成功状态。
- [ ] 测试覆盖审核失败、权限失败、429/5xx 重试和网络超时。
- [ ] fetch 请求有可配置超时（AbortController），超时后重试并最终失败。
- [ ] 同一幂等键重复执行不会创建第二份草稿或第二次发布。
- [ ] 同一幂等键并发执行有锁保护，不会创建重复草稿。
- [ ] state 保存使用临时文件 + rename 原子写。
- [ ] 日志提供结构化阶段、状态、错误码、尝试次数和可读汇总。
- [ ] `isRealWechatUrl` 使用 `URL.hostname` 精确判断，不接受包含域名的仿冒 URL。
- [ ] AppSecret 不出现在 CLI 参数文档中，只允许环境变量或秘密存储。

## E. 移动端与公开页面

- [ ] 在 375px 视口下，互动页无横向溢出并可完成至少一期全部走法。
- [ ] 在 375px 视口下，公众号预览文字、棋盘和“阅读原文”提示清晰可读。
- [ ] 首页、公众号预览索引、至少一期公众号预览和对应互动页均返回 HTTP 200。
- [ ] 页面中的 CSS、JavaScript、棋子图片和棋盘 PNG 均返回 HTTP 200。

## F. Hermes 可维护性

- [ ] 提供无需理解实现细节即可运行的 Hermes 操作手册。
- [ ] 提供 prepare、publish、status 和 retry-failed 的明确入口。
- [ ] 失败输出足够让 Hermes 判断：内容错误、部署错误、权限错误、平台审核
      错误或瞬时网络错误。
- [ ] 提供 08:30 prepare 与 09:00 publish 的 cron 示例，但在凭证未配置前
      不创建生产任务。
- [ ] 新依赖数量有限，并在文档中说明用途。

## G. 发布门槛

- [ ] 工作树只有本任务相关改动。
- [ ] 不存在明文凭证或不应提交的生成状态。
- [ ] GitHub Pages 构建成功。
- [ ] 公开页面经过真实 HTTP 请求验证，而不是仅凭本地构建推断成功。
