#!/usr/bin/env python3
"""检查引擎产物并记录可复现构建元数据。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "engine" / "opencv.js"
WASM = ROOT / "public" / "wasm" / "opencv.wasm"
CONFIG = ROOT / "engine" / "opencv_js.config.py"

source = JS.read_text(encoding="utf-8")
for forbidden in ("new Function(", "eval(", "importScripts("):
    if forbidden in source:
        raise SystemExit(f"OpenCV JS 含禁止的动态加载/执行路径：{forbidden}")
if "wasmBinary" not in source:
    raise SystemExit("OpenCV JS 不支持外部 wasmBinary 初始化")
if WASM.read_bytes()[:4] != b"\0asm":
    raise SystemExit("OpenCV WASM 魔数无效")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


info = {
    "schema": 1,
    "opencv": {
        "version": "4.12.0",
        "commit": "49486f61fb25722cbcf586b7f4320921d46fb38e",
        "tagObject": "cbee6841638edb6fbc8110df7cd52bb8e3d66211",
    },
    "emscripten": {
        "version": "4.0.21",
        "amd64ImageDigest": "sha256:8a5b33c72971cb272f4b925b2674a500c0ab9630bdb9e162a7a9f99b6afb7c42",
    },
    "features": {
        "singleThread": True,
        "simd128": True,
        "dynamicExecution": False,
        "externalWasm": True,
        "maximumMemoryBytes": 1073741824,
    },
    "artifacts": {
        "engine/opencv.js": {"bytes": JS.stat().st_size, "sha256": sha256(JS)},
        "public/wasm/opencv.wasm": {"bytes": WASM.stat().st_size, "sha256": sha256(WASM)},
    },
    "configSha256": sha256(CONFIG),
    "sourcePatchSha256": sha256(ROOT / "engine" / "patch_source.py"),
}
(ROOT / "engine" / "BUILD_INFO.json").write_text(
    json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(info["artifacts"], ensure_ascii=False, indent=2))
