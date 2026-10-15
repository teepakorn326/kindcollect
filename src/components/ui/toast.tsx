"use client"

// shadcn "toast" (legacy registry item), built on Radix Toast from the radix-ui package.
// The radix-nova registry only ships sonner; see CLAUDE.md §10 decisions.
import * as React from "react"
import { Toast as ToastPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"
import { cn } from "cn"

const ToastProvider = ToastPrimitive.Provider

function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed right-0 bottom-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 md:max-w-[420px]",
        className
      )}
      {...props}
    />
  )
}

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-kc-card border p-4 pr-8 shadow-kc-card transition-all data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full data-[state=closed]:animate-out data-[state=closed]:fade-out-80",
  {
    variants: {
      variant: {
        default: "border-kc-border bg-kc-surface text-kc-text",
        success: "border-kc-status-success bg-kc-status-success-bg text-kc-status-success",
        review: "border-kc-status-review bg-kc-status-review-bg text-kc-status-review",
        destructive: "border-kc-status-error bg-kc-status-error-bg text-kc-status-error",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Toast({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Root> & VariantProps<typeof toastVariants>) {
  return <ToastPrimitive.Root className={cn(toastVariants({ variant }), className)} {...props} />
}

function ToastAction({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Action>) {
  return (
    <ToastPrimitive.Action
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-kc-input border border-kc-border bg-kc-surface px-3 text-sm font-medium hover:bg-kc-bg",
        className
      )}
      {...props}
    />
  )
}

function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      className={cn("absolute top-2 right-2 rounded-md p-1 opacity-60 hover:opacity-100", className)}
      toast-close=""
      aria-label="Close"
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitive.Close>
  )
}

function ToastTitle({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) {
  return <ToastPrimitive.Title className={cn("text-sm font-semibold", className)} {...props} />
}

function ToastDescription({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Description>) {
  return <ToastPrimitive.Description className={cn("text-sm opacity-90", className)} {...props} />
}

type ToastProps = React.ComponentProps<typeof Toast>
type ToastActionElement = React.ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
