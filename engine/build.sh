#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=4.12.0
COMMIT=49486f61fb25722cbcf586b7f4320921d46fb38e
IMAGE=docker.io/emscripten/emsdk:4.0.21
RUNTIME="${CONTAINER_RUNTIME:-podman}"
SOURCE="${OPENCV_SOURCE_DIR:-$ROOT/.cache/opencv-$VERSION}"

if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --depth 1 --branch "$VERSION" https://github.com/opencv/opencv.git "$SOURCE"
fi
ACTUAL_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$COMMIT" ]]; then
  printf 'OpenCV 源码版本不符：期望 %s，实际 %s\n' "$COMMIT" "$ACTUAL_COMMIT" >&2
  exit 1
fi

mkdir -p "$ROOT/engine/build" "$ROOT/public/wasm" "$ROOT/public/licenses"
USERNS=()
if [[ "$RUNTIME" == "podman" ]]; then
  USERNS=(--userns=keep-id)
fi
"$RUNTIME" run --rm \
  "${USERNS[@]}" \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e HTTP_PROXY="${HTTP_PROXY:-}" \
  -e HTTPS_PROXY="${HTTPS_PROXY:-}" \
  -e NO_PROXY="${NO_PROXY:-}" \
  -e DOCULENS_BUILD_JOBS="${DOCULENS_BUILD_JOBS:-6}" \
  -v "$ROOT:/work" \
  -v "$SOURCE:/opt/opencv" \
  -w /work \
  "$IMAGE" \
  bash engine/build-in-container.sh

cp "$ROOT/engine/build/bin/opencv_js.js" "$ROOT/engine/opencv.js"
cp "$ROOT/engine/build/bin/opencv_js.wasm" "$ROOT/public/wasm/opencv.wasm"
cp "$SOURCE/LICENSE" "$ROOT/public/licenses/opencv.txt"
python3 "$ROOT/engine/finalize.py"
