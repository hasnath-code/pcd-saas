"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// Thin wrapper around shadcn AlertDialog for two-button confirmation flows.
// Replaces native window.confirm() across the app per Decision 9.7 / DEBT-016.
//
// Controlled component — caller owns the open state. The action button fires
// onConfirm; AlertDialog closes automatically. Cancel closes without firing
// onConfirm. busy disables the action button (used while a server action is
// in flight to prevent double-clicks).
//
// variant="destructive" tints the action button red. Use for delete /
// remove flows. Default variant for forward-going confirmations (e.g. "move
// project backward — are you sure?").

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
  busy?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            variant={variant}
            disabled={busy}
            onClick={(event) => {
              // Don't auto-close if the handler returns a Promise that needs
              // to settle — caller controls open state via onOpenChange + busy.
              const result = onConfirm()
              if (result instanceof Promise) {
                event.preventDefault()
                void result.finally(() => {
                  onOpenChange(false)
                })
              }
            }}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
