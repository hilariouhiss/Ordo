import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [tailwindcss(), solid()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // 3. 客户端首个请求到达前，先在服务端把整张模块图转好。
    //
    // `@kobalte/core` / `lucide-solid` / `@tanstack/solid-router` 在 `solid`
    // condition 下解析到的是**未编译的 .jsx 源码**，而 Vite 的依赖预打包只认
    // `\.[cm]?[jt]s$`（OPTIMIZABLE_ENTRY_RE），所以这三个包永远进不了 deps 缓存：
    // dev 会把它们按 173 个独立模块逐个发给浏览器（kobalte 51、lucide 47、
    // router 75），加上 src 里的 55 个，冷启动要 ~15 s 才画出第一帧——那之前窗口
    // 是空的。`optimizeDeps.include`/`extensions` 都救不了：前者被跳过
    // （Cannot optimize dependency），后者会把未编译的 JSX 塞进 deps，dev server 500。
    //
    // `warmupRequest` 顺着 import 分析递归，所以预热入口一次 = 整张图先在服务端
    // 转好，浏览器那边全是缓存命中。这段时间与 `cargo build` 重叠，用户看不见。
    warmup: {
      clientFiles: ["./src/index.tsx"],
    },
    watch: {
      // 4. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
