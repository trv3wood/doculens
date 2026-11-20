export interface InitRequest {
  id: number;
  type: "init";
  wasm: ArrayBuffer;
}

export interface ProcessRequest {
  id: number;
  type: "process";
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

export type ScannerRequest = InitRequest | ProcessRequest;

export interface InitializedResponse {
  id: number;
  type: "initialized";
  initMs: number;
  buildInformation: string;
}

export interface ProcessedResponse {
  id: number;
  type: "processed";
  width: number;
  height: number;
  rgba: ArrayBuffer;
  processMs: number;
}

export interface ErrorResponse {
  id: number;
  type: "error";
  message: string;
}

export type ScannerResponse = InitializedResponse | ProcessedResponse | ErrorResponse;
