export const AVATAR_SIZE = 512;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MIN_DIM = 64;
export const MAX_DIM = 3000;

export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "image/webp",
] as const;

export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");

/** Returns an error message, or null when the file passes type+size checks. */
export function validateFileBasics(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Неподдерживаемый формат. Разрешены JPG, PNG, GIF, SVG, WEBP.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "Файл больше 15 МБ.";
  }
  return null;
}

/** Returns an error message, or null when raster dimensions are within bounds. */
export function validateDimensions(width: number, height: number): string | null {
  if (width < MIN_DIM || height < MIN_DIM) {
    return "Изображение меньше 64×64 пикселей.";
  }
  if (width > MAX_DIM || height > MAX_DIM) {
    return "Изображение больше 3000×3000 пикселей.";
  }
  return null;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Loads a file into an HTMLImageElement (object URL revoked on settle). */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось загрузить изображение.")); };
    img.src = url;
  });
}

/**
 * Bakes the given crop area of `img` into an AVATAR_SIZE square WebP.
 * `area` is in source-image pixel coordinates (as produced by react-easy-crop's
 * croppedAreaPixels). Animated GIFs collapse to their first frame; SVGs rasterize.
 */
export function bakeToWebp(img: HTMLImageElement, area: CropArea): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas не поддерживается."));
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось создать изображение."))),
      "image/webp",
      0.9,
    );
  });
}
