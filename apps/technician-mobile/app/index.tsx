import { Redirect } from "expo-router";

import { useSession } from "../src/providers/app-providers";

export default function IndexRoute() {
  const { session } = useSession();

  return (
    <Redirect
      href={session.status === "approved" ? "/(tabs)/today" : "/sign-in"}
    />
  );
}
