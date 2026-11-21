# DocuLens

**Privacy-first document scanning and enhancement, right in your browser.**

DocuLens 是一款面向 Linux.do MApp 的轻量级文档扫描工具。无需安装 App、无需上传照片，即可将手机拍摄的纸质文档转换为规整、清晰、易于分享的扫描件。

## 核心功能

- **智能裁剪**：自动检测文档边界，支持手动调整四角。
- **透视矫正**：将倾斜拍摄的纸张校正为矩形文档。
- **图像增强**：对纸面做光照均衡，减轻拍摄阴影。
- **扫描模式**：去阴影、灰度、黑白。
- **单页导出**：支持 JPEG、PNG 和单页 PDF 保存，系统分享为增强能力。
- **隐私优先**：所有图像处理均在浏览器本地完成，不上传原始图片。

## 使用方法

1. 打开 DocuLens 后可立即选照片，扫描引擎会在后台加载。加载失败时，点击「重试加载」即可继续，已选照片会保留。
2. 点击「生成扫描件」。可在原图上拖动四角、旋转或重新找纸边，手动修角后点击「更新扫描件」。
3. 确认扫描结果，选择 JPEG、PNG 或单页 PDF 后保存。MApp 授权分享时会显示「分享」。

## 技术栈

| 模块 | 技术 |
|---|---|
| 前端 | TypeScript、Vite |
| 图像处理 | OpenCV.js / WebAssembly |
| WASM 构建 | Emscripten、SIMD |
| 后台计算 | Web Worker |
| 图像显示 | Canvas 2D |
| PDF 导出 | pdf-lib |
| 平台集成 | Linux.do MApp SDK |

采用双分辨率处理：低分辨率交互预览，高分辨率最终导出。图像处理核心独立于 UI 和 MApp SDK。

## 开发与状态

[1.0.3](https://github.com/trv3wood/doculens/releases/tag/v1.0.3) 已由用户在 MApp 真机试用。开发版已通过 MApp 真机核心回归，覆盖后台初始化、12MP 扫描、JPEG/PNG/PDF 保存和导出缓存。测试环境与待测项见 [MApp 检查清单](./docs/m0-mapp-checklist.md)。

效果评价使用带参考真值的 PSNR、SSIM，不做 OCR/CER。真机验收环境为 iPhone 15 Pro Max / iOS 27.2 的 MApp；独立移动浏览器只用于开发诊断。

详细范围与验收口径见 [SPEC.md](./SPEC.md)，OpenCV 构建见 [engine/README.md](./engine/README.md)。

## 本地开发

```sh
source ~/.bashrc
bun install --frozen-lockfile
bun run dev
```

开发服务器位于 `http://127.0.0.1:5191`。

```sh
bun run typecheck
bun run test
bun run conformance
bun run build:debug
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