import type { Metadata } from "next";

import { ProtectedCommandCentreScreen } from "./command-centre/protected-screen";

export const metadata: Metadata = {
  title: "Dispatch",
};

export default async function DispatchPage() {
  return ProtectedCommandCentreScreen();
}
