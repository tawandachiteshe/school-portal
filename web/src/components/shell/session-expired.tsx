import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useSessionExpired } from '@/lib/session'

// design/StateSession: a sheet over the page (a dialog on a computer). It can't be dismissed: the
// only way on is to sign in again, which comes back to this page.
export function SessionExpired() {
  const expired = useSessionExpired()
  const { pathname, search } = useLocation()
  if (!expired) return null
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="flex max-w-[440px] flex-col gap-4 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-xl max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:px-4 max-md:pt-2 max-md:pb-6"
      >
        <span aria-hidden className="h-1 w-10 self-center rounded-full bg-border-strong md:hidden" />
        <DialogTitle className="text-lg leading-6">You've been signed out</DialogTitle>
        <DialogDescription className="text-base text-foreground">
          Your session ended, so Campus Portal signed you out. Sign in again to carry on.
        </DialogDescription>
        <Button block onClick={() => window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`)}>
          Sign in again
        </Button>
        <p className="text-sm text-muted-foreground">You'll come back to this page after signing in.</p>
      </DialogContent>
    </Dialog>
  )
}
