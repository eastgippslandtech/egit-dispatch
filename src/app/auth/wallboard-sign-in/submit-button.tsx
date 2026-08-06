"use client";

import { useFormStatus } from "react-dom";

export function WallboardSubmitButton({ configured }: { configured: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className="w-full rounded-md bg-cc-orange px-4 py-2.5 text-sm font-semibold text-cc-surface-1 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-55"
      disabled={!configured || pending}
      type="submit"
    >
      {pending ? "Signing in..." : "Sign in to Wallboard"}
    </button>
  );
}
