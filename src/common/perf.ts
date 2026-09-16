/**
 * 性能验收（Q-01）的前端半边：记下页面内的几个时刻与每条命令的往返耗时，首屏
 * 可交互时经 `perf:ready` 交给后端——打印集中在后端一处（`ORDO_PERF=1` 时才打），
 * 见 ARCHITECTURE §6.1。
 *
 * 时刻一律是 `performance.now()` 的绝对值，也就是**从导航开始**的毫秒数：这样
 * 「脚本加载 → 挂载 → 可交互」的每一段都能和后端的进程起点对上账。
 */

import { invoke } from "@tauri-apps/api/core";
import { COMMANDS } from "./ipc/commands";

interface PageMark {
  name: string;
  ms: number;
}

interface Samples {
  count: number;
  totalMs: number;
  maxMs: number;
}

// 本模块被 `index.tsx` 第一行引入，所以这个读数就是「导航 → 前端代码跑起来」。
const marks: PageMark[] = [{ name: "module", ms: performance.now() }];
const samples = new Map<string, Samples>();

/** 记下一个页面内的时刻（`shell-mounted` 之类）。 */
export function mark(name: string): void {
  marks.push({ name, ms: performance.now() });
}

/** 记下一次命令往返（IPC + 后端 + 响应反序列化）。 */
export function recordCommand(command: string, ms: number): void {
  const current = samples.get(command) ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += ms;
  current.maxMs = Math.max(current.maxMs, ms);
  samples.set(command, current);
}

/** 首屏可交互：把页面时间线与该阶段所有命令的耗时交回后端。 */
export function markInteractive(): void {
  mark("interactive");
  const commands = [...samples].map(([name, { count, totalMs, maxMs }]) => ({
    name,
    count,
    totalMs,
    maxMs,
  }));
  // 纯测量：没有返回值，失败了就当这次没量到，不该让用户看见错误。
  void invoke(COMMANDS.perf.ready, { report: { marks, commands } }).catch(() => {});
}
