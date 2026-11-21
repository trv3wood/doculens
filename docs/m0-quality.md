# M0 扫描质量基线

样本来自 ICDAR 2015 SmartDoc Challenge 1，使用数据作者发布的 [v2.0.0 帧归档](https://github.com/jchazalon/smartdoc15-ch1-dataset/releases/tag/v2.0.0)。原始数据由 Burie 等人发布，采用 CC BY 4.0。 [数据与署名](https://zenodo.org/records/1230218)

## 几何质量

从 background01 选 24 个独立文档，每类使用编号 002–005，每个取带标注序列的中间帧。选帧不使用检测结果；此前用于调参的编号 001 已排除。绿色边框为数据集作者的真值，橙色为检测结果。用户指出的 14 张样本经核对均为漏检。绿色真值坐标未收到更正，沿用数据集标注。

同一 Worker 产物在桌面 Chrome 中运行。归一化角点误差是四个角的平均欧氏距离除以输入图像对角线，允许循环对齐角点起点。未检出计入检出率，角点误差仅对有结果的帧计算。IoU 为预测与真值四边形的交集面积除以并集面积，漏检的 IoU 记为 0。

- 检出 10/24（41.7%），其余 14 张走保留整图路径。检出样本的平均误差为 0.162%，中位数 0.166%，最大 0.249%。
- 检出样本的平均 IoU 为 98.30%，全样本平均 IoU 为 40.96%。
- 初步目视检查中，`letter005` 输出保留正文，`datasheet003` 未检出，输出保留桌面和文档。完整对照图由评估脚本生成。
- 样本集中在同一背景和一个帧位，不能代表全部 SmartDoc 场景。检出的角较准确，但实际使用仍需保留手动调角入口。

| 文档 | 帧 | 归一化角点误差 | IoU |
|---|---:|---:|---:|
| datasheet002 | frame_0100.jpeg | 0.098% | 98.97% |
| datasheet003 | frame_0106.jpeg | 未检出 | 0.00% |
| datasheet004 | frame_0101.jpeg | 未检出 | 0.00% |
| datasheet005 | frame_0118.jpeg | 未检出 | 0.00% |
| letter002 | frame_0101.jpeg | 0.129% | 98.92% |
| letter003 | frame_0104.jpeg | 0.152% | 98.62% |
| letter004 | frame_0106.jpeg | 0.189% | 97.91% |
| letter005 | frame_0101.jpeg | 0.249% | 96.95% |
| magazine002 | frame_0114.jpeg | 未检出 | 0.00% |
| magazine003 | frame_0103.jpeg | 未检出 | 0.00% |
| magazine004 | frame_0112.jpeg | 未检出 | 0.00% |
| magazine005 | frame_0097.jpeg | 未检出 | 0.00% |
| paper002 | frame_0106.jpeg | 未检出 | 0.00% |
| paper003 | frame_0103.jpeg | 0.179% | 97.95% |
| paper004 | frame_0103.jpeg | 0.234% | 97.55% |
| paper005 | frame_0094.jpeg | 0.122% | 98.78% |
| patent002 | frame_0097.jpeg | 未检出 | 0.00% |
| patent003 | frame_0101.jpeg | 0.185% | 98.21% |
| patent004 | frame_0112.jpeg | 未检出 | 0.00% |
| patent005 | frame_0101.jpeg | 未检出 | 0.00% |
| tax002 | frame_0105.jpeg | 未检出 | 0.00% |
| tax003 | frame_0101.jpeg | 0.078% | 99.18% |
| tax004 | frame_0082.jpeg | 未检出 | 0.00% |
| tax005 | frame_0122.jpeg | 未检出 | 0.00% |

## 效果质量

三张合成干净参考图以种子 17、46、83 生成。每张分别施加线性阴影（亮度增益 0.55–1）、均匀灰度噪声（±18）、1.5 px 模糊和约 3 倍降采样后回放大。使用扫描的去阴影模式。PSNR 按整图灰度均方误差计算，SSIM 取不重叠 8×8 窗平均值。两次比较使用同一张未退化参考图。

| 退化 | 样本 | PSNR 输入 → 输出 | Δ dB | SSIM 输入 → 输出 | Δ SSIM |
|---|---:|---:|---:|---:|---:|
| shadow | 17 | 12.41 → 26.22 | +13.81 | 0.9324 → 0.9948 | +0.0623 |
| noise | 17 | 28.72 → 27.73 | -0.98 | 0.5641 → 0.5718 | +0.0077 |
| blur | 17 | 19.76 → 19.76 | +0.00 | 0.8147 → 0.8147 | +0.0000 |
| low-resolution | 17 | 19.13 → 19.13 | +0.00 | 0.8234 → 0.8234 | +0.0000 |
| shadow | 46 | 12.41 → 26.22 | +13.81 | 0.9324 → 0.9948 | +0.0624 |
| noise | 46 | 28.71 → 27.71 | -1.00 | 0.5634 → 0.5717 | +0.0084 |
| blur | 46 | 19.75 → 19.75 | +0.00 | 0.8152 → 0.8152 | +0.0000 |
| low-resolution | 46 | 19.12 → 19.12 | +0.00 | 0.8244 → 0.8244 | +0.0000 |
| shadow | 83 | 12.41 → 26.22 | +13.81 | 0.9325 → 0.9948 | +0.0623 |
| noise | 83 | 28.70 → 27.70 | -1.00 | 0.5633 → 0.5710 | +0.0077 |
| blur | 83 | 19.73 → 19.73 | +0.00 | 0.8137 → 0.8137 | +0.0000 |
| low-resolution | 83 | 19.10 → 19.10 | +0.00 | 0.8229 → 0.8229 | +0.0000 |

三个阴影样本均改善。噪声样本的 PSNR 有退化，SSIM 有小幅改善。模糊和低分辨率样本无提升；当前去阴影算法未实现去模糊和超分恢复。样本为固定页面样式的合成基线，实拍的可读性仍依赖人工复核。

## 复跑

在仓库根目录执行。依赖为 Python 3、Node、Bun 和 Playwright Chromium；可通过 `M0_CHROME` 指定系统 Chrome 路径。下载、原始图和生成报告放在 Git 忽略的缓存中。

```sh
mkdir -p .cache/m0
curl -fL -o .cache/m0/frames.tar.gz https://github.com/jchazalon/smartdoc15-ch1-dataset/releases/download/v2.0.0/frames.tar.gz
python3 scripts/extract-m0-smartdoc.py .cache/m0/frames.tar.gz .cache/m0/smartdoc
bun run build:worker
node scripts/evaluate-m0-quality.mjs .cache/m0/smartdoc .cache/m0/quality
```

帧归档 SHA-256 为 `3acb8be143fc86c507d90d298097cba762e91a3abf7e2d35ccd5303e13a79eae`。评估输出 `quality.json`（各帧真值、检测值、合成数据指标）和 `review.html`（真值叠图及扫描预览）。
