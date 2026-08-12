export type JsonDownloadFile = {
  filename: string;
  payload: unknown;
};

type DownloadLink = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};

export type JsonDownloadRuntime = {
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createLink: () => DownloadLink;
  appendLink: (link: DownloadLink) => void;
  scheduleCleanup: (cleanup: () => void) => void;
};

function getBrowserDownloadRuntime(): JsonDownloadRuntime | null {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createLink: () => document.createElement("a"),
    appendLink: (link) => document.body.appendChild(link as HTMLAnchorElement),
    scheduleCleanup: (cleanup) => window.setTimeout(cleanup, 0),
  };
}

/**
 * Downloads one or more JSON files from the same user action without opening
 * another window. Every payload is serialized before the first click so a
 * serialization failure cannot start a partial multi-file export.
 */
export function downloadJsonFiles(
  files: readonly JsonDownloadFile[],
  runtime: JsonDownloadRuntime | null = getBrowserDownloadRuntime(),
): boolean {
  if (!runtime || files.length === 0) return false;

  const prepared: Array<{ link: DownloadLink; url: string }> = [];
  try {
    for (const file of files) {
      const serialized = JSON.stringify(file.payload, null, 2);
      if (serialized === undefined) return false;
      const url = runtime.createObjectUrl(
        new Blob([serialized], { type: "application/json;charset=utf-8" }),
      );
      const link = runtime.createLink();
      link.href = url;
      link.download = file.filename;
      prepared.push({ link, url });
    }

    for (const { link } of prepared) runtime.appendLink(link);
    for (const { link } of prepared) link.click();
    return true;
  } catch {
    return false;
  } finally {
    for (const { link } of prepared) {
      try {
        link.remove();
      } catch {
        // A failed DOM cleanup must not crash the application.
      }
    }

    const revokeUrls = () => {
      for (const { url } of prepared) {
        try {
          runtime.revokeObjectUrl(url);
        } catch {
          // Object URL cleanup is best-effort after the download click.
        }
      }
    };
    try {
      runtime.scheduleCleanup(revokeUrls);
    } catch {
      revokeUrls();
    }
  }
}
