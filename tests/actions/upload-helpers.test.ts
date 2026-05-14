import { describe, expect, it, vi } from 'vitest';
import { uploadBatchSequentially } from '@/components/files/upload-helpers';

describe('uploadBatchSequentially', () => {
  it('invokes the uploader for every file in the batch, in order', async () => {
    const files = [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
      new File(['c'], 'c.txt', { type: 'text/plain' }),
    ];
    const uploaded: string[] = [];
    await uploadBatchSequentially(files, async (f) => {
      uploaded.push(f.name);
    });
    expect(uploaded).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  // DEBT-039 regression: with the old in-component handleFiles iterating the
  // live `input.files` FileList, only the first file made it through the
  // picker click path because the input was reset right after the async
  // helper was kicked off. The fix snapshots the FileList into an array up
  // front; this test guards the helper against any future regression that
  // would short-circuit after the first file.
  it('does not stop at the first file even when the uploader is async', async () => {
    const files = [
      new File(['a'], 'first.txt'),
      new File(['b'], 'second.txt'),
      new File(['c'], 'third.txt'),
    ];
    const uploadOne = vi.fn(
      (f: File) =>
        new Promise<void>((resolve) => {
          // Force a microtask break between iterations to mimic the real
          // upload (await network round-trips), where the bug would surface.
          queueMicrotask(() => resolve());
        }),
    );
    await uploadBatchSequentially(files, uploadOne);
    expect(uploadOne).toHaveBeenCalledTimes(3);
    expect(uploadOne.mock.calls.map((c) => (c[0] as File).name)).toEqual([
      'first.txt',
      'second.txt',
      'third.txt',
    ]);
  });

  it('tolerates an empty batch without invoking the uploader', async () => {
    const uploadOne = vi.fn();
    await uploadBatchSequentially([], uploadOne);
    expect(uploadOne).not.toHaveBeenCalled();
  });
});
