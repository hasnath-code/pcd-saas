'use client';

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmUpload, createUploadUrl } from '@/actions/files';
import type { ProjectFileSource } from '@/db/queries/files';

// Two-step upload zone. Used on org and portal project detail pages. The
// server action contract (createUploadUrl → direct PUT to signed URL →
// confirmUpload) keeps file bytes off Vercel functions (§18). Per-file
// progress is tracked via XMLHttpRequest.upload (fetch's stream API doesn't
// expose progress in browsers without consuming the upload body).

export type FileUploadZoneProps = {
  projectId: string;
  // 'surveyor_upload' for org surveyors, 'client_upload' for stakeholders,
  // 'document_artifact' for system-generated documents (Phase 2). The action
  // re-validates so a malicious caller can't smuggle a wrong source — this
  // is a UX hint.
  source: ProjectFileSource;
  // Optional accept hint (defaults to all). Comma-separated MIME types.
  accept?: string;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'uploading'; filename: string; pct: number }
  | { kind: 'finalizing'; filename: string };

export function FileUploadZone({ projectId, source, accept }: FileUploadZoneProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [dragActive, setDragActive] = useState(false);

  const uploadOne = useCallback(
    async (file: File) => {
      setStatus({ kind: 'uploading', filename: file.name, pct: 0 });

      // 1. Mint signed upload URL.
      const created = await createUploadUrl({
        projectId,
        originalFilename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        source,
      });
      if ('error' in created) {
        if (created.reason === 'file_too_large') {
          toast.error(`${file.name} is too large for your plan.`);
        } else if (created.reason === 'org_storage_full') {
          toast.error('Storage quota exceeded for your plan.');
        } else {
          toast.error(created.reason ?? created.error ?? 'Could not start upload');
        }
        setStatus({ kind: 'idle' });
        return;
      }
      const { fileId, storagePath, signedUrl } = created.data;

      // 2. Direct PUT to the signed URL with progress.
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', signedUrl);
          // Supabase signed upload URL doesn't require a Content-Type but
          // setting it preserves mime correctly on retrieval.
          xhr.setRequestHeader(
            'Content-Type',
            file.type || 'application/octet-stream',
          );
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setStatus({ kind: 'uploading', filename: file.name, pct });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          };
          xhr.onerror = () => reject(new Error('Network error during upload'));
          xhr.send(file);
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Upload failed unexpectedly',
        );
        setStatus({ kind: 'idle' });
        return;
      }

      // 3. Confirm — creates the project_files row + audit-logs.
      setStatus({ kind: 'finalizing', filename: file.name });
      const confirmed = await confirmUpload({
        fileId,
        projectId,
        storagePath,
        originalFilename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        source,
      });
      if ('error' in confirmed) {
        if (confirmed.reason === 'org_storage_full') {
          toast.error('Quota exceeded — your file was discarded.');
        } else {
          toast.error(confirmed.reason ?? confirmed.error ?? 'Could not finalize upload');
        }
        setStatus({ kind: 'idle' });
        return;
      }

      toast.success(`${file.name} uploaded`);
      setStatus({ kind: 'idle' });
      // Revalidation in the action triggers refresh on next nav, but call
      // router.refresh() explicitly to update the list immediately.
      router.refresh();
    },
    [projectId, source, router],
  );

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      // Sequential to keep memory + UI state simple; small batch sizes only.
      // If multi-file upload needs to ship larger batches, swap to a parallel
      // pool here.
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;
        await uploadOne(file);
      }
    },
    [uploadOne],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFiles(e.target.files);
    }
    // reset so re-uploading the same file works
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = () => setDragActive(false);
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  const busy = status.kind !== 'idle';

  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors',
        dragActive ? 'border-foreground bg-muted/30' : 'border-muted-foreground/25',
        busy ? 'opacity-75' : '',
      ].join(' ')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-busy={busy}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={onInputChange}
        disabled={busy}
      />
      {status.kind === 'idle' ? (
        <>
          <Upload className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => inputRef.current?.click()}
            >
              Choose files
            </Button>{' '}
            or drag &amp; drop
          </p>
          <p className="text-xs text-muted-foreground">
            Files are private to this project.
          </p>
        </>
      ) : status.kind === 'uploading' ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Uploading {status.filename}</p>
          <div className="h-1 w-48 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground transition-[width] duration-200"
              style={{ width: `${status.pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{status.pct}%</p>
        </>
      ) : (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Finalizing {status.filename}…</p>
        </>
      )}
    </div>
  );
}
