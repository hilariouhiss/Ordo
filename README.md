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

## 装好后逐条打勾

装一次安装包，然后按顺序走一遍，每条都过了才算能日常用。

- [ ] 安装包双击安装，不报错
- [ ] 从开始菜单启动，窗口正常显示
- [ ] 提醒弹出来时，标题是任务名，图标是 ordo
- [ ] 点提醒，主窗口到前台，并且直接打开那条任务的浮层
- [ ] 托盘右键：打开 ordo / 本周 / 过一遍 / 设置 / 退出，五项都能用
- [ ] 第一次点关闭：窗口收起但没退出，并弹一条“还在托盘运行”的提示；第二次关闭不再提示
- [ ] 全局快捷键（默认 Ctrl+Alt+O）呼出迷你窗口，再按一次收起
- [ ] 中文输入法选词时按回车只是选词，不会把任务提交掉
- [ ] 过一遍里按 E 打开任务浮层，拆成两步，关掉浮层后卡片还停在原处
- [ ] 杀进程后重启，同一条提醒不会重复弹

## 几个约定

- 数据在 `%APPDATA%/com.ordo.app/ordo.db`，每天自动备份到 `backups/`，可手动导出 JSON。
- 数据库文件坏了不会静默重建：先把坏文件存成 `ordo.db.corrupt-<时间戳>`，再从 `backups/` 里最新的一份恢复；没有备份就报错退出，什么都不删。
- 全局快捷键默认 `Ctrl+Alt+O`，呼出迷你窗口；在设置里可改。
- AI 补字段走 DeepSeek（OpenAI 兼容），key 存在 Windows 凭据管理器；不填 key 就不联网。
- 设计文档：`docs/superpowers/specs/`，实现计划：`docs/superpowers/plans/`。
