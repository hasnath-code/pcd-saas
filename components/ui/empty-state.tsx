import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Shared empty-state block — a Lucide icon, a heading, one line of copy, and an
// optional CTA. Introduced in the pre-launch UX polish sprint as the single
// vocabulary for "this surface has no data yet" across the portal, replacing
// the ad-hoc bare-<p> empty states. Designed to sit inside a Card's content
// area or stand alone. Pure presentational — safe in server or client trees.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-6 py-10 text-center',
        className,
      )}
    >
      <Icon aria-hidden className="h-8 w-8 text-muted-foreground" />
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
