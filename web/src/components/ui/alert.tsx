import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// design/tcfl.css .alert — 16px padding, 12px gap, radius 6.
const alertVariants = cva(
  "flex w-full gap-3 rounded-md border p-4 text-base [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        info: "border-transparent bg-info-soft text-foreground [&>svg]:text-info",
        success: "border-success bg-success-soft text-foreground [&>svg]:text-success",
        urgent: "border-urgent-line bg-urgent-soft text-foreground [&>svg]:text-urgent",
        destructive: "border-2 border-destructive bg-card text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const role = variant === "destructive" ? "alert" : "status"
  return <div data-slot="alert" role={role} className={cn(alertVariants({ variant }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("font-semibold", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-description" className={cn("text-sm text-muted-foreground [&_p]:mt-1", className)} {...props} />
  )
}

export { Alert, AlertTitle, AlertDescription }
