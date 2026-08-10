import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import {
  clearMobileSession,
  type MobileSession,
  restoreMobileSession,
  saveMobileSession,
} from "../auth/session-store";
import { createApiClient } from "../api/client";
import { refreshMobileSession } from "../auth/session-refresh";
import { performZohoSignIn, type ZohoSignInResult } from "../auth/zoho-sign-in";
import { getMobileRuntimeConfig } from "../config/runtime";
import type { MobileStaff } from "../contracts/mobile";
import { createApiTechnicianRepository } from "../data/api-technician-repository";
import { MockTechnicianRepository } from "../data/mock-technician-repository";
import { createOfflineTechnicianRepository } from "../data/offline-technician-repository";
import type { TechnicianRepository } from "../data/technician-repository";
import {
  createInMemoryCommandCentreDatabase,
  openCommandCentreDatabase,
} from "../db/database";
import { createMutationQueue } from "../features/sync/mutation-queue";
import { MOBILE_STAFF_FIXTURES } from "../testing/fixtures";

export type TechnicianSession =
  | { status: "signed-out" }
  | { status: "approved"; mobileSession?: MobileSession; staff: MobileStaff };

export const REVIEWER_DEMO_CODE = "EGIT-REVIEW-2026";

interface SessionContextValue {
  isSigningIn: boolean;
  signInError: string | null;
  session: TechnicianSession;
  signInWithReviewerDemo: (code: string) => boolean;
  signInWithZoho: () => Promise<void>;
  signOut: () => void;
}

interface AppProvidersProps extends PropsWithChildren {
  initialSession?: TechnicianSession;
  repository?: TechnicianRepository;
  signInWithZoho?: () => Promise<ZohoSignInResult>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const TechnicianRepositoryContext = createContext<TechnicianRepository | null>(
  null,
);

const approvedMockStaff: MobileStaff =
  MOBILE_STAFF_FIXTURES.find(
    (staff) => staff.email === "riley@egit.com.au",
  ) ?? missingApprovedMockStaff();

function missingApprovedMockStaff(): never {
  throw new Error("The approved Riley mock staff record is missing.");
}

export function AppProviders({
  children,
  initialSession = { status: "signed-out" },
  repository,
  signInWithZoho = performZohoSignIn,
}: AppProvidersProps) {
  const [session, setSession] = useState<TechnicianSession>(initialSession);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [liveRepository, setLiveRepository] = useState<{
    accessToken: string;
    repository: TechnicianRepository;
  } | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const injectedRepository = repository;
  useEffect(() => {
    let isMounted = true;

    if (initialSession.status === "approved") {
      return () => {
        isMounted = false;
      };
    }

    restoreMobileSession()
      .then((restoredSession) => {
        if (!isMounted || !restoredSession) {
          return;
        }

        return refreshMobileSession(restoredSession).then((currentSession) => {
          if (!isMounted) {
            return;
          }

          if (!currentSession) {
            void clearMobileSession();
            return;
          }

          if (currentSession !== restoredSession) {
            void saveMobileSession(currentSession);
          }

          const restoredStaff = MOBILE_STAFF_FIXTURES.find(
            (staff) => staff.email === currentSession.staffEmail,
          );
          if (restoredStaff) {
            setSession({
              status: "approved",
              mobileSession: currentSession,
              staff: restoredStaff,
            });
          }
        });
      })
      .catch(() => {
        // A failed restore should not block the normal sign-in path.
      });

    return () => {
      isMounted = false;
    };
  }, [initialSession.status]);

  const effectiveStaffEmail =
    session.status === "approved"
      ? session.staff.email
      : approvedMockStaff.email;
  const refreshApprovedSession = useCallback(
    async (sessionToRefresh: MobileSession) => {
      const currentSession = await refreshMobileSession(sessionToRefresh);
      if (!currentSession) {
        void clearMobileSession();
        setSession({ status: "signed-out" });
        return null;
      }

      if (currentSession !== sessionToRefresh) {
        void saveMobileSession(currentSession);
        setSession((current) =>
          current.status === "approved" &&
          current.mobileSession?.accessToken === sessionToRefresh.accessToken
            ? { ...current, mobileSession: currentSession }
            : current,
        );
      }

      return currentSession.accessToken;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    if (
      injectedRepository ||
      session.status !== "approved" ||
      !session.mobileSession ||
      isLocalMockSession(session.mobileSession)
    ) {
      return () => {
        cancelled = true;
      };
    }

    const mobileSession = session.mobileSession;
    createLiveRepository(mobileSession, session.staff, () =>
      refreshApprovedSession(mobileSession),
    )
      .then((nextRepository) => {
        if (!cancelled) {
          setLiveRepository({
            accessToken: mobileSession.accessToken,
            repository: nextRepository,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLiveRepository({
            accessToken: mobileSession.accessToken,
            repository: createUnavailableRepository(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [injectedRepository, refreshApprovedSession, session]);

  const repositoryValue = useMemo<TechnicianRepository>(() => {
    if (injectedRepository) {
      return injectedRepository;
    }
    if (
      session.status === "approved" &&
      session.mobileSession &&
      !isLocalMockSession(session.mobileSession)
    ) {
      if (liveRepository?.accessToken === session.mobileSession.accessToken) {
        return liveRepository.repository;
      }
      const mobileSession = session.mobileSession;
      return (
        createSessionRemoteRepository(mobileSession, session.staff, () =>
          refreshApprovedSession(mobileSession),
        )
      );
    }
    return new MockTechnicianRepository({ staffEmail: effectiveStaffEmail });
  }, [
    effectiveStaffEmail,
    injectedRepository,
    liveRepository,
    refreshApprovedSession,
    session,
  ]);
  const sessionValue = useMemo<SessionContextValue>(
    () => ({
      isSigningIn,
      signInError,
      session,
      signInWithZoho: async () => {
        setIsSigningIn(true);
        setSignInError(null);
        try {
          const result = await signInWithZoho();
          setSession({
            status: "approved",
            mobileSession: result.session,
            staff: result.staff,
          });
        } catch (error) {
          setSignInError(
            error instanceof Error ? error.message : "Zoho sign-in failed.",
          );
        } finally {
          setIsSigningIn(false);
        }
      },
      signInWithReviewerDemo: (code: string) => {
        setSignInError(null);
        if (code.trim() !== REVIEWER_DEMO_CODE) {
          return false;
        }

        setSession({ status: "approved", staff: approvedMockStaff });
        return true;
      },
      signOut: () => {
        setSignInError(null);
        void clearMobileSession();
        setSession({ status: "signed-out" });
      },
    }),
    [isSigningIn, session, signInError, signInWithZoho],
  );

  return (
    <TechnicianRepositoryContext.Provider value={repositoryValue}>
      <SessionContext.Provider value={sessionValue}>
        {children}
      </SessionContext.Provider>
    </TechnicianRepositoryContext.Provider>
  );
}

async function createLiveRepository(
  session: MobileSession,
  staff: MobileStaff,
  refreshAccessToken: () => Promise<string | null>,
): Promise<TechnicianRepository> {
  const database = await openCommandCentreDatabase().catch(() =>
    createInMemoryCommandCentreDatabase(),
  );
  const remote = createSessionRemoteRepository(session, staff, refreshAccessToken);
  const api = createSessionApiClient(session, refreshAccessToken);
  return createOfflineTechnicianRepository({
    api,
    database,
    queue: createMutationQueue(database),
    remote,
  });
}

function createSessionRemoteRepository(
  session: MobileSession,
  staff: MobileStaff,
  refreshAccessToken: () => Promise<string | null>,
): TechnicianRepository {
  const api = createSessionApiClient(session, refreshAccessToken);
  const remote = createApiTechnicianRepository(api);
  return {
    ...remote,
    getCurrentStaff: async () => staff,
  };
}

function createSessionApiClient(
  session: MobileSession,
  refreshAccessToken: () => Promise<string | null>,
) {
  const config = getMobileRuntimeConfig();
  return createApiClient({
    accessToken: session.accessToken,
    baseUrl: config.mobileApiBaseUrl,
    refreshAccessToken,
  });
}

function isLocalMockSession(session: MobileSession): boolean {
  return session.accessToken.startsWith("local-mock-");
}

function createUnavailableRepository(error?: unknown): TechnicianRepository {
  const message =
    error instanceof Error
      ? error.message
      : "Preparing live Command Centre connection.";
  const reject = async () => {
    throw new Error(message);
  };

  return {
    addPart: reject,
    attachEvidence: reject,
    completeJob: reject,
    getCurrentStaff: reject,
    getJob: reject,
    listSchedule: reject,
    saveSignOff: reject,
    saveWorklog: reject,
    startTimer: reject,
    stopTimer: reject,
    updateStatus: reject,
  };
}

export function useTechnicianRepository(): TechnicianRepository {
  const repository = useContext(TechnicianRepositoryContext);
  if (!repository) {
    throw new Error(
      "useTechnicianRepository must be used within AppProviders.",
    );
  }
  return repository;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used within AppProviders.");
  }
  return session;
}

export type { ZohoSignInResult };
