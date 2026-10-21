import type { SystemBrowser } from "@t3tools/contracts";
import { useEffect, useState } from "react";

// Detection reads files on disk, so one scan per app session; Rescan replaces it.
let cachedSystemBrowsers: ReadonlyArray<SystemBrowser> | null = null;

export interface SystemBrowsersState {
  /** Null until the first scan answers. Empty where the shell cannot list browsers. */
  readonly browsers: ReadonlyArray<SystemBrowser> | null;
  readonly scanning: boolean;
  readonly rescan: () => void;
}

export function useSystemBrowsers(enabled: boolean): SystemBrowsersState {
  const list = enabled ? window.desktopBridge?.listSystemBrowsers : undefined;
  const [browsers, setBrowsers] = useState<ReadonlyArray<SystemBrowser> | null>(() =>
    list === undefined ? [] : cachedSystemBrowsers,
  );
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (list === undefined || cachedSystemBrowsers !== null) return;
    let cancelled = false;
    list().then(
      (detected) => {
        cachedSystemBrowsers = detected;
        if (!cancelled) setBrowsers(detected);
      },
      () => {
        if (!cancelled) setBrowsers([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [list]);

  const rescan = () => {
    if (list === undefined || scanning) return;
    setScanning(true);
    list({ refresh: true })
      .then(
        (detected) => {
          cachedSystemBrowsers = detected;
          setBrowsers(detected);
        },
        () => undefined,
      )
      .finally(() => setScanning(false));
  };

  return { browsers, scanning, rescan };
}
