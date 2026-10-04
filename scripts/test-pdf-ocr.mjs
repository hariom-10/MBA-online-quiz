import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { extractPdfText, isUsablePdfText } from "../server/pdfText.mjs";
import { recognizePdf } from "../server/pdfOcr.mjs";

function makePdf(objects) {
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  let position = parts[0].length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(position);
    const part = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), objects[i], Buffer.from("\nendobj\n", "latin1")]);
    parts.push(part); position += part.length;
  }
  const xrefOffset = position;
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "latin1"));
  return Buffer.concat(parts);
}

function makeScannedQuestionPdf() {
  const width = 1500, height = 1940;
  const makePage = (lines) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "black"; ctx.font = "bold 48px Arial"; ctx.fillText("CAT PRACTICE QUESTIONS", 120, 180);
    ctx.font = "38px Arial"; lines.forEach((line, index) => ctx.fillText(line, 120, 330 + index * 90));
    return canvas.toBuffer("image/jpeg", 0.96);
  };
  const image1 = makePage(["1. A car travels 120 km in 2 hours. What is its speed?", "A. 40 km/h     B. 50 km/h     C. 60 km/h     D. 80 km/h"]);
  const image2 = makePage(["2. Which is an even number?", "A. 3            B. 4            C. 5            D. 7"]);
  const imageObject = (name, jpeg) => Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, "latin1"), jpeg, Buffer.from("\nendstream", "latin1")]);
  const pageContent = (imageName) => {
    const stream = Buffer.from(`q\n612 0 0 792 0 0 cm\n/${imageName} Do\nQ`, "latin1");
    return Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]);
  };
  return makePdf([
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 7 0 R >>", "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 6 0 R >> >> /Contents 8 0 R >>", "latin1"),
    imageObject("Im0", image1), imageObject("Im1", image2), pageContent("Im0"), pageContent("Im1"),
  ]);
}

const selectablePdf = makePdf([
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "latin1"),
  Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
  Buffer.from("<< /Length 105 >>\nstream\nBT /F1 14 Tf 72 720 Td (1. What is 2 + 2?) Tj T* (A. 3   B. 4   C. 5   D. 6) Tj ET\nendstream", "latin1"),
]);
const nativeText = extractPdfText(selectablePdf);
assert.match(nativeText, /What is 2 \+ 2/);
assert.equal(isUsablePdfText(nativeText), true, `Native extraction returned: ${nativeText}`);
console.log("Selectable-text PDF extraction: passed");

const scannedPdf = makeScannedQuestionPdf();
assert.equal(isUsablePdfText(extractPdfText(scannedPdf)), false);
let pagesProcessed = 0;
const result = await recognizePdf(scannedPdf, (event) => { if (event.type === "page") pagesProcessed++; });
assert.equal(result.pageCount, 2);
assert.match(result.text, /120 km in 2 hours/i);
assert.match(result.text, /60 km\/h/i);
assert.match(result.text, /even number/i);
assert.equal(pagesProcessed, 2);
console.log("Two-page scanned PDF automatic OCR fallback: passed (questions and options recognized on both pages)");
