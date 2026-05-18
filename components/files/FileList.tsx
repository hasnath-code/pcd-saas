import { FileRow } from './FileRow';
import type { ProjectFileRow } from '@/db/queries/files';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export type FileListProps = {
  files: ProjectFileRow[];
  // Identity context used to derive per-row delete affordance. Passed in by
  // the SSR caller so the policy stays in one place (the page) rather than
  // re-deriving identity in every row.
  viewer:
    | { kind: 'org_user'; userId: string; isAdmin: boolean }
    | { kind: 'stakeholder'; clientId: string }
    | null;
};

function canViewerDelete(file: ProjectFileRow, viewer: FileListProps['viewer']): boolean {
  if (!viewer) return false;
  if (viewer.kind === 'org_user') {
    if (viewer.isAdmin) return true;
    return file.uploadedByType === 'user' && file.uploadedById === viewer.userId;
  }
  // stakeholder
  return (
    file.uploadedByType === 'client' && file.uploadedById === viewer.clientId
  );
}

export function FileList({ files, viewer }: FileListProps) {
  if (files.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No files yet"
        description="Drawings, surveys, and documents shared on this project appear here."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {files.map((f) => (
        <li key={f.id}>
          <FileRow file={f} canDelete={canViewerDelete(f, viewer)} />
        </li>
      ))}
    </ul>
  );
}
