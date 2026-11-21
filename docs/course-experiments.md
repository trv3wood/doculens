# 数字图像处理课程实验

七项实验在独立的 Python 模块中运行，生成本地对照报告。实验使用同一张 384×384 合成参考图，包含灰底、正文与色块。随机退化使用种子 1703。频域和复原计算由实验脚本执行，MApp 验收覆盖基于同一提交构建的生产扫描入口。

## 复跑

使用 Python 3.13，在仓库根目录执行：

```sh
python3.13 -m venv .cache/course-venv
.cache/course-venv/bin/python -m pip install -r scripts/course-requirements.txt
.cache/course-venv/bin/python scripts/run-course-experiments.py --output .cache/course
```

打开 `.cache/course/index.html` 查看逐组真值、输入、输出、通道或频谱及质量表。`results.json` 记录参数、处理前后指标和差值。生成的图像与报告存放在本地缓存。 [本次实验数据](./course-experiment-results.json)

## 实验与结果

| ID | 实验 | 观察 |
|---|---|---|
| C01 | 采样与量化 | 比较 192、96、48 px 的采样分辨率和 4、16、64 级量化。降低采样率使小字笔画丢失。 |
| C02 | 颜色空间 | 查看 RGB、HSV、YCbCr 九个通道并验证两条往返转换。双精度往返在输出为 8-bit PNG 时恢复同一图像。 |
| C03 | 图像增强 | 对同一低对比输入比较直方图均衡、Gamma 与百分位拉伸。拉伸在此样本上使 PSNR 增加约 14.48 dB。 |
| C04 | 频域 | 给灰度文档叠加两组周期条纹，展示 FFT 频谱及成对陷波。合成条纹样本的 PSNR 增加约 9.54 dB，SSIM 增加约 0.3643。 |
| C05 | 图像复原 | 分别模拟离焦和水平运动模糊，比对 Wiener 与 Richardson–Lucy。当前参数下 Wiener 的 PSNR 仅小幅改善，两种方法的 SSIM 都下降。需考虑边界处理、噪声与复原参数。 |
| C06 | 文档 | 用已知的通道增益模拟偏色和执行校正，再比较锐化及局部二值化。二值化对照使用干净二值参考，基线为相同固定阈值处理带光照变化的输入。 |
| C07 | 质量评价 | 用同一干净灰度图评价光照恢复。PSNR 增加约 6.87 dB，SSIM 下降约 0.0147。报告同时展示恢复后的误差图。 |

PSNR 和 SSIM 均在相同大小、相同通道的参考图上计算，数值范围为 0–1。C01 的低分辨率样本以最近邻补回参考尺寸后比较。完全一致时 PSNR 为无穷大，JSON 记为 `null`。各项结果用于分析本组构造条件，真实文档上的表现另由 SmartDoc 基线评估。
