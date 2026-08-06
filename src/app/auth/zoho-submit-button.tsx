"use client";

import { useFormStatus } from "react-dom";

export function ZohoSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      aria-disabled={pending}
      className="w-full rounded-md bg-cc-orange px-4 py-2.5 text-sm font-semibold text-cc-surface-1 transition hover:brightness-110 active:brightness-95 disabled:cursor-wait disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Opening Zoho..." : "Sign in with Zoho"}
    </button>
  );
}
