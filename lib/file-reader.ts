"use client";

import { parseStatement, type ParseResult } from "./import-parser.ts";
import type { SourceType } from "./types.ts";
import type { Worker as OcrWorker } from "tesseract.js";

export interface ReadStatementOptions { referenceMonth: string; sourceType: SourceType }
export type StatementProgress = (message: string) => void;

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 20;
const MAX_CANVAS_PIXELS = 4_000_000;

function decodeStatement(bytes: ArrayBuffer): { text: string; warnings: string[] } {
  const data = new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(data), warnings: [] };
  if (data[0] === 0xfe && data[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(data), warnings: [] };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(data), warnings: [] }; }
  catch { return { text: new TextDecoder("windows-1252").decode(data), warnings: ["O arquivo usa codificação Windows-1252; confira acentos e descrições."] }; }
}

async function createOcrWorker(onProgress: StatementProgress): Promise<OcrWorker> {
  onProgress("Preparando leitura de imagem neste aparelho…");
  const { createWorker } = await import("tesseract.js");
  // Document pixels stay in a browser worker. Tesseract downloads its public engine
  // and por/eng language resources from its CDNs on first use; it does not upload files.
  return createWorker("por+eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
    logger: event => {
      if (event.status === "recognizing text") onProgress(`Reconhecendo texto neste aparelho: ${Math.round(event.progress * 100)}%`);
    },
  });
}

async function recognize(worker: OcrWorker, canvas: HTMLCanvasElement): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      worker.recognize(canvas),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("A leitura da imagem demorou demais. Envie uma imagem menor ou prefira CSV/OFX.")), 120_000); }),
    ]);
    return result.data.text;
  } finally { if (timer) clearTimeout(timer); }
}

interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }
function isTextItem(value: unknown): value is PdfTextItem { return !!value && typeof value === "object" && "str" in value && "transform" in value; }

/** Sort by baseline and x position; retain column gaps instead of flattening a table. */
function pdfLines(items: unknown[]): string {
  const groups: { y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of items.filter(isTextItem)) {
    if (!item.str.trim()) continue;
    const y = item.transform[5], height = Math.abs(item.height || item.transform[3] || 10);
    let group = groups.find(line => Math.abs(line.y - y) <= Math.max(2, Math.min(height, line.height) * 0.35));
    if (!group) { group = { y, height, items: [] }; groups.push(group); }
    group.items.push(item);
  }
  return groups.sort((a, b) => b.y - a.y).map(group => {
    const sorted = group.items.sort((a, b) => a.transform[4] - b.transform[4]);
    return sorted.map((item, index) => {
      if (index === 0) return item.str;
      const previous = sorted[index - 1], gap = item.transform[4] - (previous.transform[4] + previous.width);
      return `${gap > Math.max(5, group.height * 0.7) ? "   " : " "}${item.str}`;
    }).join("");
  }).join("\n");
}

async function readPdf(file: File, onProgress: StatementProgress): Promise<{ text: string; warnings: string[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  let worker: OcrWorker | undefined;
  const warnings: string[] = [], pages: string[] = [];
  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`Este PDF tem ${document.numPages} páginas. Envie arquivos com até ${MAX_PDF_PAGES} páginas para evitar falhas no celular.`);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      onProgress(`Lendo PDF: página ${pageNumber} de ${document.numPages}…`);
      const page = await document.getPage(pageNumber);
      let pageText = pdfLines((await page.getTextContent()).items);
      if (pageText.replace(/\s/g, "").length < 50) {
        worker ??= await createOcrWorker(onProgress);
        onProgress(`Lendo imagem do PDF: página ${pageNumber} de ${document.numPages}…`);
        const initial = page.getViewport({ scale: 1 });
        const scale = Math.min(2.2, Math.sqrt(MAX_CANVAS_PIXELS / (initial.width * initial.height)));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d"); if (!context) throw new Error("Este navegador não conseguiu preparar a página para leitura.");
        try { await page.render({ canvas, canvasContext: context, viewport }).promise; pageText = await recognize(worker, canvas); }
        finally { canvas.width = 0; canvas.height = 0; }
      }
      pages.push(pageText); page.cleanup();
    }
    if (worker) warnings.push("O PDF contém páginas digitalizadas. O reconhecimento ocorreu neste aparelho; confira datas e valores. Os recursos públicos de OCR são baixados pela internet na primeira utilização.");
    return { text: pages.join("\n"), warnings };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new Error("O PDF está protegido por senha. Exporte uma cópia sem senha pelo aplicativo da instituição.");
    if (name === "InvalidPDFException") throw new Error("O arquivo PDF está incompleto ou inválido. Baixe outra cópia pelo aplicativo da instituição.");
    if (error instanceof Error && /worker/i.test(error.message)) throw new Error("Não foi possível iniciar o leitor de PDF. Atualize a página e tente novamente.");
    throw error;
  } finally {
    if (worker) await worker.terminate();
    await task.destroy();
  }
}

async function readImage(file: File, onProgress: StatementProgress): Promise<{ text: string; warnings: string[] }> {
  const url = URL.createObjectURL(file);
  let worker: OcrWorker | undefined;
  const canvas = window.document.createElement("canvas");
  try {
    const picture = new Image();
    await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("A imagem não pôde ser aberta. Envie PNG ou JPG legível.")); picture.src = url; });
    if (!picture.naturalWidth || !picture.naturalHeight || picture.naturalWidth * picture.naturalHeight > 40_000_000) throw new Error("A imagem tem dimensões muito grandes. Reduza para até 40 megapixels ou exporte PDF/CSV/OFX.");
    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (picture.naturalWidth * picture.naturalHeight)));
    canvas.width = Math.ceil(picture.naturalWidth * scale); canvas.height = Math.ceil(picture.naturalHeight * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("Este navegador não conseguiu preparar a imagem para leitura.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    worker = await createOcrWorker(onProgress);
    return { text: await recognize(worker, canvas), warnings: ["O reconhecimento da imagem ocorreu neste aparelho. Confira todos os lançamentos; fotos desfocadas ou colunas cortadas podem impedir a leitura. Os recursos públicos de OCR são baixados pela internet na primeira utilização."] };
  } finally { URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0; if (worker) await worker.terminate(); }
}

export async function readStatementFile(file: File, options: ReadStatementOptions, onProgress: StatementProgress = () => {}): Promise<ParseResult> {
  if (typeof window === "undefined") throw new Error("Abra a importação no navegador para ler o arquivo neste aparelho.");
  if (!file.size) throw new Error("O arquivo está vazio. Exporte uma nova cópia.");
  if (file.size > MAX_BYTES) throw new Error("O arquivo excede 15 MB. Exporte um período menor ou reduza a imagem.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "tsv", "ofx", "txt", "pdf", "png", "jpg", "jpeg"].includes(extension || "")) throw new Error("Formato não suportado. Envie CSV, OFX, PDF, TXT, PNG ou JPG.");
  onProgress("Abrindo arquivo neste aparelho…");
  let extracted: { text: string; warnings: string[] };
  try {
    if (extension === "pdf") extracted = await readPdf(file, onProgress);
    else if (["png", "jpg", "jpeg"].includes(extension || "")) extracted = await readImage(file, onProgress);
    else extracted = decodeStatement(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && /fetch|network|load|worker/i.test(error.message) && extension !== "pdf") throw new Error("Não foi possível carregar os recursos de leitura de imagem. Verifique a conexão e tente novamente, ou use CSV/OFX.");
    throw error;
  }
  onProgress("Identificando lançamentos…");
  const result = parseStatement(extracted.text, { ...options, fileName: file.name });
  return { ...result, warnings: [...extracted.warnings, ...result.warnings] };
}
