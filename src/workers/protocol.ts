export interface Point {
  x: number;
  y: number;
}

export type Corners = [Point, Point, Point, Point];
export type ScanMode = "gray" | "enhanced" | "binary";
export type BlurType = "auto" | "motion" | "defocus";

export type SkipReason =
  | "no-peaks"
  | "too-many-peaks"
  | "psf-low-confidence"
  | "out-of-range"
  | "low-detail"
  | "guard"
  | "memory"
  | "error";

export interface SpectralDiagnostics {
  applied: boolean;
  reason?: SkipReason;
  mode: "full" | "sine" | "ola" | "none";
  peakPairs: number;
  confidence: number;
  sigmaPx: number;
  frequencies: { fx: number; fy: number; strength: number }[];
  detail?: string;
  ms: number;
}

export interface RestoreDiagnostics {
  applied: boolean;
  reason?: SkipReason;
  requested: BlurType;
  psfType?: "motion" | "defocus";
  psf?: { lengthPx?: number; radiusPx?: number; angleDeg?: number };
  confidence: number;
  method?: "full-wiener" | "ola-wiener" | "fir";
  balance: number;
  gainCap: number;
  detail?: string;
  ms: number;
}

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
  moire?: boolean;
  deblur?: boolean;
  blurType?: BlurType;
}

export interface SelftestRequest {
  id: number;
  type: "selftest";
}

export type ScannerRequest = InitRequest | ProcessRequest | SelftestRequest;

export interface InitializedResponse {
  id: number;
  type: "initialized";
  initMs: number;
  buildInformation: string;
  dft: boolean;
}

export interface ProcessedResponse {
  id: number;
  type: "processed";
  width: number;
  height: number;
  rgba: ArrayBuffer;
  processMs: number;
  detectMs?: number;
  corners?: Corners;
  spectral?: SpectralDiagnostics;
  restore?: RestoreDiagnostics;
}

export interface SelftestResponse {
  id: number;
  type: "selftest";
  dft: boolean;
  constants: { inverse: number; scale: number; complexOutput: number; realOutput: number };
  maxError: number;
  optimal4000: number;
  optimal3000: number;
  inPlace: boolean;
  ms: number;
}

export interface ErrorResponse {
  id: number;
  type: "error";
  message: string;
}

export type ScannerResponse =
  | InitializedResponse
  | ProcessedResponse
  | SelftestResponse
  | ErrorResponse;
