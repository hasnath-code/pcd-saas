import { listProjectActivity } from '@/db/queries/project-activity';
import { activityLabel, activitySummary } from '@/lib/activity/labels';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Phase 1c §12.7 + Phase 9. Server component — pure SSR, no client JS.
// Expandable payload uses native <details>/<summary> so the timeline doesn't
// drag in a `'use client'` component just for a disclosure widget.
//
// `viewer` selects between org and stakeholder visibility. The query layer
// enforces visible_to_stakeholders=true for the stakeholder branch via
// explicit WHERE (defense-in-depth — the RLS policy in 0022 is the
// canonical gate but the pooler bypasses it).

function formatRelative(when: Date): string {
  const ms = Date.now() - when.getTime();
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < min) return 'just now';
  if (ms < hr) return `${Math.floor(ms / min)}m ago`;
  if (ms < day) return `${Math.floor(ms / hr)}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return when.toLocaleDateString('en-GB');
}

export async function ActivityTimeline({
  projectId,
  viewer,
}: {
  projectId: string;
  viewer: 'org' | 'stakeholder';
}) {
  const rows = await listProjectActivity({
    projectId,
    visibleOnly: viewer === 'stakeholder',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
        <CardDescription>
          A timeline of changes on this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Decision 2 override hint — see Session 11 plan. project_activity
            starts fresh on Session 11 launch; older history lives in
            audit_logs (org-side, no portal surface). */}
        <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Activity timeline starts at Session 11 launch
          {viewer === 'org' ? '; earlier project history in the audit log.' : '.'}
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activity yet. Stage transitions, file uploads, and milestones
            will appear here as the project moves forward.
          </p>
        ) : (
          <ol className="relative space-y-3 border-l border-muted-foreground/20 pl-4">
            {rows.map((row) => {
              const summary = activitySummary(row.eventType, row.payload);
              const hasPayloadDetail = Object.keys(row.payload).length > 0;
              return (
                <li key={row.id} className="space-y-1">
                  <span
                    aria-hidden
                    className="absolute -left-[5px] mt-1.5 inline-block h-2.5 w-2.5 rounded-full border border-muted-foreground/40 bg-background"
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm">
                      <span className="font-medium">{row.actorDisplayName}</span>{' '}
                      <span className="text-muted-foreground">
                        {activityLabel(row.eventType)}
                      </span>
                    </p>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(row.createdAt)}
                    </time>
                  </div>
                  {summary && (
                    <p className="text-xs text-muted-foreground">{summary}</p>
                  )}
                  {hasPayloadDetail && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Details
                      </summary>
                      <pre className="mt-1 max-w-full overflow-x-auto rounded bg-muted/40 p-2 text-[11px] leading-tight">
                        {JSON.stringify(row.payload, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
