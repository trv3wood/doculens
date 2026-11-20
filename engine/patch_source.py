#!/usr/bin/env python3
"""OpenCV 4.12 与 Emscripten 4 的最小兼容补丁，幂等且可审计。"""

from pathlib import Path

path = Path("/opt/opencv/modules/js/CMakeLists.txt")
source = path.read_text(encoding="utf-8")
obsolete = " -s DEMANGLE_SUPPORT=1"
if obsolete in source:
    source = source.replace(obsolete, "")
    print("已移除 Emscripten 4 不再支持的 DEMANGLE_SUPPORT=1")
forced_filesystem = " -s FORCE_FILESYSTEM=1 --use-preload-plugins"
if forced_filesystem in source:
    source = source.replace(forced_filesystem, "")
    print("已移除与 FILESYSTEM=0 冲突的 FORCE_FILESYSTEM/preload 配置")
if source != path.read_text(encoding="utf-8"):
    path.write_text(source, encoding="utf-8")
