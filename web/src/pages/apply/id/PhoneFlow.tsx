import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ConfirmIdIn, NationalIdState } from '@/api/generated/model'
import { errorMessage } from '@/lib/api'
import { asFile, compressImage } from './compress'
import { IdCamera } from './IdCamera'
import { IdCheck } from './IdCheck'

type Stage = 'camera' | 'sending' | 'check' | 'type'

// Photo → upload → wait for the read → check. `state` comes from a query the parent polls while
// the photo is being read.
export function PhoneFlow({
  state,
  upload,
  confirm,
  onBack,
  frame,
  where,
  footnote,
  step,
}: {
  state: NationalIdState | undefined
  upload: (file: File) => Promise<unknown>
  confirm: (body: ConfirmIdIn) => Promise<unknown>
  onBack: () => void
  frame: (children: React.ReactNode) => React.ReactNode // the page chrome around check/reading screens
  where?: string
  footnote?: string
  step?: string
}) {
  const started = state && ['read', 'failed', 'reading'].includes(state.status)
  const [stage, setStage] = useState<Stage>(started ? 'check' : 'camera')
  const [photo, setPhoto] = useState<string>()
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo)
    },
    [photo],
  )

  async function send(blob: Blob) {
    setStage('sending')
    setPhoto(URL.createObjectURL(blob))
    try {
      await upload(asFile(await compressImage(blob)))
      setStage('check')
    } catch (e) {
      toast(errorMessage(e, "Couldn't send the photo. Check your signal and try again."))
      setStage('camera')
    }
  }

  if (stage === 'camera')
    return <IdCamera onPhoto={(b) => void send(b)} onType={() => setStage('type')} onBack={onBack} step={step} />

  const reading = stage === 'sending' || state?.status === 'reading'
  if (reading)
    return frame(
      <div role="status" className="flex grow flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={1.5} aria-hidden />
        <p className="font-medium">{stage === 'sending' ? 'Sending your photo…' : 'Reading your ID…'}</p>
        <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
      </div>,
    )

  return frame(
    <IdCheck
      key={`${stage}-${state?.document_id ?? 'none'}-${state?.status}`}
      state={stage === 'type' ? null : (state ?? null)}
      photo={photo}
      onSave={confirm}
      onRetake={() => setStage('camera')}
      where={where}
      footnote={footnote}
    />,
  )
}
