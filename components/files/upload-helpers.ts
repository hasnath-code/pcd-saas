// Sequential per-file uploader. Lifted out of FileUploadZone so the iteration
// loop is unit-testable without a React render tree.
//
// Accepts a plain File[] (not a FileList). Callers must convert their FileList
// — whether from `input.files` or `dataTransfer.files` — via Array.from before
// passing in. The reason: `input.files` is a live collection that becomes
// empty the moment `input.value = ''` runs, which the FileUploadZone handler
// does immediately after invoking the batch helper (so re-selecting the same
// file fires onChange again). Iterating the live FileList through async awaits
// loses every file beyond the first.
export async function uploadBatchSequentially(
  files: File[],
  uploadOne: (file: File) => Promise<void>,
): Promise<void> {
  for (const file of files) {
    if (!file) continue;
    await uploadOne(file);
  }
}
