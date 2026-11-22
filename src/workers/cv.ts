/** OpenCV.js 模块的最小子集，主线程与 Worker 共享。 */
export interface CvMat {
  data: Uint8Array;
  data32F: Float32Array;
  data32S: Int32Array;
  rows: number;
  cols: number;
  delete(): void;
}

export interface CvSize {
  width: number;
  height: number;
}

export interface CvModule {
  Mat: new (rows?: number, cols?: number, type?: number) => CvMat;
  MatVector: new () => { size(): number; get(index: number): CvMat; delete(): void };
  Size: new (width: number, height: number) => CvSize;
  COLOR_RGBA2GRAY: number;
  COLOR_GRAY2RGBA: number;
  CV_8UC1: number;
  CV_32F: number;
  CV_32FC2: number;
  MORPH_RECT: number;
  MORPH_CLOSE: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  INTER_AREA: number;
  INTER_LINEAR: number;
  BORDER_DEFAULT: number;
  ADAPTIVE_THRESH_GAUSSIAN_C: number;
  THRESH_BINARY: number;
  matFromImageData(image: { data: Uint8ClampedArray; width: number; height: number }): CvMat;
  matFromArray(rows: number, cols: number, type: number, data: number[]): CvMat;
  cvtColor(source: CvMat, target: CvMat, code: number): void;
  resize(source: CvMat, target: CvMat, size: CvSize, fx: number, fy: number, interpolation: number): void;
  GaussianBlur(source: CvMat, target: CvMat, size: CvSize, sigmaX: number, sigmaY: number, border: number): void;
  Canny(source: CvMat, target: CvMat, low: number, high: number, aperture: number, l2: boolean): void;
  getStructuringElement(shape: number, size: CvSize): CvMat;
  morphologyEx(source: CvMat, target: CvMat, operation: number, kernel: CvMat): void;
  findContours(source: CvMat, contours: InstanceType<CvModule["MatVector"]>, hierarchy: CvMat, mode: number, method: number): void;
  contourArea(contour: CvMat): number;
  arcLength(contour: CvMat, closed: boolean): number;
  approxPolyDP(contour: CvMat, approximation: CvMat, epsilon: number, closed: boolean): void;
  getPerspectiveTransform(source: CvMat, target: CvMat): CvMat;
  warpPerspective(source: CvMat, target: CvMat, matrix: CvMat, size: CvSize): void;
  adaptiveThreshold(source: CvMat, target: CvMat, max: number, method: number, type: number, block: number, c: number): void;
  dft?(source: CvMat, target: CvMat, flags?: number, nonzeroRows?: number): void;
  getOptimalDFTSize?(size: number): number;
  filter2D?(
    source: CvMat,
    target: CvMat,
    ddepth: number,
    kernel: CvMat,
    anchor?: { x: number; y: number },
    delta?: number,
    borderType?: number,
  ): void;
  getBuildInformation?: () => string;
}
