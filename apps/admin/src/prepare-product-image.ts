/**
 * Web-only image preparation. Large camera images are decoded in-browser and
 * converted to a bounded WebP/JPEG before requesting a short-lived R2 PUT URL.
 * Server-side limits remain authoritative and unchanged.
 */
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 1600;

export interface PreparedProductImage {
  blob: Blob;
  contentType: "image/webp" | "image/jpeg";
  originalBytes: number;
  width: number;
  height: number;
}

async function loadSource(file: File): Promise<{
  source: CanvasImageSource; width: number; height: number; release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height,
        release: () => bitmap.close() };
    } catch { /* Safari can decode some formats only via HTMLImageElement. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new globalThis.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(Error("Không đọc được ảnh. Hãy thử ảnh JPG, PNG hoặc WebP."));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encode(canvas: HTMLCanvasElement, type: "image/webp" | "image/jpeg",
  quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareProductImage(file: File): Promise<PreparedProductImage> {
  if (!file.type.startsWith("image/") || file.size === 0 || file.size > MAX_SOURCE_BYTES) {
    throw Error("Chọn ảnh hợp lệ, dung lượng ảnh gốc không quá 32 MB.");
  }
  const decoded = await loadSource(file);
  try {
    if (!decoded.width || !decoded.height || decoded.width > 30000 || decoded.height > 30000) {
      throw Error("Kích thước ảnh không hợp lệ.");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw Error("Thiết bị không hỗ trợ xử lý ảnh.");
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const types: ("image/webp" | "image/jpeg")[] = ["image/webp", "image/jpeg"];
    for (const type of types) {
      // Large textured photos may still exceed 2 MB at 1600px. Keep reducing
      // dimensions rather than silently rejecting an otherwise valid image.
      let candidateWidth = width;
      let candidateHeight = height;
      for (let attempt = 0; attempt < 7; attempt++) {
        canvas.width = candidateWidth;
        canvas.height = candidateHeight;
        context.clearRect(0, 0, candidateWidth, candidateHeight);
        if (type === "image/jpeg") {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, candidateWidth, candidateHeight);
        }
        context.drawImage(decoded.source, 0, 0, candidateWidth, candidateHeight);
        let supportsType = false;
        for (const quality of [0.88, 0.74, 0.58, 0.43]) {
          const blob = await encode(canvas, type, quality);
          if (!blob || blob.type !== type) break;
          supportsType = true;
          if (blob.size > 0 && blob.size <= MAX_UPLOAD_BYTES) {
            return { blob, contentType: type, originalBytes: file.size,
              width: candidateWidth, height: candidateHeight };
          }
        }
        if (!supportsType || Math.max(candidateWidth, candidateHeight) <= 360) break;
        candidateWidth = Math.max(1, Math.round(candidateWidth * 0.78));
        candidateHeight = Math.max(1, Math.round(candidateHeight * 0.78));
      }
    }
    throw Error("Không nén được ảnh dưới 2 MB. Hãy chọn ảnh khác.");
  } finally {
    decoded.release();
  }
}
