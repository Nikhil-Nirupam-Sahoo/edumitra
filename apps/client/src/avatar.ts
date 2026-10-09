/**
 * Avatar — turn a picked image into a compact data URL for the profile.
 *
 * An offline-first app should not need a file server or object store
 * for a profile picture, so we downscale the chosen image to a small
 * square thumbnail with a canvas and store the compressed JPEG data
 * URL alongside the user. 200px at quality ~0.7 is a few KB, which
 * is fine to keep in the profile record.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // ignore absurd inputs early

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode_failed'));
    img.src = src;
  });
}

/**
 * Reads `file` and returns a square (cropped-and-scaled) JPEG data URL,
 * or null when it cannot be decoded.
 */
export async function imageToAvatarDataUrl(
  file: File,
  size = 200,
  quality = 0.72,
): Promise<string | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  if (!file.type.startsWith('image/')) return null;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);

    // Centre-crop to a square so no face is off-centre, then scale down.
    const side = Math.min(img.naturalWidth, img.naturalHeight) || 1;
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}
