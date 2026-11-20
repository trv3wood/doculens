import { PDFDocument } from "pdf-lib";

export type ExportFormat = "jpeg" | "png" | "pdf";

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(`${type} 编码返回空结果`)),
      type,
      quality,
    );
  });
}

export async function prepareExport(canvas: HTMLCanvasElement, format: ExportFormat) {
  if (format !== "pdf") {
    return canvasToBlob(canvas, `image/${format}`, format === "jpeg" ? 0.9 : undefined);
  }

  // PDF 不拉伸到 A4：长边固定 842pt，短边按图像比例计算，不重采样。
  const png = await canvasToBlob(canvas, "image/png");
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await png.arrayBuffer());
  const scale = 842 / Math.max(canvas.width, canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const page = pdf.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export function exportName(format: ExportFormat) {
  return `doculens-scan.${format === "jpeg" ? "jpg" : format}`;
}
