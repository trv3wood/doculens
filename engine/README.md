# DocuLens OpenCV 引擎

- OpenCV：4.12.0，固定源码提交。
- Emscripten：4.0.21，固定 amd64 镜像 digest；默认通过 Podman 构建并继承代理环境。
- 仅导出扫描所需的 `core` / `imgproc` 绑定，包含频域增强所需的 `dft` 与 `getOptimalDFTSize`。
- 单线程、SIMD128、外部 WASM、`wasmBinary` 延迟初始化。
- 禁用动态执行、文件系统、pthreads 和远程脚本加载。

重新构建：

```sh
bash engine/build.sh
# 本机编译资源紧张时：
DOCULENS_BUILD_JOBS=3 bash engine/build.sh
```

`build.sh` 使用 `.cache/` 中的源码和 `engine/build/` 中的临时构建树，
两者均不提交。最终跟踪的产物为 `engine/opencv.js`、
`public/wasm/opencv.wasm`、`public/licenses/opencv.txt` 和 `BUILD_INFO.json`。

使用的是 `bin/opencv_js.js` 原始 modularized factory，而不是会自动执行
`cv(Module)` 的 UMD 包装。应用在 MApp 首屏就绪后异步读取包内 WASM 并启动 Worker。Worker 收到初始化消息后才调用 factory，处理任务在引擎就绪后提交。
`finalize.py` 会拒绝包含 `new Function`、`eval` 或 `importScripts` 的产物。
