"use client"

// Minimal shadcn-style toast store (one toast visible at a time).
import * as React from "react"
import type { ToastActionElement, ToastProps } from "@/components/ui/toast"

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const TOAST_LIMIT = 1
let count = 0
let memoryState: ToasterToast[] = []
const listeners = new Set<(toasts: ToasterToast[]) => void>()

function emit(next: ToasterToast[]) {
  memoryState = next
  listeners.forEach((l) => l(memoryState))
}

function dismiss(id?: string) {
  emit(memoryState.map((t) => (id === undefined || t.id === id ? { ...t, open: false } : t)))
}

function toast(props: Omit<ToasterToast, "id">) {
  const id = String(++count)
  emit(
    [
      {
        ...props,
        id,
        open: true,
        onOpenChange: (open: boolean) => {
          if (!open) dismiss(id)
        },
      },
      ...memoryState,
    ].slice(0, TOAST_LIMIT)
  )
  return { id, dismiss: () => dismiss(id) }
}

function useToast() {
  const [toasts, setToasts] = React.useState<ToasterToast[]>(memoryState)
  React.useEffect(() => {
    listeners.add(setToasts)
    return () => {
      listeners.delete(setToasts)
    }
  }, [])
  return { toasts, toast, dismiss }
}

export { useToast, toast }
