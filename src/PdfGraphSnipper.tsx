import { useState, useEffect, useRef, type MouseEvent, type ChangeEvent } from "react";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Crop,
  Check,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  Upload,
  RefreshCw,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface PdfGraphSnipperProps {
  file?: File | null;
  onApply: (croppedDataUrl: string) => void;
  onClose: () => void;
  questionNumber?: number | string | null;
}

export function PdfGraphSnipper({
  file,
  onApply,
  onClose,
  questionNumber,
}: PdfGraphSnipperProps) {
  const [activeTab, setActiveTab] = useState<"pdf" | "upload">(file ? "pdf" : "upload");
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.4);
  const [rendering, setRendering] = useState<boolean>(false);

  // Marquee crop state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Load PDF document from file
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    file.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      pdfjsLib.getDocument({ data: buffer }).promise.then((doc) => {
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      }).catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load PDF");
      });
    });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // Render current PDF page to canvas
  useEffect(() => {
    if (!pdfDoc || activeTab !== "pdf") return;
    let cancelled = false;
    setRendering(true);
    setCropRect(null);

    pdfDoc.getPage(currentPage).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        if (cancelled) return;
        setRendering(false);
      }).catch(() => {
        if (cancelled) return;
        setRendering(false);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, scale, activeTab]);

  // Handle Drag / Marquee Selection on Canvas
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current || rendering) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDragging(true);
    setDragStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
    setPreviewUrl(null);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStart || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const x = Math.min(dragStart.x, curX);
    const y = Math.min(dragStart.y, curY);
    const w = Math.abs(curX - dragStart.x);
    const h = Math.abs(curY - dragStart.y);

    setCropRect({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    if (cropRect && cropRect.w > 15 && cropRect.h > 15 && canvasRef.current) {
      generateCroppedPreview(cropRect);
    }
  };

  // Generate high-resolution cropped preview
  const generateCroppedPreview = (rect: { x: number; y: number; w: number; h: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Convert CSS display coordinates to actual canvas internal pixels
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;

    const sourceX = rect.x * scaleX;
    const sourceY = rect.y * scaleY;
    const sourceW = rect.w * scaleX;
    const sourceH = rect.h * scaleY;

    const offCanvas = document.createElement("canvas");
    offCanvas.width = Math.round(sourceW);
    offCanvas.height = Math.round(sourceH);
    const offCtx = offCanvas.getContext("2d");
    if (!offCtx) return;

    offCtx.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      offCanvas.width,
      offCanvas.height
    );

    try {
      const dataUrl = offCanvas.toDataURL("image/webp", 0.92);
      setPreviewUrl(dataUrl);
    } catch {
      const dataUrl = offCanvas.toDataURL("image/png");
      setPreviewUrl(dataUrl);
    }
  };

  // Handle direct file upload or clipboard paste
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPreviewUrl(reader.result);
      }
    };
    reader.readAsDataURL(f);
  };

  // Listen to Ctrl+V clipboard paste
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                setPreviewUrl(reader.result);
                setActiveTab("upload");
              }
            };
            reader.readAsDataURL(blob);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <div className="modal-overlay">
      <div className="pdf-snipper-modal">
        {/* Header */}
        <div className="pdf-snipper-header">
          <div className="pdf-snipper-title">
            <Crop size={20} className="icon-blue" />
            <div>
              <h3>Snip Graph / Diagram from PDF</h3>
              <span>
                {questionNumber ? `Question ${questionNumber}` : "Active Question"} · Drag mouse over chart or table to crop
              </span>
            </div>
          </div>

          <div className="pdf-snipper-tabs">
            <button
              type="button"
              className={`snipper-tab ${activeTab === "pdf" ? "active" : ""}`}
              onClick={() => setActiveTab("pdf")}
            >
              PDF Page Snip
            </button>
            <button
              type="button"
              className={`snipper-tab ${activeTab === "upload" ? "active" : ""}`}
              onClick={() => setActiveTab("upload")}
            >
              Upload / Paste (Ctrl+V)
            </button>
            <button type="button" className="icon-button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}

        {/* Body */}
        {activeTab === "pdf" ? (
          <div className="pdf-snipper-body">
            {/* Toolbar */}
            <div className="pdf-snipper-toolbar">
              <div className="page-nav-controls">
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={currentPage <= 1 || rendering}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ArrowLeft size={15} /> Prev Page
                </button>
                <span className="page-indicator">
                  Page <b>{currentPage}</b> of {numPages}
                </span>
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={currentPage >= numPages || rendering}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next Page <ArrowRight size={15} />
                </button>
              </div>

              <div className="zoom-controls">
                <button
                  type="button"
                  className="icon-button"
                  title="Zoom Out"
                  disabled={scale <= 0.9}
                  onClick={() => setScale((s) => Math.max(0.8, Number((s - 0.2).toFixed(1))))}
                >
                  <ZoomOut size={16} />
                </button>
                <span className="zoom-value">{Math.round(scale * 100)}%</span>
                <button
                  type="button"
                  className="icon-button"
                  title="Zoom In"
                  disabled={scale >= 2.4}
                  onClick={() => setScale((s) => Math.min(2.5, Number((s + 0.2).toFixed(1))))}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  title="Reset Selection"
                  onClick={() => {
                    setCropRect(null);
                    setPreviewUrl(null);
                  }}
                >
                  <RefreshCw size={14} /> Clear Box
                </button>
              </div>
            </div>

            {/* Canvas Viewing Area with Marquee Overlay */}
            <div
              className="pdf-canvas-container"
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              {rendering && (
                <div className="pdf-render-spinner">
                  <div className="spinner" />
                  <span>Rendering page {currentPage}...</span>
                </div>
              )}
              <div className="pdf-canvas-wrapper">
                <canvas ref={canvasRef} className="pdf-page-canvas" />

                {/* Selection Marquee Box */}
                {cropRect && cropRect.w > 0 && cropRect.h > 0 && (
                  <div
                    className="crop-selection-box"
                    style={{
                      left: `${cropRect.x}px`,
                      top: `${cropRect.y}px`,
                      width: `${cropRect.w}px`,
                      height: `${cropRect.h}px`,
                    }}
                  >
                    <span className="crop-label">
                      {Math.round(cropRect.w)} × {Math.round(cropRect.h)}
                    </span>
                    <div className="crop-handle crop-handle-tl" />
                    <div className="crop-handle crop-handle-tr" />
                    <div className="crop-handle crop-handle-bl" />
                    <div className="crop-handle crop-handle-br" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="pdf-upload-body">
            <div className="upload-dropzone">
              <ImageIcon size={44} className="icon-blue" />
              <h4>Upload or Paste Graph Image</h4>
              <p>You can paste directly from your clipboard using <b>Ctrl + V</b> (or Command + V), or choose a PNG / JPG / WebP image file.</p>
              <label className="button button-outline upload-btn-label">
                <Upload size={16} /> Browse Image File
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileUpload}
                  style={{ display: "none" }}
                />
              </label>
            </div>
          </div>
        )}

        {/* Footer with Cropped Preview and Apply Button */}
        <div className="pdf-snipper-footer">
          <div className="pdf-snipper-preview-box">
            {previewUrl ? (
              <div className="snipper-preview-wrap">
                <img src={previewUrl} alt="Cropped Preview" className="snipper-preview-img" />
                <span className="preview-ready-tag">✓ Ready to attach</span>
              </div>
            ) : (
              <span className="snipper-preview-hint">
                Drag a box around the graph or table to preview it here.
              </span>
            )}
          </div>

          <div className="pdf-snipper-actions">
            <button type="button" className="button button-quiet" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!previewUrl}
              onClick={() => {
                if (previewUrl) {
                  onApply(previewUrl);
                  onClose();
                }
              }}
            >
              <Check size={16} /> Attach Graph to Question
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
