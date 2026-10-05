import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REFRESH_ON_LOAD,
  readLiveRefreshStatus,
  requestRefreshIfStale,
} from "@/features/data/queries";

// One refresh attempt per browser session, no matter how many routes mount.
let attempted = false;

const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 8; // ~2 minutes of polling, then give up quietly

/**
 * Fires the demand-driven stale-data refresh after the UI has already rendered.
 *
 * The page never waits for this: it runs after mount, in the background, and
 * only invalidates the forecast/data queries once the backend reports fresh
 * data. If the refresh fails or is disabled, the UI simply keeps showing the
 * cached data it loaded on first paint.
 */
export function RefreshOnLoad() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!REFRESH_ON_LOAD || attempted) return;
    attempted = true;

    let cancelled = false;
    let polls = 0;
    let timer: number | undefined;

    const invalidate = () => {
      void queryClient.invalidateQueries();
    };

    void (async () => {
      // Capture the pre-refresh success stamp so we can detect a NEW one.
      const before = await readLiveRefreshStatus();
      const previousSuccess = before?.last_success ?? null;

      const result = await requestRefreshIfStale();
      if (cancelled || !result) return;

      if (result.status === "fresh") return; // nothing to do
      if (result.refreshed) {
        invalidate();
        return;
      }
      if (result.status !== "refresh_started" && result.status !== "refresh_in_progress") {
        return;
      }

      // Non-blocking path: poll until the worker records a new success, then
      // refetch only the affected data.
      timer = window.setInterval(async () => {
        if (cancelled || polls >= MAX_POLLS) {
          window.clearInterval(timer);
          return;
        }
        polls += 1;
        const status = await readLiveRefreshStatus();
        if (cancelled || !status) return;
        if (status.last_success && status.last_success !== previousSuccess) {
          window.clearInterval(timer);
          invalidate();
        }
      }, POLL_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [queryClient]);

  return null;
}
