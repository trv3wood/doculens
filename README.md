# DocuLens

**Privacy-first document scanning and enhancement, right in your browser.**

DocuLens 是一款面向 Linux.do MApp 的轻量级文档扫描工具。无需安装 App、无需上传照片，即可将手机拍摄的纸质文档转换为规整、清晰、易于分享的扫描件。

## 核心功能

- **智能裁剪**：自动检测文档边界，支持手动调整四角。
- **透视矫正**：将倾斜拍摄的纸张校正为矩形文档。
- **图像增强**：去阴影、亮度均衡、对比度增强、降噪和锐化。
- **扫描模式**：自然彩色、增强、黑白。
- **多页导出**：支持 JPEG、PNG 和 PDF。
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

项目目前处于**可行性验证阶段**。

优先验证移动浏览器中的图像解码、透视矫正、图像增强、内存占用与性能，再开发完整产品。

## 隐私

DocuLens 不提供服务端图像处理。用户文档的解码、编辑和导出均在本地进行。

## License

MIT