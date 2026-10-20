# ordo

个人任务账本：一句话捕获、每周过一遍、按专业看项目进度、延期有据可查、归档可恢复、到点会提醒。桌面应用（Tauri 2 + Vue 3），数据只在本机。

## 跑起来

```bash
vp install
pnpm tauri dev        # 桌面应用（含 Rust）
vp dev                # 只跑前端（浏览器里，无 IPC）
```

## 检查

```bash
vp check              # 格式 + lint + 类型
vp test run           # ViewModel 测试
cd src-tauri && cargo test
```

## 打包

```bash
pnpm tauri build
```

## 几个约定

- 数据在 `%APPDATA%/com.ordo.app/ordo.db`，每天自动备份到 `backups/`，可手动导出 JSON。
- 全局快捷键默认 `Ctrl+Alt+O`，呼出迷你窗口；在设置里可改。
- AI 补字段走 DeepSeek（OpenAI 兼容），key 存在 Windows 凭据管理器；不填 key 就不联网。
- 设计文档：`docs/superpowers/specs/`，实现计划：`docs/superpowers/plans/`。
