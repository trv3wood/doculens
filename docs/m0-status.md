# M0 当前验证状态

更新日期：2026-11-21。

## 已完成并有本地证据

- OpenCV 4.12.0 自定义构建成功，仅构建 `core/imgproc/js`。
- Emscripten 4.0.21，Podman 镜像 digest 与 `engine/BUILD_INFO.json` 一致。
- `engine/opencv.js`：64,175 bytes；`public/wasm/opencv.wasm`：3,019,344 bytes。
- 产物不含 `new Function(`、`eval(`、`importScripts(`；支持外部 `wasmBinary` 初始化。
- `/emsdk/upstream/bin/wasm-dis` 输出包含 `v128.store` 等 SIMD 指令，不只是构建参数声明。
- 主线程 DOM 与 Worker WebWorker 类型检查通过。
- Vitest：8 项通过（输入边界与 MApp 错误码）。
- 官方 packer 一致性矩阵：8 项通过。
- Chromium 实际执行测试覆盖：
  - 小图 classic Worker/WASM、灰度输出、JPEG/PNG/PDF 下载、PDF 单页比例和外部请求检查。
  - 4000×3000（12MP）全分辨率处理与 JPEG 导出。
  - 合成斜拍样本的纸边检测、手动调角、旋转、增强和 PDF 导出。
  - 自动启动、加载期间可以选图、首次加载失败后重试。
- M0 归档构建记录（当前发布包以 GitHub Release 为准）。
  - 应用版本：1.0.2
  - ZIP：1,558,576 bytes
  - 文件：10 个（含 Worker、WASM 与许可证）
  - SHA-256：`ccc184d81cfa2d8c87e7802ab137ce4e727499b51500059593e891ce05a12989`
  - `check_zip.mjs` 使用官方 packer 复验通过。

Bun 与 Node 的 zlib 实现可能产生不同压缩字节；两种路径的文件集与官方校验均通过，不能跨运行时期待相同 ZIP SHA-256。

## MApp 真机记录

2026-11-21 使用 Appium 和 XCUITest 在 iPhone 15 Pro Max（iOS 27.2）及 LINUX DO 1.0.5（构建 13）上完成开发版核心回归。沙箱构建为 `1.0.3-c0f22c6f`。后台 Worker 和 WASM 初始化、SmartDoc 裁切、12MP JPEG 处理、三种格式的系统保存、PNG/PDF 缓存复用、旋转后重新编码及保存权限拒绝均已验证。

### M0 历史记录

设备：iPhone 15 Pro Max / iOS 27.2。证据位于用户提供的 `/tmp/doculens` 日志和产物。

- SDK 首屏、文件选择、classic Worker、包内 WASM 初始化均成功。
- 3000×4000（12MP）处理成功，单次 OpenCV 灰度处理 58.7ms。
- 3024×4032（约 12.2MP）处理成功，单次处理 69.0ms，扩展范围警告正确。
- JPEG、PNG 有保存成功日志及产物；EXIF 方向只应用一次，导出不含原始 EXIF/GPS。
- 第一组 PNG 与原图亮度转换结果逐像素一致；JPEG 相对 PNG 平均像素误差约 0.505。
- 独立课表测试的 PDF 为单页，内嵌图像与页面比例一致。
- 系统分享已经微信实测送达。SDK 随后返回 `APP_UNLOADED`，不能据此判定未分享；1.0.2 已改为中性生命周期提示。

上述单次耗时不是 P50/P95 结论。第二组现有 960×1282 小图是 HEIC 原图的后续缩放/转存版本，不用于判断日志中 3024×4032 原始导出的分辨率。

## 尚未完成，不能宣称通过

- 当前构建的加载失败重试、PDF 页数与比例、系统分享复验，以及同一会话连续处理 5 个独立文档。
- 独立的至少 20 张实拍照片与四角真值，以及完整的 PSNR/SSIM 合成退化报告。已有 SmartDoc 样本的 21 帧初测和合成阴影单例。
- 每项至少 10 次的 P50/P95 性能、失败率和内存估算。
- F01–F09 完整产品流程。当前待补自然彩色、固定降噪与锐化预设、对齐原图比较。

真机逐项记录见 [m0-mapp-checklist.md](./m0-mapp-checklist.md)。
