import { ArrowLeft, Flashlight, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Hint = 'starting' | 'dark' | 'glare-left' | 'glare-right' | 'blurry' | 'steady'

const HINTS: Record<Hint, [string, string]> = {
  starting: ['Line up your ID', 'Put the front of your ID inside the outline.'],
  dark: ['Too dark', 'Move somewhere brighter, or turn on the torch.'],
  'glare-left': ['Glare on the left side', 'Tilt the ID slightly away from the light.'],
  'glare-right': ['Glare on the right side', 'Tilt the ID slightly away from the light.'],
  blurry: ['Hold it flat and still', 'Keep the ID inside the outline until it’s sharp.'],
  steady: ['Hold still', 'Taking the photo…'],
}
const STEADY_MS = 900

// Brightness, glare and sharpness inside the outline, on a small copy of the frame.
function analyse(ctx: CanvasRenderingContext2D, w: number, h: number, prev: Float32Array | null) {
  const { data } = ctx.getImageData(0, 0, w, h)
  const lum = new Float32Array(w * h)
  let sum = 0
  let glareL = 0
  let glareR = 0
  for (let i = 0; i < w * h; i++) {
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    lum[i] = y
    sum += y
    if (y > 245) {
      if (i % w < w / 2) glareL++
      else glareR++
    }
  }
  // Variance of the Laplacian: low means blurred.
  let lap = 0
  let lap2 = 0
  let n = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const v = 4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]
      lap += v
      lap2 += v * v
      n++
    }
  const sharp = lap2 / n - (lap / n) ** 2
  let moved = 0
  if (prev) {
    for (let i = 0; i < lum.length; i += 4) moved += Math.abs(lum[i] - prev[i])
    moved /= lum.length / 4
  }
  const half = (w * h) / 2
  return { mean: sum / (w * h), glareL: glareL / half, glareR: glareR / half, sharp, moved, lum }
}

function Blocked({
  title,
  onRetry,
  onGallery,
  onBack,
}: {
  title: string
  onRetry: () => void
  onGallery: () => void
  onBack: () => void
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center gap-1 border-b bg-card pr-4 pl-1">
        <button type="button" aria-label="Back" onClick={onBack} className="inline-flex size-11 items-center justify-center">
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </button>
        <span className="font-semibold">{title}</span>
      </header>
      <main className="flex grow flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-3">
          <TriangleAlert className="size-6 text-destructive" strokeWidth={1.5} aria-hidden />
          <h1 className="text-2xl leading-8 font-semibold">Camera access is off</h1>
          <p>Your browser is blocking the camera for this site, so we can't take the photo.</p>
        </div>
        <section aria-labelledby="h-fix" className="flex flex-col gap-3">
          <h2 id="h-fix" className="text-lg font-semibold">
            Turn it on in Chrome
          </h2>
          <ol className="flex flex-col gap-3">
            {[
              <>
                Tap the icon to the left of <span className="font-mono text-sm">{window.location.host}</span> in the address
                bar.
              </>,
              <>
                Tap <span className="font-semibold">Permissions</span>, then <span className="font-semibold">Camera</span>.
              </>,
              <>
                Choose <span className="font-semibold">Allow</span>, then come back and tap Try again.
              </>,
            ].map((t, i) => (
              <li key={i} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
                <span className="font-mono text-muted-foreground">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground">
            In other browsers, look for camera permission in the site settings, or upload a photo instead.
          </p>
        </section>
        <div className="mt-auto flex flex-col gap-3">
          <Button block onClick={onRetry}>
            Try again
          </Button>
          <Button block variant="outline" onClick={onGallery}>
            Upload a photo from my gallery
          </Button>
        </div>
      </main>
    </div>
  )
}

export type PhotoQuality = 'clear' | 'blurry' | 'dark'

// Shape of the outline and the words around it, per document.
const KINDS = {
  id: {
    title: 'Front of National ID',
    frame: 'aspect-[1.585] w-[86%] rounded-lg',
    crop: [0.86, 0.54],
    help: 'The photo is taken by itself when your ID is steady and inside the outline.',
    upload: 'Gallery',
  },
  slip: {
    title: 'ZIMSEC result slip',
    frame: 'aspect-[1/1.414] h-[88%] max-w-[82%] rounded-sm',
    crop: [0.7, 0.9],
    help: 'Lay the slip flat. The photo is taken by itself when all four corners are inside.',
    upload: 'Upload a file',
  },
} as const

// design/PhoneCamera, ZimsecCamera, CameraBlocked. The photo is taken by itself when it's steady and sharp.
export function IdCamera({
  onPhoto,
  onType,
  onBack,
  step = 'Step 2 of 5',
  kind = 'id',
  page,
}: {
  onPhoto: (photo: Blob, quality: PhotoQuality | null) => void
  onType?: () => void
  kind?: keyof typeof KINDS
  page?: number
  onBack: () => void
  step?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [blocked, setBlocked] = useState(() => !navigator.mediaDevices?.getUserMedia)
  const [attempt, setAttempt] = useState(0)
  const [hint, setHint] = useState<Hint>('starting')
  const [progress, setProgress] = useState(0)
  const [torch, setTorch] = useState<boolean | null>(null) // null: not supported
  const taken = useRef(false)
  const last = useRef<PhotoQuality | null>(null)
  const k = KINDS[kind]
  const title = page ? `${k.title} · page ${page}` : k.title

  const capture = useCallback(() => {
    const v = video.current
    if (!v || taken.current || !v.videoWidth) return
    taken.current = true
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    c.toBlob((b) => b && onPhoto(b, last.current), 'image/jpeg', 0.9)
  }, [onPhoto])

  useEffect(() => {
    let stop = false
    let timer = 0
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        if (stop) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        const track = s.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean }
        setTorch(caps.torch ? false : null)
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
        const small = document.createElement('canvas')
        small.width = 160
        small.height = 100
        const ctx = small.getContext('2d', { willReadFrequently: true })
        let prev: Float32Array | null = null
        let steadySince = 0
        const tick = () => {
          const v = video.current
          if (stop || !v || !ctx || !v.videoWidth) return
          // The outline covers the middle 86% × 54% of the view.
          const sw = v.videoWidth * KINDS[kind].crop[0]
          const sh = v.videoHeight * KINDS[kind].crop[1]
          ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, 160, 100)
          const a = analyse(ctx, 160, 100, prev)
          prev = a.lum
          const next: Hint =
            a.mean < 55
              ? 'dark'
              : a.glareR > 0.04 && a.glareR >= a.glareL
                ? 'glare-right'
                : a.glareL > 0.04
                  ? 'glare-left'
                  : a.sharp < 60 || a.moved > 6
                    ? 'blurry'
                    : 'steady'
          const now = performance.now()
          if (next === 'steady') {
            steadySince ||= now
            setProgress(Math.min(1, (now - steadySince) / STEADY_MS))
            if (now - steadySince >= STEADY_MS) capture()
          } else {
            steadySince = 0
            setProgress(0)
          }
          last.current = next === 'dark' ? 'dark' : next === 'blurry' ? 'blurry' : 'clear'
          setHint(next)
        }
        timer = window.setInterval(tick, 200)
      })
      .catch((e: DOMException) => {
        if (!stop && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError')) setBlocked(true)
      })
    return () => {
      stop = true
      clearInterval(timer)
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt, capture, kind])

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0]
    if (!track || torch === null) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      setTorch(!torch)
    } catch {
      setTorch(null)
    }
  }

  const galleryInput = (
    <input
      ref={gallery}
      type="file"
      accept="image/*"
      tabIndex={-1}
      aria-hidden
      className="sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onPhoto(f, null)
      }}
    />
  )

  if (blocked)
    return (
      <>
        {galleryInput}
        <Blocked
          onBack={onBack}
          title={title}
          onGallery={() => gallery.current?.click()}
          onRetry={() => {
            setBlocked(false)
            setAttempt((n) => n + 1)
          }}
        />
      </>
    )

  const [hintTitle, body] = HINTS[hint]
  return (
    <div className="flex min-h-dvh flex-col bg-[#0F0F0E] text-[#F4F2EE]">
      {galleryInput}
      <div className="flex h-14 shrink-0 items-center gap-1 pr-4 pl-1">
        <button type="button" aria-label="Cancel and go back" onClick={onBack} className="inline-flex size-11 items-center justify-center">
          <ArrowLeft className="size-5" strokeWidth={1.5} />
        </button>
        <div className="flex flex-col">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-[#B8B3AA]">{step}</span>
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="mx-4 mt-2 flex min-h-[72px] flex-col gap-0.5 rounded-md bg-[#F4F2EE] px-4 py-3 text-[#1B1A18]"
      >
        <span className="font-semibold">{hintTitle}</span>
        <span className="text-sm text-[#4A463F]">{body}</span>
        {hint === 'steady' && (
          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[#E2DFD9]">
            <span className="block h-full bg-[#1D6B3A]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </div>

      <div className="relative flex grow items-center justify-center overflow-hidden">
        <video ref={video} playsInline muted aria-label="Camera view" className="absolute inset-0 size-full object-cover" />
        {/* Outline to line up the ID (ID-1 card, 85.6 × 54 mm). */}
        <div
          aria-hidden
          className={cn('relative border-2 shadow-[0_0_0_9999px_rgba(15,15,14,0.55)]', k.frame)}
          style={{ borderColor: hint === 'steady' ? '#74C48F' : '#F4F2EE' }}
        />
      </div>

      <div className="flex shrink-0 flex-col items-center gap-4 px-4 pt-4 pb-6">
        <p className="text-center text-sm text-[#B8B3AA]">
          {k.help}
        </p>
        <div className="grid w-full grid-cols-[1fr_72px_1fr] items-center">
          {torch !== null ? (
            <button
              type="button"
              aria-label={torch ? 'Turn off torch' : 'Turn on torch'}
              aria-pressed={torch}
              onClick={() => void toggleTorch()}
              className="inline-flex size-11 items-center justify-center justify-self-start"
            >
              <Flashlight className="size-5" strokeWidth={1.5} />
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            aria-label="Take photo now"
            onClick={capture}
            className="size-[72px] rounded-full border-[3px] border-[#F4F2EE] p-[5px]"
          >
            <span className="block size-full rounded-full bg-[#F4F2EE]" />
          </button>
          <button
            type="button"
            onClick={() => gallery.current?.click()}
            className="justify-self-end text-sm text-[#A9CBF2] hover:underline"
          >
            {k.upload}
          </button>
        </div>
        {onType && (
          <button type="button" onClick={onType} className="min-h-11 text-[#A9CBF2] hover:underline">
            Type the details in instead
          </button>
        )}
      </div>
    </div>
  )
}
