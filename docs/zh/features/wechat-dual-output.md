# 微信公众号双输出（WeChat Dual Output）

## 概述

同一份课程 JSON 生成两种阅读形态：互动版（网站）与公众号版（纯文字 + 静态棋盘图 + 完整答案讲解）。公众号的「阅读原文」直达该期互动页，而非首页。构建同时产出结构化 payload 与凭据泄漏审计，发布器支持 dry-run 与 mock。

## 背景

项目的最初形态就是微信公众号每日推送（仓库名至今仍叫「国际象棋每日推送静态页面」）。公众号正文是受限的富文本环境：不能跑 JS、不能内嵌互动棋盘，读者却需要完整的解题体验。

## 问题

1. 若为公众号手工维护第二份课程文案，必然与网站版本漂移。
2. 公众号正文不能互动，答案必须直接写进正文（读者点开就是要看讲解的）。
3. 微信发布 API 需要 AppSecret 等凭据，绝不能进仓库。

## 目标

- 内容 JSON 是唯一来源；公众号版由确定性代码从同一份数据渲染。
- 公众号版自含有用性：静态棋盘图 + 完整答案与讲解，不把答案藏到「阅读原文」后面。
- 发布链路可测试：mock 服务器 + dry-run 模式，未经明确配置绝不调用真实微信 API。
- payload 里有凭据即构建失败（`auditPayload` 审计）。

## 不解决的问题

- 不做公众号排版美化器或第三方编辑器对接。
- 不做评论、消息回复等公众号运营功能。
- 不做自动定时发布（由维护者或自动化代理按流程触发）。

## 解决方案概述

`scripts/build-site.mjs` 每次构建为每期课程生成：

- `_site/wechat/<slug>.html`：公众号正文预览页（纯文字 + `_site/wechat/assets/boards/<slug>.png` 静态棋盘，pngjs 合成 480px）；
- `_artifacts/wechat/<slug>.payload.json`：结构化发布 payload（标题、正文 HTML、棋盘图、原文链接指向互动页），并通过 `auditPayload` 检查凭据泄漏，命中即构建失败。

发布适配器 `scripts/wechat-publish.mjs` 提供 `prepare / publish / status / retry / list` 子命令与状态持久化（`_artifacts/wechat/`，不提交）；`publish` 支持 `--mode dry-run`，`scripts/mock-wechat-server.mjs` 模拟微信 API 供测试。凭据从环境变量读取，仓库中不存在也不提交任何凭据文件。

## 兼容性与历史影响

该流水线与主站并行演进，2026-08-07 随 M2 合并（`9742e66`）共享同一内容源。对网站读者无任何影响——`_site/wechat/` 只是多出的静态预览目录。仓库根目录与 `_site` 中都保留了公众号预览页，便于不登录微信后台也能核对排版。

## 数据与隐私影响

发布时维护者自己的凭据通过环境变量进入发布器，不落盘、不提交。读者侧无新数据处理。

## 当前限制

- 公众号版面向维护者的运营流程，读者一般不会直接访问 `/wechat/` 预览。
- 真实微信 API 仅在维护者显式配置凭据后才会被调用；CI 与测试全部走 mock/dry-run。

## 发布信息

上线版本：Unreleased（2026-07-28）

状态：稳定

## 相关文档

- 设计与验收（维护者文档）：`doc/WECHAT_PIPELINE_DESIGN.md`、`doc/WECHAT_PIPELINE_ACCEPTANCE.md`、`doc/WECHAT_PIPELINE_PLAN.md`
- 命令参考：仓库根 [README](../../../README.zh.md) 与 `doc/HERMES_OPS_HANDBOOK.md`

## 功能变更记录

### 2026-07-28

首次上线：正文渲染器、棋盘 PNG、payload 审计、dry-run 发布器、mock 服务器。
