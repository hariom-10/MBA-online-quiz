import { inflateSync } from "node:zlib";

function decodePdfString(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 92) {
      const next = bytes[++i];
      if (next === 110 || next === 114) out += "\n";
      else if (next === 116) out += "\t";
      else if (next === 98) out += "\b";
      else if (next === 102) out += "\f";
      else if (next >= 48 && next <= 55) {
        let octal = String.fromCharCode(next);
        for (let count = 0; count < 2 && bytes[i + 1] >= 48 && bytes[i + 1] <= 55; count++) octal += String.fromCharCode(bytes[++i]);
        out += String.fromCharCode(parseInt(octal, 8));
      } else if (next === 10) { /* PDF line continuation */ }
      else if (next === 13) { if (bytes[i + 1] === 10) i++; }
      else if (next !== undefined) out += String.fromCharCode(next);
    } else out += String.fromCharCode(c);
  }
  return out;
}

function decodeHex(hex) {
  const clean = hex.replace(/\s/g, "").replace(/>$/, "");
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = Buffer.from(padded, "hex");
  if (bytes.length >= 2 && bytes[0] === 0 && bytes[1] !== 0) {
    try { return new TextDecoder("utf-16be").decode(bytes); } catch { /* use byte mapping */ }
  }
  return [...bytes].map((byte) => String.fromCharCode(byte)).join("");
}

export function extractPdfText(buffer) {
  const source = buffer.toString("latin1");
  if (!source.startsWith("%PDF-")) throw new Error("Choose a valid PDF file.");
  const text = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamPattern)) {
    let stream = Buffer.from(match[2], "latin1");
    if (/\/FlateDecode/.test(match[1])) {
      try { stream = inflateSync(stream); } catch { continue; }
    }
    const content = stream.toString("latin1");
    const tokenPattern = /\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj|\[((?:[\s\S])*?)\]\s*TJ|<([\da-fA-F\s]+)>\s*Tj/g;
    for (const token of content.matchAll(tokenPattern)) {
      if (token[1] !== undefined) text.push(decodePdfString(Buffer.from(token[1], "latin1")));
      else if (token[2] !== undefined) {
        for (const item of token[2].matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|<([\da-fA-F\s]+)>|(-?\d+(?:\.\d+)?)/g)) {
          if (item[1] !== undefined) text.push(decodePdfString(Buffer.from(item[1], "latin1")));
          else if (item[2] !== undefined) text.push(decodeHex(item[2]));
          else if (Number(item[3]) < -120) text.push(" ");
        }
        text.push("\n");
      } else text.push(decodeHex(token[3]));
      text.push(" ");
    }
    if (/\bT\*/.test(content)) text.push("\n");
  }
  return text.join("").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export function isUsablePdfText(text) {
  const compact = text.replace(/\s/g, "");
  const readableCharacters = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return compact.length >= 20 && readableCharacters / compact.length >= 0.4;
}
