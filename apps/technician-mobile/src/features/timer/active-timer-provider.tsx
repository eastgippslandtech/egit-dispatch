import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ActiveTimer, MobileJob } from "../../contracts/mobile";
import type { TechnicianRepository } from "../../data/technician-repository";
import { colours } from "../../theme/tokens";
import { TimerBar } from "./timer-bar";

interface ActiveTimerSnapshot {
  baseVersion: string;
  jobId: string;
  jobTitle: string;
  timer: ActiveTimer;
}

interface ActiveTimerContextValue {
  activeSnapshot: ActiveTimerSnapshot | null;
  activeTimer: ActiveTimer | null;
  isTimerForJob: (jobId: string) => boolean;
  startTimerForJob: (job: MobileJob) => Promise<void>;
  stopActiveTimer: () => Promise<void>;
  timerMessage: string | null;
}

const ACTIVE_TIMER_KEY = "command-centre.active-timer.v2";

const ActiveTimerContext = createContext<ActiveTimerContextValue | null>(null);

export function ActiveTimerProvider({
  children,
  repository,
}: PropsWithChildren<{ repository: TechnicianRepository }>) {
  const [activeSnapshot, setActiveSnapshot] =
    useState<ActiveTimerSnapshot | null>(null);
  const [timerMessage, setTimerMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void restoreActiveTimerSnapshot().then((snapshot) => {
      if (!cancelled && snapshot) {
        setActiveSnapshot(snapshot);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ActiveTimerContextValue>(
    () => ({
      activeSnapshot,
      activeTimer: activeSnapshot?.timer ?? null,
      isTimerForJob: (jobId: string) => activeSnapshot?.jobId === jobId,
      startTimerForJob: async (job: MobileJob) => {
        setTimerMessage(null);
        try {
          const timer = await repository.startTimer({
            baseVersion: job.version,
            clientMutationId: `timer-start-${job.id}-${Date.now()}`,
            installationId: "local-simulator",
            jobId: job.id,
            occurredAt: new Date().toISOString(),
          });
          const snapshot: ActiveTimerSnapshot = {
            baseVersion: job.version,
            jobId: job.id,
            jobTitle: job.title,
            timer,
          };
          setActiveSnapshot(snapshot);
          await saveActiveTimerSnapshot(snapshot);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Timer could not start.";
          setTimerMessage(message);
        }
      },
      stopActiveTimer: async () => {
        if (!activeSnapshot) return;
        try {
          const stopped = await repository.stopTimer({
            baseVersion: activeSnapshot.baseVersion,
            clientMutationId: `timer-stop-${activeSnapshot.jobId}-${Date.now()}`,
            installationId: "local-simulator",
            jobId: activeSnapshot.jobId,
            occurredAt: new Date().toISOString(),
            startedAt: activeSnapshot.timer.startedAt,
            timerId: activeSnapshot.timer.id,
          });
          setActiveSnapshot(null);
          await clearActiveTimerSnapshot();
          setTimerMessage(
            `Timer stopped: ${stopped.roundedMinutes} minutes queued`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Timer could not stop.";
          if (message.includes("active timer does not match")) {
            setActiveSnapshot(null);
            await clearActiveTimerSnapshot();
            setTimerMessage("Timer stopped: restored timer queued");
            return;
          }
          setTimerMessage(message);
        }
      },
      timerMessage,
    }),
    [activeSnapshot, repository, timerMessage],
  );

  return (
    <ActiveTimerContext.Provider value={value}>
      {children}
    </ActiveTimerContext.Provider>
  );
}

export function GlobalTimerBanner({ now = new Date() }: { now?: Date }) {
  const activeTimer = useOptionalActiveTimer();
  if (!activeTimer) return null;

  if (activeTimer.activeSnapshot) {
    return (
      <View style={styles.banner}>
        <TimerBar
          jobTitle={activeTimer.activeSnapshot.jobTitle}
          now={now}
          onStop={() => {
            void activeTimer.stopActiveTimer();
          }}
          timer={activeTimer.activeSnapshot.timer}
        />
      </View>
    );
  }

  if (activeTimer.timerMessage) {
    return (
      <View style={styles.messageBanner}>
        <Text style={styles.messageText}>{activeTimer.timerMessage}</Text>
      </View>
    );
  }

  return null;
}

export function useActiveTimer(): ActiveTimerContextValue {
  const context = useContext(ActiveTimerContext);
  if (!context) {
    throw new Error("useActiveTimer must be used within ActiveTimerProvider.");
  }
  return context;
}

function useOptionalActiveTimer(): ActiveTimerContextValue | null {
  return useContext(ActiveTimerContext);
}

async function saveActiveTimerSnapshot(
  snapshot: ActiveTimerSnapshot,
): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.setItemAsync(ACTIVE_TIMER_KEY, JSON.stringify(snapshot));
}

async function restoreActiveTimerSnapshot(): Promise<ActiveTimerSnapshot | null> {
  const secureStore = await loadSecureStore();
  const raw = await secureStore?.getItemAsync(ACTIVE_TIMER_KEY);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as ActiveTimerSnapshot;
    return snapshot.timer?.startedAt ? snapshot : null;
  } catch {
    await clearActiveTimerSnapshot();
    return null;
  }
}

async function clearActiveTimerSnapshot(): Promise<void> {
  const secureStore = await loadSecureStore();
  await secureStore?.deleteItemAsync(ACTIVE_TIMER_KEY);
}

async function loadSecureStore(): Promise<
  | {
      deleteItemAsync(key: string): Promise<void>;
      getItemAsync(key: string): Promise<string | null>;
      setItemAsync(key: string, value: string): Promise<void>;
    }
  | null
> {
  try {
    return await import("expo-secure-store");
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colours.primary,
  },
  messageBanner: {
    backgroundColor: colours.surfaceWarm,
    borderBottomColor: colours.borderWarm,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  messageText: {
    color: colours.primary,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
});
