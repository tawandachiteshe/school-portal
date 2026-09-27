import type { Crop as CropBox } from '@/api/generated/model'

// The part of the slip a grade was read from (design/Zimsec "Crop from your slip"), cut out of
// the page photo with CSS so nothing extra is downloaded.
export function Crop({ src, crop, width, height, label }: { src: string; crop: CropBox; width: number; height: number; label: string }) {
  const padX = crop.w * 1.2
  const padY = crop.h * 0.5
  const bw = crop.w + padX * 2
  const bh = crop.h + padY * 2
  const scale = Math.min(width / bw, height / bh)
  const x = (crop.x - padX) * scale - (width - bw * scale) / 2
  const y = (crop.y - padY) * scale - (height - bh * scale) / 2
  return (
    <figure
      role="img"
      aria-label={label}
      className="shrink-0 rounded-sm border bg-[#EDEAE3] bg-no-repeat"
      style={{
        width,
        height,
        backgroundImage: `url("${src}")`,
        backgroundSize: `${crop.page_w * scale}px ${crop.page_h * scale}px`,
        backgroundPosition: `${-x}px ${-y}px`,
      }}
    />
  )
}
