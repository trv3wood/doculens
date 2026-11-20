import type {
  ProcessRequest,
  ScannerRequest,
  ScannerResponse,
} from "./protocol";

interface CvMat {
  data: Uint8Array;
  delete(): void;
}

interface CvModule {
  Mat: new () => CvMat;
  COLOR_RGBA2GRAY: number;
  COLOR_GRAY2RGBA: number;
  matFromImageData(image: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): CvMat;
  cvtColor(source: CvMat, target: CvMat, code: number): void;
  getBuildInformation?: () => string;
}

declare const cv: (options: { wasmBinary: ArrayBuffer }) => CvModule | Promise<CvModule>;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Promise<CvModule> | null = null;
let queue: Promise<void> = Promise.resolve();

function post(message: ScannerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

async function initialize(id: number, wasm: ArrayBuffer) {
  if (engine) throw new Error("OpenCV 已初始化，请更换文档时重建 Worker");
  const started = performance.now();
  engine = Promise.resolve(cv({ wasmBinary: wasm }));
  try {
    const module = await engine;
    post({
      id,
      type: "initialized",
      initMs: performance.now() - started,
      buildInformation: module.getBuildInformation?.() ?? "OpenCV ready",
    });
  } catch (error) {
    engine = null;
    throw error;
  }
}

async function process(request: ProcessRequest) {
  if (!engine) throw new Error("请先初始化 OpenCV");
  const module = await engine;
  const started = performance.now();
  const source = module.matFromImageData({
    data: new Uint8ClampedArray(request.rgba),
    width: request.width,
    height: request.height,
  });
  const gray = new module.Mat();
  const result = new module.Mat();
  try {
    module.cvtColor(source, gray, module.COLOR_RGBA2GRAY);
    module.cvtColor(gray, result, module.COLOR_GRAY2RGBA);
    const rgba = new Uint8Array(result.data);
    post(
      {
        id: request.id,
        type: "processed",
        width: request.width,
        height: request.height,
        rgba: rgba.buffer,
        processMs: performance.now() - started,
      },
      [rgba.buffer],
    );
  } finally {
    source.delete();
    gray.delete();
    result.delete();
  }
}

async function handle(request: ScannerRequest) {
  try {
    if (request.type === "init") await initialize(request.id, request.wasm);
    else await process(request);
  } catch (error) {
    post({
      id: request.id,
      type: "error",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

scope.onmessage = (event: MessageEvent<ScannerRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request));
};
