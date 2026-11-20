# DocuLens 扫描流水线所需的最小 JS 绑定。
# 由 OpenCV 的 platforms/js/build_js.py --config 读取。

core = {
    "": [
        "absdiff", "add", "addWeighted", "bitwise_not", "convertScaleAbs",
        "countNonZero", "divide", "LUT", "max", "mean", "meanStdDev",
        "merge", "min", "minMaxLoc", "multiply", "normalize", "split",
        "subtract",
    ],
}

imgproc = {
    "": [
        "adaptiveThreshold", "approxPolyDP", "arcLength", "bilateralFilter",
        "boundingRect", "Canny", "contourArea", "createCLAHE", "cvtColor",
        "dilate", "equalizeHist", "erode", "filter2D", "findContours",
        "GaussianBlur", "getPerspectiveTransform", "getStructuringElement",
        "medianBlur", "morphologyEx", "resize", "threshold", "warpPerspective",
    ],
    "CLAHE": [
        "apply", "collectGarbage", "getClipLimit", "getTilesGridSize",
        "setClipLimit", "setTilesGridSize",
    ],
}

white_list = makeWhiteList([core, imgproc])
