import * as React from "react"
import { cn } from "@/lib/utils"

// design/tcfl.css .input — 44px, radius 4, border-input.
// Error: aria-invalid → 2px destructive border (put the message ABOVE the field).
// Low confidence (scanned value): data-low-confidence → 2px urgent-line + urgent-soft fill.
export const fieldClasses =
  "w-full min-w-0 rounded-sm border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground " +
  "aria-invalid:border-2 aria-invalid:border-destructive aria-invalid:px-[11px] " +
  "data-[low-confidence=true]:border-2 data-[low-confidence=true]:border-urgent-line data-[low-confidence=true]:bg-urgent-soft data-[low-confidence=true]:px-[11px]"

function Input({
  className,
  type,
  lowConfidence,
  ...props
}: React.ComponentProps<"input"> & { lowConfidence?: boolean }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-low-confidence={lowConfidence || undefined}
      className={cn("h-11", fieldClasses, className)}
      {...props}
    />
  )
}

export { Input }
