import { Badge } from '@/components/ui/badge';

// Renders the stage name with the stage's hex color as a left bar (matches
// kanban-style indicators). Falls back to neutral if no color set.
export function ProjectStageBadge({
  name,
  color,
  isTerminal,
}: {
  name: string;
  color: string | null;
  isTerminal?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color ?? '#94a3b8' }}
        aria-hidden="true"
      />
      <Badge variant={isTerminal ? 'secondary' : 'outline'}>{name}</Badge>
    </span>
  );
}
