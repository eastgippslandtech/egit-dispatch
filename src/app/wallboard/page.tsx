import type { Metadata } from "next";

import { ProtectedWallboardScreen } from "./protected-screen";

export const metadata: Metadata = {
  title: "Wallboard",
};

export default async function WallboardPage() {
  return ProtectedWallboardScreen();
}
