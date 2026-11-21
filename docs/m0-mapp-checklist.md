# M0 真实 MApp 硬门禁清单

**状态：开发版已通过 MApp 真机核心回归。待补加载失败重试、连续处理和多轮性能采样。**

基准设备：iPhone 15 Pro Max / iOS 27.2。只验收真实 MApp 沙箱，不用桌面 Playwright 结果替代。

## 构建与上传

```sh
bun run build:debug
```

上传且只上传 `dist/package/app.zip`。记录沙箱构建标识和 MApp 宿主版本。

## 运行发布前回归脚本

在 Mac 上启动 Appium，安装 XCUITest 驱动，并确认 iPhone 已解锁、信任此 Mac 和 WebDriverAgent 开发证书。手机上的 LINUX DO 需登录有沙箱预览权限的账号，系统及应用界面使用简体中文。使用 Xcode 自动签名时可通过 `--team` 和 `--wda-bundle-id` 传入开发团队和专用测试助手标识。

准备以下两个测试文件，并各自在 iPhone 的「文件」中打开一次，让它们出现在「最近项目」。

- `datasheet001-02.png` 是 SmartDoc 1920×1080 实拍样本。
- 在仓库根目录生成 4000×3000 合成测试 JPEG。需要安装 Bun，转换步骤使用 macOS 的 `sips`。

```sh
bun -e 'import { createPng } from "./tests/fixtures"; await Bun.write("/tmp/doculens-test-12mp.png", createPng(4000, 3000))'
sips -s format jpeg /tmp/doculens-test-12mp.png --out /tmp/doculens-test-12mp.jpg
```

确认运行的沙箱已就绪，然后执行：

```sh
python3 scripts/test-mapp-device.py --sandbox "$MAPP_SANDBOX_URL" --udid "$MAPP_DEVICE_UDID"
```

如果 iOS 给测试文件添加了序号，用 `--jpeg-fixture 'doculens-test-12mp 3, jpg'` 指定系统文件选择器中的名称。脚本只在「最近项目」选择指定文件，保存使用带时间戳的独立文件名。每次运行输出报告目录和测试日志。若 XCUITest 提示 `Not authorized for performing UI testing actions`，请先在已解锁的 iPhone 上通过 Xcode 确认 WebDriverAgent 可以启动，再运行脚本。

新版调试包会记录 PDF 页数、页面尺寸和宽高比。脚本读取该日志，自动核对页数和页面比例。若要独立检查实际保存的 PDF，请先安装项目依赖，并用 `--pdf-dir` 指定 Mac 上与 iPhone 保存位置同步的目录。运行时请确保 iPhone 的系统保存对话框默认目录与该同步目录对应。未传入参数时，脚本会提示实际文件的独立检查仍待完成。另需目视检查 SmartDoc 裁切没有误裁正文、旋转后方向正确。选图控件只在扫描处理中禁用；加载期间可选图的时序由 Chromium 延迟加载用例覆盖。

2026-11-21，脚本在沙箱 `1.0.3-c0f22c6f` 完成真机试跑。12MP 扫描、SmartDoc 裁切、PNG/PDF 复用、拒绝后重新保存、旋转后重新编码通过。在 iPhone「文件」中核对了 `doculens-regression-20261121-141146` 的 JPG、PNG 和 PDF。本次未指定同步目录，PDF 页数与比例仍待核对。

## 2026-11-21 自动化真机复验

- 环境为 iPhone 15 Pro Max / iOS 27.2，LINUX DO 1.0.5（构建 13），通过 USB 使用 Appium 4.0.0 和 XCUITest 驱动 13.5.0。
- 测试代码为 `d1d614f`，[沙箱构建 1.0.3-c0f22c6f](https://linux.do/apps-sandbox/01a1f801-1869-7a35-a7a2-b72ae4d4d7f8/1.0.3-c0f22c6f)。调试 ZIP 的 SHA-256 为 `c0f22c6fd996dddea346f002377e7a8a78eae710cc67b6264c0f76d7ff7c9d0c`。
- 首屏显示选图入口，classic Worker 在后台完成包内 OpenCV WASM 初始化。两次日志分别记录 18.0 ms 和 31.0 ms。
- SmartDoc 实拍样本 `datasheet001-02.png` 从 1920×1080 裁切为 543×593，首次 Worker 处理 55.0 ms。合成 12MP JPEG 的 Worker 处理为 125.0 ms，未检测到完整纸边，输出保留 4000×3000。
- SmartDoc 样本的 `doculens-scan.jpg`、`doculens-scan.png`、`doculens-scan.pdf` 均在 iPhone「文件」中查到。初次导出分别为 72,875、175,347 和 179,352 字节。再次切回 PNG 和 PDF 时日志显示「复用导出文件」，旋转后重新准备的 PDF 为 197,338 字节。
- 取消「保存文件」授权后显示「保存失败：USER_CANCELLED」。

以上为单次或两次的观察值。当前沙箱构建尚未验证加载失败后重试、PDF 页数和比例、系统分享、同一会话连续处理 5 张，以及多轮性能。

## 逐项验收

| 项目 | 操作与通过条件 | 结果 |
|---|---|---|
| SDK 首屏 | 打开后可进入系统选图器，选图后可开始扫描 | 当前首屏与选图后扫描通过 |
| 文件选择 | 选择一张 12MP JPEG，能显示文件名与大小 | 通过 |
| classic Worker | 打开应用后后台启动，无需点击初始化 | 当前构建后台启动通过 |
| 加载重试 | 加载失败时显示「重试加载」，重试后仍能处理之前选中的照片 | Chromium 通过，MApp 待测 |
| 包内 WASM | 无远程请求，WASM 编译/实例化成功 | 当前构建初始化通过；无远程请求为历史验证 |
| SIMD | 保存初始化日志和构建信息；不能用构建参数代替宿主支持证据 | 通过（真机执行成功，构建含 SIMD 指令） |
| 12MP 处理 | 检测不到完整纸边时保留原尺寸，检测成功时按纸边裁切 | 当前构建 4000×3000 通过；历史样本为 3000×4000 和 3024×4032 |
| JPEG 保存 | 等「保存扫描件」可用后点击，系统保存成功 | 通过（有保存日志与产物） |
| PNG 保存 | 切换 PNG，重新准备后保存成功 | 通过（有保存日志与产物） |
| 单页 PDF 保存 | 切换 PDF，重新准备后保存成功；页面比例与图像一致 | 当前 PDF 产物已确认；单页与比例由历史课表样本验证 |
| 系统分享（增强） | 分享面板可用；失败不阻断保存门禁 | 历史通过（微信实测送达；SDK 返回 `APP_UNLOADED`，已改为中性生命周期提示），当前构建未复验 |
| 权限拒绝 | 拒绝保存时显示明确错误，不静默改成下载或分享 | 当前构建通过（`USER_CANCELLED`） |
| 连续处理 | 同一会话连续处理 5 个独立文档不崩溃 | 未测 |

## 失败时返回的信息

复制状态提示，再展开「诊断日志」复制相关记录，并注明：

1. 失败发生在文件选择、Worker 创建、WASM 初始化、处理、编码还是系统保存。
2. 完整错误名、错误码、iOS 与 MApp 版本。
3. 是否每次都可复现，桌面同一构建是否通过。

任一“文件选择 → Worker → WASM → 12MP 处理 → JPEG/PNG/PDF 保存”关键环节失败，即暂停 M1 扩展开发并协商，不启用主线程、原生 MApp Worker、`code.eval` 或远程资源兜底。

## 性能记录

每个场景至少 10 次有效测量，另起表记录 P50、P95、失败次数和内存估算。P50 对照 SPEC，P95 不隐藏；分别记录首屏可选图、引擎可处理、WASM 初始化和系统保存时间。
