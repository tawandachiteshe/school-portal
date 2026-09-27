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
