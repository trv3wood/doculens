import { getSDK } from "@discourse-mini-app/sdk";
import type { MiniAppSDK, MiniAppTheme } from "@discourse-mini-app/sdk";

function getSDKSafe() {
  try {
    return getSDK();
  } catch {
    return null;
  }
}

export function getErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && code) return code;
  if (error instanceof Error) {
    const match = error.message.match(/[A-Z][A-Z_]{3,}/);
    return match?.[0] ?? null;
  }
  return null;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class Platform {
  readonly sdk: MiniAppSDK | null = getSDKSafe();
  private unsubscribe: (() => void) | null = null;

  async connect(onTheme: (theme: MiniAppTheme) => void) {
    if (!this.sdk) return;
    await this.sdk.ready;
    if (this.sdk.permissions.has("theme.read")) {
      onTheme(await this.sdk.theme.get());
      this.unsubscribe = this.sdk.theme.onChange(onTheme);
    }
  }

  async ready() {
    if (this.sdk) await this.sdk.lifecycle.ready();
  }

  async readWasm(): Promise<ArrayBuffer> {
    if (this.sdk) return exactBuffer(await this.sdk.assets.readBytes("wasm/opencv.wasm"));
    const response = await fetch("/wasm/opencv.wasm");
    if (!response.ok) throw new Error(`WASM 读取失败：HTTP ${response.status}`);
    return response.arrayBuffer();
  }

  async createWorker(): Promise<Worker> {
    if (this.sdk) {
      if (!this.sdk.permissions.has("workers.create")) {
        throw new Error("PERMISSION_DENIED: workers.create");
      }
      return this.sdk.workers.create("workers/scanner.js");
    }
    return new Worker("/workers/scanner.js");
  }

  /** 必须在可信点击处理器中直接调用，不能先 await 编码。 */
  save(name: string, blob: Blob): Promise<unknown> {
    if (this.sdk) {
      if (!this.sdk.permissions.has("files.save")) {
        return Promise.reject(new Error("PERMISSION_DENIED: files.save"));
      }
      return this.sdk.files.save(name, blob);
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Promise.resolve(null);
  }

  get canShare() {
    return !!this.sdk?.permissions.has("sharing.share");
  }

  share(name: string, blob: Blob): Promise<unknown> {
    if (!this.sdk || !this.canShare) {
      return Promise.reject(new Error("PERMISSION_DENIED: sharing.share"));
    }
    const file = new File([blob], name, { type: blob.type });
    return this.sdk.sharing.share({ title: "DocuLens 扫描件", files: [file] });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
