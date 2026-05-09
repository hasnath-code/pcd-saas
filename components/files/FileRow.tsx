'use client';

import * as React from 'react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  File,
  FileImage,
  FileText,
  FileArchive,
  FileSpreadsheet,
  FileAudio,
  FileVideo,
  Download,
  Trash2,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getDownloadUrl, softDeleteFile } from '@/actions/files';
import { formatBytes } from '@/lib/utils';
import type { ProjectFileRow } from '@/db/queries/files';

// Maps mime-type families → lucide icon component. Picked at render time.
// Session 10 ships icon-only previews — see DEBT-032 for the
// thumbnail/preview generation roadmap.
function iconForMime(mime: string): React.ComponentType<{ className?: string }> {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return FileImage;
  if (m.startsWith('audio/')) return FileAudio;
  if (m.startsWith('video/')) return FileVideo;
  if (m === 'application/pdf' || m.startsWith('text/')) return FileText;
  if (m.includes('zip') || m.includes('tar') || m.includes('compressed')) return FileArchive;
  if (m.includes('sheet') || m.includes('csv') || m.includes('excel')) return FileSpreadsheet;
  return File;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export type FileRowProps = {
  file: ProjectFileRow;
  // True if the calling viewer has authority to soft-delete this file
  // (uploader-self OR org admin). The page query computes this server-side
  // and passes the boolean; the component itself doesn't try to re-derive
  // identity.
  canDelete: boolean;
};

export function FileRow({ file, canDelete }: FileRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, startDeleteTransition] = useTransition();

  const Icon = iconForMime(file.mimeType);

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await getDownloadUrl({ fileId: file.id });
      if ('error' in result) {
        toast.error(
          result.reason ?? result.error ?? 'Could not get download link',
        );
        return;
      }
      // Open the signed URL in a new tab. Browser handles the download
      // based on Content-Disposition header from Supabase Storage.
      window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }

  function handleConfirmDelete() {
    startDeleteTransition(async () => {
      const result = await softDeleteFile({ fileId: file.id });
      if ('error' in result) {
        toast.error(result.reason ?? result.error ?? 'Could not delete file');
        return;
      }
      toast.success('File deleted');
      // revalidatePath in the action causes the page to re-fetch on next nav;
      // no manual state update needed here.
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="block w-full truncate text-left text-sm font-medium hover:underline"
            title={file.originalFilename}
          >
            {file.originalFilename}
          </button>
          <p className="truncate text-xs text-muted-foreground">
            {formatBytes(file.sizeBytes)} ·{' '}
            <span>Uploaded by {file.uploaderDisplayName}</span> ·{' '}
            <span>{formatDate(file.createdAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            aria-label="Download file"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
              aria-label="Delete file"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 text-destructive" />
              )}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this file?"
        description={
          <>
            <span className="font-medium">{file.originalFilename}</span> will be
            removed from the project. The file is recoverable by an org admin.
          </>
        }
        confirmText="Delete"
        variant="destructive"
        busy={deleting}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
