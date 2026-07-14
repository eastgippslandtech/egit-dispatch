import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import type { DateRange, MobileJob } from "../../contracts/mobile";
import { useTechnicianRepository } from "../../providers/app-providers";

export interface ScheduleState {
  connectionState: "connected" | "connecting" | "error";
  error: string | null;
  jobs: MobileJob[];
  lastSyncedAt: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

export function useSchedule(range: DateRange): ScheduleState {
  const repository = useTechnicianRepository();
  const [jobs, setJobs] = useState<MobileJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const rangeKey = `${range.from}:${range.to}`;

  const stableRange = useMemo(
    () => ({ from: range.from, to: range.to }),
    // rangeKey intentionally captures the scalar values without making
    // callers memoize object literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeKey],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      setJobs(await repository.listSchedule(stableRange));
      setLastSyncedAt(new Date().toISOString());
    } catch (scheduleError) {
      setError(formatScheduleError(scheduleError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [repository, stableRange]);

  useEffect(() => {
    let cancelled = false;

    repository
      .listSchedule(stableRange)
      .then((nextJobs) => {
        if (!cancelled) {
          setJobs(nextJobs);
          setError(null);
          setLastSyncedAt(new Date().toISOString());
        }
      })
      .catch((scheduleError: unknown) => {
        if (!cancelled) {
          setError(formatScheduleError(scheduleError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repository, stableRange]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, 60_000);
    const subscription = AppState.addEventListener?.("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    return () => {
      clearInterval(interval);
      subscription?.remove();
    };
  }, [refresh]);

  return {
    connectionState: error ? "error" : loading || refreshing ? "connecting" : "connected",
    error,
    jobs,
    lastSyncedAt,
    loading,
    refresh,
    refreshing,
  };
}

function formatScheduleError(scheduleError: unknown): string {
  return scheduleError instanceof Error
    ? scheduleError.message
    : "Schedule could not be loaded.";
}
