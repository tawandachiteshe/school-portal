import * as React from "react"
import { cn } from "@/lib/utils"
import { fieldClasses } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-24 resize-y py-2.5", fieldClasses, className)}
      {...props}
    />
  )
}

export { Textarea }
