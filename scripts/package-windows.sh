#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun run build:desktop
mkdir -p .cache/windows-build

# 容器复用 Ubuntu 的网络，让本机回环地址上的下载代理可用。
podman run --rm --userns=keep-id --network=host \
  -v "$PWD:/project" -w /project \
  -e ELECTRON_CACHE=/project/.cache/windows-build/electron \
  -e ELECTRON_BUILDER_CACHE=/project/.cache/windows-build/electron-builder \
  -e WINEPREFIX=/project/.cache/windows-build/wine \
  docker.io/electronuserland/builder:wine \
  node node_modules/electron-builder/out/cli/cli.js \
  --config desktop/electron-builder.yml --win zip --x64 --publish never
