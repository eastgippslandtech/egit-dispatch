import { redirect } from "next/navigation";

import { isAuthDisabled } from "@/server/auth/session";

import { CommandCentreSignIn } from "../auth-screen";

export default function SignInPage() {
  if (isAuthDisabled()) {
    redirect("/dispatch");
  }

  return <CommandCentreSignIn />;
}
