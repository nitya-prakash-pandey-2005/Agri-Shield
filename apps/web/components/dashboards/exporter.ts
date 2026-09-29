"use client";

/**
 * Dashboard → PNG / PDF without extra dependencies.
 *
 * The live DOM is cloned with every computed style inlined, <canvas> elements
 * (Leaflet vector layers) are swapped for their bitmaps, and CORS-enabled
 * images (map tiles, requested with crossOrigin) are inlined as data URLs.
 * The clone is wrapped in an SVG <foreignObject>, drawn onto a canvas and
 * encoded. PDF = the same bitmap placed on landscape A4 pages with jsPDF.
 * Elements marked [data-export-hide] are left out.
 */

const SKIP_PROPS = new Set(["transition", "transition-property", "transition-duration", "animation", "animation-name", "will-change", "cursor"]);

function inlineStyles(src: Element, dst: Element) {
  const cs = getComputedStyle(src);
  const parts: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i]!;
    if (SKIP_PROPS.has(p)) continue;
    parts.push(`${p}:${cs.getPropertyValue(p)}`);
  }
  (dst as HTMLElement).setAttribute("style", parts.join(";"));
}

function imgToDataUrl(img: HTMLImageElement): string | null {
  try {
    if (!img.complete || !img.naturalWidth) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null; // tainted (no CORS) — leave it out
  }
}

function cloneForExport(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  const srcAll = [root, ...Array.from(root.querySelectorAll("*"))];
  const dstAll = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const drop: Element[] = [];
  for (let i = 0; i < srcAll.length; i++) {
    const s = srcAll[i]!;
    const d = dstAll[i]!;
    if (!d) continue;
    if (s.hasAttribute("data-export-hide")) {
      drop.push(d);
      continue;
    }
    inlineStyles(s, d);
    if (s instanceof HTMLCanvasElement) {
      try {
        const img = document.createElement("img");
        img.src = s.toDataURL("image/png");
        img.setAttribute("style", d.getAttribute("style") ?? "");
        d.replaceWith(img);
      } catch {
        /* tainted canvas */
      }
    } else if (s instanceof HTMLImageElement) {
      const data = s.src.startsWith("data:") ? s.src : imgToDataUrl(s);
      if (data) (d as HTMLImageElement).src = data;
      else (d as HTMLElement).style.visibility = "hidden";
      d.removeAttribute("srcset");
    }
  }
  for (const d of drop) d.remove();
  return clone;
}

export async function renderNodeToCanvas(node: HTMLElement, scale = 2, background = "#050914"): Promise<HTMLCanvasElement> {
  const rect = node.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(node.scrollHeight || rect.height);
  const clone = cloneForExport(node);
  clone.style.margin = "0";
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("The browser could not render this dashboard to an image."));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "dashboard";

export async function exportPng(node: HTMLElement, name: string) {
  const canvas = await renderNodeToCanvas(node);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  const url = URL.createObjectURL(blob);
  download(url, `${slug(name)}-${new Date().toISOString().slice(0, 10)}.png`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportPdf(node: HTMLElement, meta: { title: string; subtitle: string }) {
  const canvas = await renderNodeToCanvas(node, 1.6);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const headerH = 44;
  const footerH = 22;
  const usableW = pw - margin * 2;
  const usableH = ph - margin - headerH - footerH;
  const scale = usableW / canvas.width;
  const sliceH = Math.floor(usableH / scale); // source pixels per page
  const pages = Math.max(1, Math.ceil(canvas.height / sliceH));
  for (let p = 0; p < pages; p++) {
    if (p) pdf.addPage();
    pdf.setFillColor(5, 9, 20);
    pdf.rect(0, 0, pw, ph, "F");
    pdf.setTextColor(226, 232, 240);
    pdf.setFontSize(14);
    pdf.text(meta.title, margin, margin + 8);
    pdf.setFontSize(8.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text(meta.subtitle, margin, margin + 24);
    const part = document.createElement("canvas");
    const h = Math.min(sliceH, canvas.height - p * sliceH);
    part.width = canvas.width;
    part.height = h;
    part.getContext("2d")!.drawImage(canvas, 0, p * sliceH, canvas.width, h, 0, 0, canvas.width, h);
    pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin + headerH - 8, usableW, h * scale);
    pdf.setFontSize(7.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text(`Agri-SHIELD · every figure carries its data source on screen · page ${p + 1}/${pages}`, margin, ph - 12);
  }
  pdf.save(`${slug(meta.title)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
