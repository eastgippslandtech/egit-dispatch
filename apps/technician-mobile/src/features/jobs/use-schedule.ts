import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [settledRangeKey, setSettledRangeKey] = useState<string | null>(null);
  const rangeKey = `${range.from}:${range.to}`;
  const currentRangeKeyRef = useRef(rangeKey);
  const currentRepositoryRef = useRef(repository);
  const settledRangeKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef<
    {
      key: string;
      promise: Promise<void>;
      repository: typeof repository;
    } | undefined
  >(undefined);

  const stableRange = useMemo(
    () => ({ from: range.from, to: range.to }),
    // rangeKey intentionally captures the scalar values without making
    // callers memoize object literals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeKey],
  );

  useEffect(() => {
    currentRangeKeyRef.current = rangeKey;
  }, [rangeKey]);

  useEffect(() => {
    currentRepositoryRef.current = repository;
  }, [repository]);

  const refresh = useCallback(async () => {
    const existing = inFlightRef.current;
    if (existing?.key === rangeKey && existing.repository === repository) {
      return existing.promise;
    }

    const hasCurrentData = settledRangeKeyRef.current === rangeKey;
    setRefreshing(true);
    setLoading(!hasCurrentData);
    setError(null);

    const promise = repository
      .listSchedule(stableRange)
      .then((nextJobs) => {
        if (
          currentRangeKeyRef.current !== rangeKey ||
          currentRepositoryRef.current !== repository
        ) {
          return;
        }
        setJobs(nextJobs);
        setSettledRangeKey(rangeKey);
        settledRangeKeyRef.current = rangeKey;
        setLastSyncedAt(new Date().toISOString());
      })
      .catch((scheduleError: unknown) => {
        if (
          currentRangeKeyRef.current !== rangeKey ||
          currentRepositoryRef.current !== repository
        ) {
          return;
        }
        setError(formatScheduleError(scheduleError));
      })
      .finally(() => {
        if (inFlightRef.current?.promise === promise) {
          inFlightRef.current = undefined;
        }
        if (
          currentRangeKeyRef.current === rangeKey &&
          currentRepositoryRef.current === repository
        ) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    inFlightRef.current = { key: rangeKey, promise, repository };
    return promise;
  }, [rangeKey, repository, stableRange]);

  useEffect(() => {
    let cancelled = false;
    const cachedSchedule = repository.listCachedSchedule?.(stableRange);
    cachedSchedule
      ?.then((cachedJobs) => {
        if (
          !cancelled &&
          currentRangeKeyRef.current === rangeKey &&
          currentRepositoryRef.current === repository &&
          settledRangeKeyRef.current !== rangeKey &&
          cachedJobs.length > 0
        ) {
          setJobs(cachedJobs);
          setSettledRangeKey(rangeKey);
          settledRangeKeyRef.current = rangeKey;
          setLoading(false);
        }
      })
      .catch(() => undefined);

    void refresh();

    return () => {
      cancelled = true;
    };
  }, [rangeKey, refresh, repository, stableRange]);

  useEffect(() => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refresh();
      if (!stopped) {
        pollTimer = setTimeout(poll, 60_000);
      }
    };
    pollTimer = setTimeout(poll, 60_000);
    const subscription = AppState.addEventListener?.("change", (state) => {
      if (state === "active") {
        void refresh();
      }
    });

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      subscription?.remove();
    };
  }, [refresh]);

  const hasSettledCurrentRange = settledRangeKey === rangeKey;
  const effectiveLoading = loading || !hasSettledCurrentRange;

  return {
    connectionState: error
      ? "error"
      : effectiveLoading || refreshing
        ? "connecting"
        : "connected",
    error,
    jobs: hasSettledCurrentRange ? jobs : [],
    lastSyncedAt,
    loading: effectiveLoading,
    refresh,
    refreshing,
  };
}

function formatScheduleError(scheduleError: unknown): string {
  return scheduleError instanceof Error
    ? scheduleError.message
    : "Schedule could not be loaded.";
}
