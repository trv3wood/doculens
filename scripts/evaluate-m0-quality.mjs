import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

function signedArea(points) {
  return points.reduce((area, [x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length];
    return area + x * nextY - nextX * y;
  }, 0) / 2;
}

function quadIoU(truth, prediction) {
  if (!prediction) return 0;
  const orientation = Math.sign(signedArea(truth));
  let intersection = prediction;
  for (const [i, [ax, ay]] of truth.entries()) {
    const [bx, by] = truth[(i + 1) % truth.length];
    const side = ([x, y]) => orientation * ((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    const input = intersection;
    intersection = [];
    for (const [j, current] of input.entries()) {
      const previous = input[(j + input.length - 1) % input.length];
      const a = side(previous);
      const b = side(current);
      if ((a >= 0) !== (b >= 0)) {
        const t = a / (a - b);
        intersection.push(previous.map((value, k) => value + t * (current[k] - value)));
      }
      if (b >= 0) intersection.push(current);
    }
  }
  const overlap = Math.abs(signedArea(intersection));
  const union = Math.abs(signedArea(truth)) + Math.abs(signedArea(prediction)) - overlap;
  return union > 0 ? Math.min(1, overlap / union) : 0;
}

const [, , samples, output] = process.argv;
if (!samples || !output) throw new Error("Usage: node scripts/evaluate-m0-quality.mjs SAMPLE_DIR REPORT_DIR");
const truth = JSON.parse(await readFile(join(samples, "truth.json"), "utf8"));
await mkdir(output, { recursive: true });
const routes = new Map([
  ["/", ["text/html", null]],
  ["/worker", ["text/javascript", "public/workers/scanner.js"]],
  ["/wasm", ["application/wasm", "public/wasm/opencv.wasm"]],
  ...Object.keys(truth).map((name, index) => [`/sample/${index}`, ["image/jpeg", join(samples, name)]]),
]);
const server = createServer(async (request, response) => {
  const route = routes.get(request.url);
  if (!route) return response.writeHead(404).end();
  try {
    const [type, file] = route;
    response.writeHead(200, { "Content-Type": type }).end(file ? await readFile(file) : "<!doctype html>");
  } catch {
    response.destroy();
  }
});
await new Promise((ready, reject) => server.once("error", reject).listen(0, "127.0.0.1", ready));

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.M0_CHROME });
  const page = await browser.newPage();
  const diagnostics = [];
  if (process.env.M1_DIAGNOSTICS === "1") {
    await page.route("**/worker", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: "self.debugDetection=true;\n" + await response.text() });
    });
    page.on("console", message => {
      if (message.text().startsWith("detect-")) diagnostics.push(message.text());
    });
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const report = await page.evaluate(async (annotations) => {
    const worker = new Worker("/worker");
    let id = 0;
    function send(message, transfer) {
      return new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.type === "error" ? reject(new Error(data.message)) : resolve(data);
        worker.onerror = reject;
        worker.postMessage({ ...message, id: ++id }, transfer);
      });
    }
    const wasm = await (await fetch("/wasm")).arrayBuffer();
    await send({ type: "init", wasm }, [wasm]);
    function canvas(width, height) {
      const image = document.createElement("canvas");
      image.width = width;
      image.height = height;
      return image.getContext("2d", { willReadFrequently: true });
    }
    function scan(ctx) {
      const { width, height } = ctx.canvas;
      const rgba = ctx.getImageData(0, 0, width, height).data.buffer;
      return send({ type: "process", width, height, rgba, turns: 0, mode: "enhanced" }, [rgba]);
    }
    function polygon(ctx, points, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
      ctx.stroke();
    }
    const frames = [];
    for (const [index, [name, expected]] of annotations.entries()) {
      const image = await createImageBitmap(await (await fetch(`/sample/${index}`)).blob());
      const { width, height } = image;
      const ctx = canvas(width, height);
      ctx.drawImage(image, 0, 0);
      image.close();
      console.debug("detect-frame", name);
      const result = await scan(ctx);
      const corners = result.corners?.map(({ x, y }) => [x * (width - 1), y * (height - 1)]);
      const diagonal = Math.hypot(width, height);
      // A cyclic match removes any difference in the starting corner convention.
      const error = corners && Math.min(...corners.map((_, offset) =>
        corners.reduce((sum, [x, y], i) => {
          const [tx, ty] = expected[(i + offset) % 4];
          return sum + Math.hypot(x - tx, y - ty) / (4 * diagonal);
        }, 0)));
      polygon(ctx, expected, "#00ef72");
      if (corners) polygon(ctx, corners, "#ff6a27");
      const overlay = canvas(480, 270);
      overlay.drawImage(ctx.canvas, 0, 0, 480, 270);
      const corrected = canvas(result.width, result.height);
      corrected.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
      const preview = canvas(240, 270);
      preview.fillStyle = "#fff";
      preview.fillRect(0, 0, 240, 270);
      const scale = Math.min(240 / result.width, 270 / result.height);
      preview.drawImage(corrected.canvas, 0, 0, result.width * scale, result.height * scale);
      frames.push({ name, expected, corners: corners ?? null, normalizedCornerError: error ?? null, detectMs: result.detectMs,
        overlay: overlay.canvas.toDataURL("image/jpeg", .85),
        preview: preview.canvas.toDataURL("image/jpeg", .85) });
    }

    function metrics(reference, actual, width, height) {
      let squaredError = 0;
      let ssimSum = 0;
      let windows = 0;
      const c1 = (255 * .01) ** 2;
      const c2 = (255 * .03) ** 2;
      for (let y = 0; y < height; y += 8) {
        for (let x = 0; x < width; x += 8) {
          let r = 0, a = 0, rr = 0, aa = 0, ra = 0;
          for (let j = y; j < y + 8; j++) {
            for (let i = x; i < x + 8; i++) {
              const offset = (j * width + i) * 4;
              const ref = reference[offset];
              const sample = actual[offset];
              squaredError += (ref - sample) ** 2;
              r += ref;
              a += sample;
              rr += ref * ref;
              aa += sample * sample;
              ra += ref * sample;
            }
          }
          const rm = r / 64;
          const am = a / 64;
          ssimSum += ((2 * rm * am + c1) * (2 * (ra / 64 - rm * am) + c2)) /
            ((rm ** 2 + am ** 2 + c1) * (rr / 64 - rm ** 2 + aa / 64 - am ** 2 + c2));
          windows++;
        }
      }
      return { psnr: 10 * Math.log10(255 ** 2 * width * height / squaredError), ssim: ssimSum / windows };
    }

    const synthetic = [];
    for (const seed of [17, 46, 83]) {
      const width = 512, height = 640;
      const clean = canvas(width, height);
      clean.fillStyle = "#f5f5f5";
      clean.fillRect(0, 0, width, height);
      clean.fillStyle = "#222";
      clean.font = "bold 27px monospace";
      clean.fillText(`Document ${seed}`, 32, 62);
      clean.font = "15px monospace";
      for (let line = 0; line < 25; line++) {
        clean.fillText(`Line ${line + 1} / ${seed + line * 17} : readable text.`, 32, 100 + line * 20);
      }
      const reference = clean.getImageData(0, 0, width, height).data;
      for (const degradation of ["shadow", "noise", "blur", "low-resolution"]) {
        const input = canvas(width, height);
        if (degradation === "low-resolution") {
          const small = canvas(width / 3 | 0, height / 3 | 0);
          small.drawImage(clean.canvas, 0, 0, small.canvas.width, small.canvas.height);
          input.drawImage(small.canvas, 0, 0, width, height);
        } else {
          if (degradation === "blur") input.filter = "blur(1.5px)";
          input.drawImage(clean.canvas, 0, 0);
          input.filter = "none";
        }
        const data = input.getImageData(0, 0, width, height);
        let random = seed;
        for (let i = 0; i < data.data.length; i += 4) {
          const x = (i / 4) % width;
          const shadow = .55 + .45 * x / (width - 1);
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          for (let channel = 0; channel < 3; channel++) {
            if (degradation === "shadow") data.data[i + channel] *= shadow;
            if (degradation === "noise") data.data[i + channel] += (random / 2 ** 32 - .5) * 36;
          }
        }
        input.putImageData(data, 0, 0);
        const before = metrics(reference, data.data, width, height);
        const result = await scan(input);
        const after = result.width === width && result.height === height
          ? metrics(reference, new Uint8ClampedArray(result.rgba), width, height)
          : null;
        synthetic.push({ seed, degradation, before, after, delta: after && {
          psnr: after.psnr - before.psnr, ssim: after.ssim - before.ssim,
        } });
      }
    }
    worker.terminate();
    return { frames, synthetic };
  }, Object.entries(truth));

  if (diagnostics.length) await writeFile(join(output, "diagnostics.log"), diagnostics.join("\n"));
  const cards = [];
  for (const [i, frame] of report.frames.entries()) {
    frame.iou = quadIoU(frame.expected, frame.corners);
    const images = [];
    for (const role of ["overlay", "preview"]) {
      const file = `${i + 1}-${role}.jpg`;
      await writeFile(join(output, file), Buffer.from(frame[role].split(",")[1], "base64"));
      delete frame[role];
      images.push(`<img src="${file}" alt="${role === "overlay" ? "原图和四角叠图" : "实际扫描结果"}">`);
    }
    cards.push(`<section><h2>${i + 1}. ${frame.name}</h2>${images.join("")}</section>`);
  }
  await writeFile(join(output, "review.html"), `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmartDoc 四角复核</title>
<style>body{font:16px system-ui;margin:2rem;color:#222}h2{font-size:1rem}section{border-top:1px solid #ddd;padding:.4rem 0 1rem}img{max-width:100%;height:auto;vertical-align:top}</style>
<h1>SmartDoc 四角复核</h1>
<p>绿色为数据集真值，橙色为自动检测。右图为实际扫描结果。</p>${cards.join("")}`);
  const detected = report.frames.filter((frame) => frame.corners);
  report.geometry = {
    attempts: report.frames.length,
    detected: detected.length,
    meanIoUAll: report.frames.reduce((sum, frame) => sum + frame.iou, 0) / report.frames.length,
    meanIoUDetected: detected.length
      ? detected.reduce((sum, frame) => sum + frame.iou, 0) / detected.length : null,
  };
  await writeFile(join(output, "quality.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(resolve(output, "quality.json"));
} finally {
  await browser?.close();
  server.close();
}
