export interface Point {
  x: number;
  y: number;
}

export type Corners = [Point, Point, Point, Point];
export type ScanMode = "gray" | "enhanced" | "binary";

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
  corners?: Corners;
  turns: number;
  mode: ScanMode;
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
  corners?: Corners;
}

export interface ErrorResponse {
  id: number;
  type: "error";
  message: string;
}

export type ScannerResponse = InitializedResponse | ProcessedResponse | ErrorResponse;
