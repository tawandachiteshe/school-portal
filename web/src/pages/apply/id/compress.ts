// Photos are shrunk on the phone before upload (3G): long edge 2000 px, JPEG, about 1 MB.
export async function compressImage(file: Blob, maxEdge = 2000, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // HEIC and others the browser can't decode: send as is
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  return out && out.size < file.size ? out : file
}

export const asFile = (b: Blob, name = 'national-id.jpg') => new File([b], name, { type: b.type || 'image/jpeg' })

// Rough check of an uploaded photo (design/ZimsecPages "Clear" / "Blurry"): brightness, and the
// variance of the Laplacian on a small grey copy.
export async function assessImage(file: Blob): Promise<'clear' | 'blurry' | 'dark' | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const w = 400
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, w, h)
  const lum = new Float32Array(w * h)
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    sum += lum[i]
  }
  if (sum / (w * h) < 55) return 'dark'
  let s = 0
  let s2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]
      s += v
      s2 += v * v
      n++
    }
  return s2 / n - (s / n) ** 2 < 40 ? 'blurry' : 'clear'
}
