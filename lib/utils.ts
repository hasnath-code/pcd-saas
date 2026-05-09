import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// SI byte formatter. Pairs with the MB/GB constants in db/seed/plans.ts and
// lib/features.ts (1_000_000 / 1_000_000_000) so user-facing copy ("100 MB")
// matches the underlying byte count without IEC rounding surprises. Pure —
// safe to import from client components.
export function formatBytes(bytes: number): string {
  const MB = 1_000_000;
  const GB = 1_000_000_000;
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes % GB === 0 ? 0 : 1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)} MB`;
  if (bytes >= 1000) return `${(bytes / 1000).toFixed(0)} kB`;
  return `${bytes} B`;
}
