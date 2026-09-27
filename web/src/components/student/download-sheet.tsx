import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { canWaitForWifi, DONT_ASK_LIMIT, onMobileData, setDontAskUnder10MB } from '@/lib/downloads'
import { fileKind, fileSize } from '@/lib/format'

export type PendingDownload = {
  id: string
  title: string
  size_bytes: number
  mime_type: string | null
  week: number | null
}

// design/DownloadSheet: bottom sheet before a large download on mobile data.
export function DownloadSheet({
  file,
  onClose,
  onDownload,
  onWifi,
}: {
  file: PendingDownload | null
  onClose: () => void
  onDownload: () => void
  onWifi: () => void
}) {
  const [dontAsk, setDontAsk] = useState(false)
  const done = (fn: () => void) => () => {
    if (dontAsk) setDontAskUnder10MB(true)
    fn()
  }
  return (
    <Sheet open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" showCloseButton={false} className="gap-4 rounded-t-xl px-4 pt-2 pb-6">
        <span aria-hidden className="h-1 w-10 self-center rounded-full bg-border-strong" />
        {file && (
          <>
            <div className="flex flex-col gap-1">
              <SheetTitle className="text-lg leading-6 font-semibold">This file is {fileSize(file.size_bytes)}</SheetTitle>
              <SheetDescription>
                {[file.title, fileKind(file.mime_type), file.week && `Week ${file.week}`].filter(Boolean).join(' · ')}
              </SheetDescription>
            </div>
            <p>
              {onMobileData() ? "You're on mobile data." : 'Save mobile data is on.'} It could take a few minutes on a
              slow connection and use some of your bundle.
            </p>
            <div className="flex flex-col gap-3">
              <Button block onClick={done(onDownload)}>
                Download now
              </Button>
              {canWaitForWifi() && (
                <Button block variant="outline" onClick={done(onWifi)}>
                  Download when I'm on Wi-Fi
                </Button>
              )}
            </div>
            {file.size_bytes < DONT_ASK_LIMIT && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={dontAsk}
                  onChange={(e) => setDontAsk(e.target.checked)}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="text-sm">Don't ask again for files under 10 MB</span>
              </label>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
