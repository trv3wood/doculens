# DocuLens

**Privacy-first document scanning and enhancement, right in your browser.**

DocuLens 是一款面向 Linux.do MApp 的轻量级文档扫描工具。无需安装 App、无需上传照片，即可将手机拍摄的纸质文档转换为规整、清晰、易于分享的扫描件。

## 核心功能（目标）

- **智能裁剪**：自动检测文档边界，支持手动调整四角。
- **透视矫正**：将倾斜拍摄的纸张校正为矩形文档。
- **图像增强**：去阴影、亮度均衡、对比度增强、降噪和锐化。
- **扫描模式**：自然彩色、增强、黑白。
- **单页导出**：支持 JPEG、PNG 和单页 PDF 保存，系统分享为增强能力。
- **隐私优先**：所有图像处理均在浏览器本地完成，不上传原始图片。

## 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | TypeScript、Preact、Vite |
| 图像处理 | OpenCV.js / WebAssembly |
| WASM 构建 | Emscripten、SIMD |
| 后台计算 | Web Worker |
| 图像显示 | Canvas / OffscreenCanvas |
| PDF 导出 | pdf-lib |
| 平台集成 | Linux.do MApp SDK |

采用双分辨率处理：低分辨率交互预览，高分辨率最终导出。图像处理核心独立于 UI 和 MApp SDK。

## 开发与状态

项目目前处于 **M0 可行性验证阶段**，首阶段目标是三项 PoC 与 F01–F09 的单页扫描闭环。

优先验证真实 MApp 中的文件导入、受控 classic Worker、自定义 OpenCV WASM SIMD、内存占用与文件保存。关键宿主链路未通过前，不展开完整 P0 界面。

效果评价使用带参考真值的 PSNR、SSIM，不做 OCR/CER。真机验收环境为 iPhone 15 Pro Max / iOS 27.2 的 MApp；独立移动浏览器只用于开发诊断。

详细范围与验收口径见 [SPEC.md](./SPEC.md)，OpenCV 构建见 [engine/README.md](./engine/README.md)。

## 本地开发

```sh
source ~/.bashrc
bun install --frozen-lockfile
bun run dev
```

开发服务器位于 `http://127.0.0.1:5191`。当前页面是 M0 探针，不是完整扫描产品。

```sh
bun run typecheck
bun run test
bun run conformance
MINI_APP_VERSION=1.0.1 bun run build:debug
```

当前 Ubuntu 26.04 环境安装和运行 Playwright 时需要显式使用兼容平台标识：

```sh
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 bunx playwright install chromium
NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 bun run test:e2e
```

自定义 OpenCV 通过 Podman 重建：

```sh
DOCULENS_BUILD_JOBS=6 bash engine/build.sh
```

真实 MApp 验收步骤见 [M0 硬门禁清单](./docs/m0-mapp-checklist.md)。桌面测试通过不等于真实 MApp 通过。

## 隐私

DocuLens 不提供服务端图像处理。用户文档的解码、编辑和导出均在本地进行。

## License

MIT