# 更新日志

Ordo 的显著变更都记在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.0] - 2026-11-16

### 新增

- 应用内自动更新：启动 3 秒后与之后每 6 小时静默检查，发现新版本在主窗口左下角提示；点「更新」才下载、安装并重启。设置 → 通用底部显示当前版本和「检查更新」。开发构建不检查。
- 推送 `v*` tag 即由 GitHub Actions 校验版本号、构建 NSIS 安装包、签名并发布 `latest.json`。
- CI 三条门禁：push 到 `main` 和 pull request 自动跑 `vp check`、`vp test run`、`cargo test`。
- `LICENSE`（MIT）与本更新日志。

## 链接

[Unreleased]: https://github.com/hilariouhiss/Ordo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/hilariouhiss/Ordo/releases/tag/v0.2.0
