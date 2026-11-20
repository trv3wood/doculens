# M0 当前验证状态

更新日期：2026-11-21。

## 已完成并有本地证据

- OpenCV 4.12.0 自定义构建成功，仅构建 `core/imgproc/js`。
- Emscripten 4.0.21，Podman 镜像 digest 与 `engine/BUILD_INFO.json` 一致。
- `engine/opencv.js`：64,175 bytes；`public/wasm/opencv.wasm`：3,019,344 bytes。
- 产物不含 `new Function(`、`eval(`、`importScripts(`；支持外部 `wasmBinary` 初始化。
- `/emsdk/upstream/bin/wasm-dis` 输出包含 `v128.store` 等 SIMD 指令，不只是构建参数声明。
- 主线程 DOM 与 Worker WebWorker 类型检查通过。
- Vitest 输入边界测试：5 项通过。
- 官方 packer 一致性矩阵：8 项通过。
- Chromium 实际执行测试：2 项通过。
  - 小图 classic Worker/WASM、灰度输出、JPEG/PNG/PDF 下载、PDF 单页比例和外部请求检查。
  - 4000×3000（12MP）全分辨率处理与 JPEG 导出。
- 标准 Bun 路径调试包：`dist/package/app.zip`。
  - 应用版本：1.0.1
  - ZIP：1,557,978 bytes
  - 文件：10 个（含 Worker、WASM 与许可证）
  - SHA-256：`a6f8c4bff6faad624d44b74faa4798d817ad74fa5054fab774a792c6e85d931b`
  - `check_zip.mjs` 使用官方 packer 复验通过。

Bun 与 Node 的 zlib 实现可能产生不同压缩字节；两种路径的文件集与官方校验均通过，不能跨运行时期待相同 ZIP SHA-256。

## 尚未完成，不能宣称通过

- iPhone 15 Pro Max / iOS 27.2 的真实 MApp 硬门禁。
- 至少 20 张真实照片与四角真值、PSNR/SSIM 合成退化报告。
- P50/P95 性能、失败率、连续五张和内存估算。
- F01–F09 完整产品流程；当前只是灰度处理探针。

真实 MApp 测试步骤见 [m0-mapp-checklist.md](./m0-mapp-checklist.md)。
