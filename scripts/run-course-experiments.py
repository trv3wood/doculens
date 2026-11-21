#!/usr/bin/env python3
"""Run the seven DocuLens course experiments and generate a local comparison report."""
import argparse
from html import escape
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage, signal
from skimage import color, exposure, filters, metrics, restoration
from skimage.util import img_as_float

SIZE = 384
SEED = 1703


def reference():
    image = Image.new("RGB", (SIZE, SIZE), "#f2f2f2")
    draw = ImageDraw.Draw(image)
    draw.text((24, 22), "DocuLens", font=ImageFont.load_default(size=29), fill="#202020")
    draw.rectangle((25, 66, 358, 68), fill="#202020")
    for index, fill in enumerate(("#c23538", "#2167b4", "#39834c", "#c28724", "#242424", "#a9a9a9")):
        x = 25 + index * 56
        draw.rectangle((x, 81, x + 47, 116), fill=fill)
    font = ImageFont.load_default(size=14)
    for row in range(11):
        draw.text((25, 137 + row * 18), f"{row + 1:02d}  Sample text | 0123456789", font=font, fill="#292929")
    return img_as_float(np.asarray(image))


def save_image(path, pixels):
    values = np.rint(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(values).save(path)


def quality(truth, actual):
    actual = np.clip(actual, 0, 1)
    psnr = None if np.array_equal(truth, actual) else float(
        metrics.peak_signal_noise_ratio(truth, actual, data_range=1))
    ssim = metrics.structural_similarity(
        truth, actual, data_range=1, channel_axis=-1 if truth.ndim == 3 else None)
    return {"psnr_db": psnr, "ssim": float(ssim)}


def delta(before, after):
    first, second = before["psnr_db"], after["psnr_db"]
    return {"psnr_db": second - first if first is not None and second is not None else None,
            "ssim": after["ssim"] - before["ssim"]}


def spectrum(values):
    magnitude = np.log1p(np.abs(np.fft.fftshift(values)))
    return exposure.rescale_intensity(magnitude, in_range=(0, np.percentile(magnitude, 99.8)))


def deblur_tv(observed, kernel, weight, checkpoints):
    """Minimize squared observation error plus isotropic total variation."""
    # Match the zero extension used to generate both blurred observations.
    def apply(image, psf):
        return signal.oaconvolve(image, psf, mode="same")

    estimate = observed.copy()
    dual_x = np.zeros_like(estimate)
    dual_y = np.zeros_like(estimate)
    # The normalized PSF has operator norm <= 1; squared gradient norm <= 8.
    primal_step, dual_step = .95, .06
    for iteration in range(1, max(checkpoints) + 1):
        residual = apply(estimate, kernel) - observed
        gradient = apply(residual, kernel[::-1, ::-1])
        gradient[:, :-1] -= dual_x[:, :-1]
        gradient[:, 1:] += dual_x[:, :-1]
        gradient[:-1, :] -= dual_y[:-1, :]
        gradient[1:, :] += dual_y[:-1, :]
        updated = np.clip(estimate - primal_step * gradient, 0, 1)
        extrapolated = 2 * updated - estimate
        dual_x[:, :-1] += dual_step * np.diff(extrapolated, axis=1)
        dual_y[:-1, :] += dual_step * np.diff(extrapolated, axis=0)
        scale = np.maximum(1, np.hypot(dual_x, dual_y) / weight)
        dual_x /= scale
        dual_y /= scale
        estimate = updated
        if iteration in checkpoints:
            yield iteration, estimate


def experiments():
    rgb = reference()
    gray = color.rgb2gray(rgb)
    rng = np.random.default_rng(SEED)
    noise = rng.normal(0, .008, gray.shape)

    sampled = {}
    for stride in (2, 4, 8):
        sampled[f"采样 1/{stride}"] = np.repeat(np.repeat(gray[::stride, ::stride], stride, 0), stride, 1)
    for levels in (4, 16, 64):
        sampled[f"{levels} 灰度级"] = np.rint(gray * (levels - 1)) / (levels - 1)
    yield "C01", "采样与量化", gray, gray, sampled, {}, {
        "sampling_sizes": [192, 96, 48], "strides": [2, 4, 8], "levels": [4, 16, 64],
        "preview": "nearest-neighbor reconstruction",
    }

    hsv, ycbcr = color.rgb2hsv(rgb), color.rgb2ycbcr(rgb)
    channels = {name: rgb[..., i] for i, name in enumerate(("R", "G", "B"))}
    channels.update({name: hsv[..., i] for i, name in enumerate(("H", "S", "V"))})
    channels.update({"Y": (ycbcr[..., 0] - 16) / 219,
                     "Cb": (ycbcr[..., 1] - 16) / 224, "Cr": (ycbcr[..., 2] - 16) / 224})
    yield "C02", "颜色空间", rgb, rgb, {"HSV 往返": color.hsv2rgb(hsv),
        "YCbCr 往返": color.ycbcr2rgb(ycbcr)}, channels, {"channel_display": "BT.601 nominal range"}

    dark = .18 + .46 * gray
    yield "C03", "图像增强", gray, dark, {
        "直方图均衡化": exposure.equalize_hist(dark, nbins=256),
        "Gamma": exposure.adjust_gamma(dark, .65),
        "对比度拉伸": exposure.rescale_intensity(dark, in_range=tuple(np.percentile(dark, [1, 99]))),
    }, {}, {"capture_gain": .46, "offset": .18, "gamma": .65, "stretch_percentiles": [1, 99]}

    yy, xx = np.indices(gray.shape)
    frequencies = [(29, 10), (51, -14)]
    periodic = gray.copy()
    for fx, fy in frequencies:
        periodic += .08 * np.sin(2 * np.pi * (fx * xx + fy * yy) / SIZE)
    periodic = np.clip(periodic, 0, 1)
    fft = np.fft.fft2(periodic)
    mask = np.ones_like(gray)
    for fx, fy in frequencies:
        for sign in (-1, 1):
            dx = (xx - sign * fx + SIZE // 2) % SIZE - SIZE // 2
            dy = (yy - sign * fy + SIZE // 2) % SIZE - SIZE // 2
            mask[dx * dx + dy * dy <= 2 ** 2] = 0
    cleaned = np.fft.ifft2(fft * mask).real
    yield "C04", "频域陷波", gray, periodic, {"FFT 陷波": cleaned}, {
        "输入频谱": spectrum(fft), "陷波后频谱": spectrum(fft * mask),
        "陷波掩模": np.fft.fftshift(mask),
    }, {"frequency_bins_xy": frequencies, "radius_bins": 2, "amplitude_each": .08}

    grid_y, grid_x = np.ogrid[-4:5, -4:5]
    disk = (grid_x ** 2 + grid_y ** 2 <= 16).astype(float)
    motion = np.zeros((9, 9))
    motion[4, :] = 1
    for kind, kernel in [("离焦", disk), ("运动", motion)]:
        kernel /= kernel.sum()
        blurred = np.clip(signal.fftconvolve(gray, kernel, mode="same") + noise, 0, 1)
        checkpoints = (80, 320, 960)
        restored = dict(deblur_tv(blurred, kernel, weight=.0015, checkpoints=checkpoints))
        tv = restored[checkpoints[-1]]
        yield ("C05-" + ("defocus" if kind == "离焦" else "motion"), f"{kind}模糊复原", gray, blurred, {
            "Wiener": restoration.wiener(blurred, kernel, balance=.02, clip=False),
            "Richardson–Lucy": restoration.richardson_lucy(blurred, kernel, num_iter=20, clip=False),
            **{f"全变分 · {step} 次": img for step, img in restored.items()},
        }, {"小字原图": gray[136:166, 24:204], "小字输入": blurred[136:166, 24:204],
            "小字复原": tv[136:166, 24:204], "点扩散函数": np.kron(kernel / kernel.max(), np.ones((32, 32)))},
        {"psf_shape": list(kernel.shape), "defocus_radius": 4, "motion_length": 9,
         "noise_sigma": .008, "wiener_balance": .02, "rl_iterations": 20, "tv_weight": .0015, "tv_iterations": list(checkpoints), "tv_boundary": "zero extension"})

    gains = np.array([.90, .75, .62])
    lighting = .67 + .33 * xx / (SIZE - 1)
    cast = rgb * gains * lighting[..., None]
    balanced = np.clip(cast / gains, 0, 1)
    balanced_gray = color.rgb2gray(balanced)
    yield ("C06", "文档校色与锐化", gray, color.rgb2gray(cast), {
        "白平衡后灰度": balanced_gray,
        "锐化": filters.unsharp_mask(balanced_gray, radius=1.2, amount=1.1),
    }, {"偏色输入": cast, "校色结果": balanced},
        {"channel_gains": gains.tolist(), "sharpen_radius": 1.2, "sharpen_amount": 1.1})
    threshold = .55
    local = filters.threshold_local(balanced_gray, 31, offset=.035)
    yield "C06-binary", "文档自适应二值化", (gray > threshold).astype(float), (
        balanced_gray > threshold).astype(float), {"局部二值化": balanced_gray > local}, {
        "带光照变化的灰度": balanced_gray,
    }, {"reference_and_baseline_threshold": threshold, "local_window": 31, "threshold_offset": .035}

    degraded = np.clip(gray * lighting + noise, 0, 1)
    light_field = ndimage.gaussian_filter(ndimage.grey_closing(degraded, size=(25, 25)), sigma=8)
    recovered = np.clip(degraded * .95 / np.maximum(light_field, .15), 0, 1)
    yield "C07", "参考真值质量分析", gray, degraded, {"光照恢复": recovered}, {
        "恢复后绝对误差 ×4": np.abs(recovered - gray) * 4,
    }, {"close_window": 25, "smoothing_sigma": 8, "noise_sigma": .008}


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    report = {"seed": SEED, "reference_size": [SIZE, SIZE], "experiments": []}
    sections = []
    for code, title, truth, degraded, outputs, extras, parameters in experiments():
        before = quality(truth, degraded)
        results = []
        figures = []
        images = [("真值", truth), ("输入", degraded), *outputs.items(), *extras.items()]
        for i, (label, pixels) in enumerate(images):
            name = f"{code}-{i:02}.png"
            save_image(output / name, pixels)
            figures.append(f'<figure><img src="{name}" alt="{escape(label)}"><figcaption>{escape(label)}</figcaption></figure>')
            if label in outputs:
                after = quality(truth, pixels)
                results.append({"name": label, "image": name, "after": after, "delta": delta(before, after)})
        report["experiments"].append({"code": code, "title": title, "parameters": parameters,
                                       "before": before, "results": results})
        def fmt(number):
            return "—" if number is None else f"{number:.4f}"
        rows = "".join(f'<tr><td>{escape(row["name"])}</td>'
                       f'<td>{fmt(row["after"]["psnr_db"])}</td><td>{fmt(row["after"]["ssim"])}</td>'
                       f'<td>{fmt(row["delta"]["psnr_db"])}</td><td>{fmt(row["delta"]["ssim"])}</td></tr>'
                       for row in results)
        explanation = ""
        if code.startswith("C05"):
            explanation = (
                "<p>三个全变分结果来自同一次迭代，在标明的步数取样。两类模糊采用相同参数。"
                "算法用已知模糊核重建观测图像，同时约束纸面上的细碎波动；卷积边界与生成输入时一致。"
                "真值只参与评价。表中差值均相对于模糊输入。小字对照取自同一区域，展示最后一次迭代的结果。</p>"
            )
        sections.append(f'<section id="{code}"><h2>{code} {escape(title)}</h2>'
                        f'<p>输入基线 · PSNR {fmt(before["psnr_db"])} dB · SSIM {fmt(before["ssim"])}</p>'
                        f'{explanation}<div class="panels">{"".join(figures)}</div>'
                        f'<div class="metrics"><table><thead><tr><th>处理</th><th>PSNR (dB)</th><th>SSIM</th><th>Δ PSNR</th><th>Δ SSIM</th></tr></thead>'
                        f'<tbody>{rows}</tbody></table></div><pre>{escape(json.dumps(parameters, ensure_ascii=False))}</pre></section>')
    (output / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    (output / "index.html").write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DocuLens 课程实验</title>
<style>
body{font:16px system-ui;max-width:1040px;margin:auto;padding:2rem 1rem;color:#1e293b;background:#f8fafc}
section{margin:2rem 0;padding-top:1rem;border-top:1px solid #cbd5e1}
.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:1rem}
figure{margin:0}img{display:block;width:100%;border:1px solid #cbd5e1}figcaption{margin-top:.4rem}
.metrics{overflow-x:auto;margin-top:1rem}table{border-collapse:collapse}th,td{padding:.4rem .7rem;border-bottom:1px solid #cbd5e1;text-align:left}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
</style><h1>DocuLens 数字图像处理实验</h1>
<p>每组使用固定参考图。— 表示 PSNR 无穷大或差值无定义。</p>
''' + "".join(sections) + "</html>\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    run(parser.parse_args().output)
