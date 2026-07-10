import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import type { MobileStaff } from "../contracts/mobile";
import { MockTechnicianRepository } from "../data/mock-technician-repository";
import type { TechnicianRepository } from "../data/technician-repository";
import { MOBILE_STAFF_FIXTURES } from "../testing/fixtures";

export type TechnicianSession =
  | { status: "signed-out" }
  | { status: "approved"; staff: MobileStaff };

interface SessionContextValue {
  session: TechnicianSession;
  signInWithZoho: () => void;
  signOut: () => void;
}

interface AppProvidersProps extends PropsWithChildren {
  initialSession?: TechnicianSession;
  repository?: TechnicianRepository;
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
}: AppProvidersProps) {
  const [session, setSession] = useState<TechnicianSession>(initialSession);
  const [repositoryValue] = useState<TechnicianRepository>(() => {
    if (repository) return repository;

    const staff =
      initialSession.status === "approved"
        ? initialSession.staff
        : approvedMockStaff;
    return new MockTechnicianRepository({ staffEmail: staff.email });
  });
  const sessionValue = useMemo<SessionContextValue>(
    () => ({
      session,
      signInWithZoho: () =>
        setSession({ status: "approved", staff: approvedMockStaff }),
      signOut: () => setSession({ status: "signed-out" }),
    }),
    [session],
  );

  return (
    <TechnicianRepositoryContext.Provider value={repositoryValue}>
      <SessionContext.Provider value={sessionValue}>
        {children}
      </SessionContext.Provider>
    </TechnicianRepositoryContext.Provider>
  );
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
