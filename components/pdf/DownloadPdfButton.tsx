'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  generateDocumentPdf,
  generateDocumentPdfFromToken,
} from '@/actions/document-pdf';

// Phase 2 Session 14 — generic Download PDF button. Two variants share UI:
//   - mode="document" with documentId: org-side (requireOrgUser action)
//   - mode="token"    with token:      public-side (token-gated, ADR-034)
//
// On click: invoke the action → server returns a 1-hour signed URL →
// open it in a new tab. The browser handles the file save (Supabase storage
// signs with `?download=<filename>` so the response Content-Disposition is
// attachment).

type Props =
  | { mode: 'document'; documentId: string; label?: string }
  | { mode: 'token'; token: string; label?: string };

export function DownloadPdfButton(props: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result =
          props.mode === 'document'
            ? await generateDocumentPdf({ documentId: props.documentId })
            : await generateDocumentPdfFromToken({ token: props.token });

        if ('error' in result) {
          setError(reasonText(result));
          return;
        }
        // Open the signed URL in a new tab. The download attribute on the
        // signed URL ensures save-rather-than-render even for inline-capable
        // PDFs.
        window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate PDF');
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? 'Preparing PDF…' : (props.label ?? 'Download PDF')}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function reasonText(result: {
  error: string;
  reason?: string;
}): string {
  if (result.error === 'rate_limited') {
    return 'Too many requests — please try again in a moment.';
  }
  if (result.error === 'not_found') {
    return 'This document is no longer available.';
  }
  return result.reason ?? 'Could not prepare the PDF. Please try again.';
}
