import type { Metadata } from "next";

import { ProtectedDispatchQueueScreen } from "./protected-screen";

export const metadata: Metadata = {
  title: "Queue",
};

export default async function DispatchQueuePage() {
  return ProtectedDispatchQueueScreen();
}
