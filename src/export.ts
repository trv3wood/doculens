import { PDFDocument } from "pdf-lib";

export type ExportFormat = "jpeg" | "png" | "pdf";

type ScanExport = { blob: Blob; pdf?: { pageCount: number; width: number; height: number } };

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(`${type} 编码返回空结果`)),
      type,
      quality,
    );
  });
}

export function createScanExports(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const files = new Map<ExportFormat, Promise<ScanExport>>();

  function getFile(format: ExportFormat): Promise<ScanExport> {
    const existing = files.get(format);
    if (existing) return existing;
    // PDF 与 PNG 导出共用同一次 PNG 编码，包括尚未完成的任务。
    const pending = format === "pdf"
      ? getFile("png").then(({ blob }) => embedPdf(blob, width, height))
      : canvasToBlob(canvas, `image/${format}`, format === "jpeg" ? 0.9 : undefined).then((blob) => ({ blob }));
    const file = pending.catch((error) => {
      files.delete(format);
      throw error;
    });
    files.set(format, file);
    return file;
  }

  return (format: ExportFormat) => ({
    reused: files.has(format),
    file: getFile(format),
  });
}

async function embedPdf(png: Blob, width: number, height: number) {
  // PDF 长边固定 842pt，短边按图像比例计算。
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await png.arrayBuffer());
  const scale = 842 / Math.max(width, height);
  const pageWidth = width * scale;
  const pageHeight = height * scale;
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });
  const bytes = await pdf.save();
  const size = page.getSize();
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    pdf: { pageCount: pdf.getPageCount(), width: size.width, height: size.height },
  };
}

export function exportName(format: ExportFormat) {
  return `doculens-scan.${format === "jpeg" ? "jpg" : format}`;
}
