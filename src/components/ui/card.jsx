import * as React from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        // Matches the app's existing .workspace-card shadow exactly (kept
        // instead of shadcn's default so the swap to <Card> doesn't flatten
        // the depth every panel already had).
        'bg-card text-card-foreground flex flex-col gap-4 rounded-2xl py-5 shadow-[0_8px_24px_rgb(7_26_46_/0.06)] dark:shadow-[0_10px_28px_rgb(2_5_31_/0.25)]',
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-3 px-5', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }) {
  return (
    <h3
      data-slot="card-title"
      className={cn('font-semibold text-[15px] leading-none text-foreground', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }) {
  return (
    <div data-slot="card-action" className={cn('ml-auto', className)} {...props} />
  )
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}

function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-5', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
