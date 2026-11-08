import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerDownload } from './export-import';

const FILE_NAME = 'my-save-2027-03-14.rbsave';

function saveBlob(): Blob {
  return new Blob([new Uint8Array([31, 139, 8, 0])], { type: 'application/x-ringside-save' });
}

let createObjectUrl: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectUrl: ReturnType<typeof vi.fn<(url: string) => void>>;
let clickedDownloads: string[];

beforeEach(() => {
  vi.useFakeTimers();
  createObjectUrl = vi.fn<(blob: Blob) => string>(() => 'blob:save');
  revokeObjectUrl = vi.fn<(url: string) => void>();
  // jsdom has no object URLs; these stand in for the browser's and are removed after each test.
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
  clickedDownloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clickedDownloads.push(this.download);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

function stubShare(share: (data: ShareData) => Promise<void>): void {
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
}

describe('triggerDownload', () => {
  it('downloads through a temporary link and revokes the URL afterwards', async () => {
    const outcome = await triggerDownload(FILE_NAME, saveBlob());

    expect(outcome).toBe('downloaded');
    expect(clickedDownloads).toEqual([FILE_NAME]);
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:save');
  });

  it('opens the share sheet when the browser can share files', async () => {
    const share = vi.fn(async (data: ShareData) => {
      await Promise.resolve(data);
    });
    stubShare(share);

    const outcome = await triggerDownload(FILE_NAME, saveBlob());

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]?.[0].files?.[0]?.name).toBe(FILE_NAME);
    expect(clickedDownloads).toEqual([]);
  });

  it('downloads when sharing is refused, and does nothing when the sheet is closed', async () => {
    stubShare(async () => {
      await Promise.resolve();
      throw new DOMException('No user gesture.', 'NotAllowedError');
    });
    expect(await triggerDownload(FILE_NAME, saveBlob())).toBe('downloaded');
    expect(clickedDownloads).toEqual([FILE_NAME]);

    clickedDownloads = [];
    stubShare(async () => {
      await Promise.resolve();
      throw new DOMException('Share canceled.', 'AbortError');
    });
    expect(await triggerDownload(FILE_NAME, saveBlob())).toBe('cancelled');
    expect(clickedDownloads).toEqual([]);
  });
});
