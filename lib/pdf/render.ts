import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  DocumentPdfTemplate,
  type DocumentPdfData,
} from './document-template';

// Phase 2 Session 14 — server-side render entry point. @react-pdf/renderer's
// renderToBuffer streams the template into a Node Buffer that can be uploaded
// to Supabase Storage. Pure JS, no native deps — runs on Vercel serverless.
//
// Returns the Buffer (caller uploads to storage) plus the byte count so the
// caller can populate project_files.size_bytes without a second pass.

export interface RenderedPdf {
  buffer: Buffer;
  sizeBytes: number;
  mimeType: 'application/pdf';
}

export async function renderDocumentPdf(
  data: DocumentPdfData,
): Promise<RenderedPdf> {
  // renderToBuffer returns a Node Buffer. Async because @react-pdf streams
  // the document under the hood; the await collects the chunks.
  // The element is created inline rather than via JSX import so that this
  // file stays a .ts (no JSX tooling needed in non-component files).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = (DocumentPdfTemplate as unknown as (props: DocumentPdfData) => any)(data);
  const buffer = await renderToBuffer(element);
  return {
    buffer,
    sizeBytes: buffer.length,
    mimeType: 'application/pdf',
  };
}
