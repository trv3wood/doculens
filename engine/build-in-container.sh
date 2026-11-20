#!/usr/bin/env bash
set -euo pipefail

BUILD_DIR=/work/engine/build
OPENCV_DIR=/opt/opencv
JOBS="${DOCULENS_BUILD_JOBS:-6}"

python3 /work/engine/patch_source.py

emcmake python3 "$OPENCV_DIR/platforms/js/build_js.py" "$BUILD_DIR" \
  --opencv_dir "$OPENCV_DIR" \
  --build_wasm \
  --disable_single_file \
  --simd \
  --config_only \
  --config /work/engine/opencv_js.config.py \
  --cmake_option="-DBUILD_opencv_calib3d=OFF" \
  --cmake_option="-DCMAKE_CXX_STANDARD=17" \
  --cmake_option="-DBUILD_opencv_dnn=OFF" \
  --cmake_option="-DBUILD_opencv_features2d=OFF" \
  --cmake_option="-DBUILD_opencv_flann=OFF" \
  --cmake_option="-DBUILD_opencv_photo=OFF" \
  --cmake_option="-DBUILD_opencv_video=OFF" \
  --cmake_option="-DBUILD_opencv_objdetect=OFF" \
  --cmake_option="-DBUILD_opencv_ml=OFF" \
  --cmake_option="-DBUILD_EXAMPLES=OFF" \
  --cmake_option="-DBUILD_TESTS=OFF" \
  --cmake_option="-DBUILD_PERF_TESTS=OFF" \
  --build_flags="-O3 -sDYNAMIC_EXECUTION=0 -sENVIRONMENT=worker -sFILESYSTEM=0 -sDEMANGLE_SUPPORT=0 -sMAXIMUM_MEMORY=1073741824"

cmake --build "$BUILD_DIR" --target opencv.js -- -j"$JOBS"
