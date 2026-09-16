# Ordo

一个 **local-first、单用户**的桌面任务 + 项目管理器。快速捕获 → 清晰组织 → 直观看进度，全程离线、响应快、体积小。

Tauri 2（Rust 后端 + 系统 WebView）与 SolidJS + TypeScript 前端；数据落在本机 SQLite，不需要账号与网络。

## 快速开始

```bash
pnpm install
pnpm tauri dev      # 完整应用（Vite 开发服务器 + Rust 窗口）
```

只调前端时用 `pnpm dev`（浏览器打开 `http://localhost:1420`，此时没有后端，IPC 调用会失败）。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm tauri dev` / `pnpm tauri build` | 开发运行 / 发布构建 |
| `pnpm dev` / `pnpm build` / `pnpm serve` | 前端开发服务器 / 构建 / 预览 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest 单元测试（`pnpm test:watch` 为 watch 模式） |
| `cargo test` / `cargo fmt` / `cargo clippy --all-targets -- -D warnings` | 在 `src-tauri/` 内执行 |

包管理器固定为 **pnpm**。完整的工程约定与踩坑清单见 [AGENTS.md](./AGENTS.md)。

## 文档

| 文件 | 回答的问题 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 这是什么、该读哪一份、术语表 |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | 用户看到什么、能做什么 |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 代码长什么样、为什么这么分层 |
| [docs/DATA.md](./docs/DATA.md) | 数据存在哪、长什么字段、迁移与备份 |
| [docs/DECISIONS.md](./docs/DECISIONS.md) | 为什么是这样、编号含义、还差什么 |

文档描述**现状**（以代码为准），不记录计划与施工台账。
