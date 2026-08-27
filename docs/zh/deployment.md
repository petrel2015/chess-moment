# 部署指南

棋刻部署在 GitHub Pages，由 GitHub Actions 自动构建发布。

## 线上地址

- 主站（中文）：<https://petrel2015.github.io/chess-moment/>
- 英文版：<https://petrel2015.github.io/chess-moment/en/>

## 发布流程

部署 workflow 为 [.github/workflows/pages.yml](../../.github/workflows/pages.yml)：

1. 触发：推送受部署分支，且改动涉及 `content/`、`scripts/`、`assets/`、`tests/`、`package.json`、package-lock 或 workflow 自身（纯文档改动不触发部署）；也支持在 Actions 页手动触发（workflow_dispatch）。
2. 构建：`npm ci → npm test → npm run build`——测试失败或校验失败都会阻止发布。
3. 部署：`_site/` 目录通过 `actions/upload-pages-artifact` + `actions/deploy-pages` 发布。
4. 并发控制：`concurrency: pages` 组内取消进行中的旧部署，避免乱序覆盖。

## 首次启用 / 切换 Pages 模式

workflow 使用 Actions 构建产物模式。若仓库 Pages 设置此前是「从分支部署」（legacy），需要在仓库 **Settings → Pages → Build and deployment → Source** 切换为 **GitHub Actions**；也可以用 API：

```bash
gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

仓库根目录的 `.nojekyll` 用于禁用 Jekyll 处理；`_site/` 构建时也会自带一份。

## 本地验证发布内容

```bash
npm test && npm run build
python3 -m http.server 8000 --directory _site
```

注意 Pages 站点部署在子路径 `/chess-moment/` 下：站点内全部资源引用均为相对路径，构建产物在子路径下可直接工作；本地预览用根路径即可，不影响结果。

## 常见部署问题

- **推送后没有部署**：检查改动路径是否命中 workflow 的 `paths` 过滤；文档（`docs/`、`*.md`）改动不触发部署。
- **部署成功但页面 404**：确认访问的是 `/chess-moment/` 前缀；`index.html` 位于 `_site/` 根。
- **AI 教练 Worker 路径**：如需启用可选的 Worker 代理，把 Worker URL 配置为仓库 secret `CHESS_COACH_WORKER_URL`，构建时自动注入（见[配置指南](./configuration.md)）。

## 与根目录 HTML 的关系

仓库根目录也提交了一份生成的互动页 HTML（`npm run publish:root` 的产物），用于兼容早期「Pages 从分支根目录直出」的托管模式。切换到 Actions 模式后，线上内容以 `_site/` 构建产物为准；根目录 HTML 保留作为直出兜底。
