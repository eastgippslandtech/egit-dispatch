import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { performZohoSignIn, type ZohoSignInResult } from "../auth/zoho-sign-in";
import type { MobileStaff } from "../contracts/mobile";
import { MockTechnicianRepository } from "../data/mock-technician-repository";
import type { TechnicianRepository } from "../data/technician-repository";
import { MOBILE_STAFF_FIXTURES } from "../testing/fixtures";

export type TechnicianSession =
  | { status: "signed-out" }
  | { status: "approved"; staff: MobileStaff };

interface SessionContextValue {
  isSigningIn: boolean;
  signInError: string | null;
  session: TechnicianSession;
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
  const [signInError, setSignInError] = useState<string | null>(null);
  const [injectedRepository] = useState(repository);
  const effectiveStaffEmail =
    session.status === "approved"
      ? session.staff.email
      : approvedMockStaff.email;
  const repositoryValue = useMemo<TechnicianRepository>(
    () =>
      injectedRepository ??
      new MockTechnicianRepository({ staffEmail: effectiveStaffEmail }),
    [effectiveStaffEmail, injectedRepository],
  );
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
          setSession({ status: "approved", staff: result.staff });
        } catch (error) {
          setSignInError(
            error instanceof Error ? error.message : "Zoho sign-in failed.",
          );
        } finally {
          setIsSigningIn(false);
        }
      },
      signOut: () => {
        setSignInError(null);
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
