import type { ProcessRequest, ScannerRequest, ScannerResponse } from "./protocol";

export class ScannerClient {
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: ScannerResponse) => void;
    reject: (error: Error) => void;
  }>();

  private constructor(private worker: Worker) {
    worker.onmessage = (event: MessageEvent<ScannerResponse>) => {
      const message = event.data;
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      if (message.type === "error") task.reject(new Error(message.message));
      else task.resolve(message);
    };
    worker.onerror = (event) => this.fail(new Error(event.message || "Worker 执行失败"));
    worker.onmessageerror = () => this.fail(new Error("Worker 消息反序列化失败"));
  }

  static async create(factory: () => Promise<Worker>) {
    return new ScannerClient(await factory());
  }

  private request(message: ScannerRequest, transfer: Transferable[]) {
    const id = message.id;
    return new Promise<ScannerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  async initialize(wasm: ArrayBuffer) {
    const response = await this.request({ id: this.nextId++, type: "init", wasm }, [wasm]);
    if (response.type !== "initialized") throw new Error("OpenCV 初始化响应无效");
    return response;
  }

  async process(input: Omit<ProcessRequest, "id" | "type">) {
    const response = await this.request(
      { id: this.nextId++, type: "process", ...input },
      [input.rgba],
    );
    if (response.type !== "processed") throw new Error("图像处理响应无效");
    return response;
  }

  private fail(error: Error) {
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }

  terminate() {
    this.worker.terminate();
    this.fail(new Error("Worker 已终止"));
  }
}
