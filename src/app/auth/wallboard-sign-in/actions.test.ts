import { beforeEach, describe, expect, it, vi } from "vitest";

const { CredentialsSignin, redirectMock } = vi.hoisted(() => ({
  CredentialsSignin: class CredentialsSignin extends Error {},
  redirectMock: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
}));

vi.mock("next-auth", () => ({ CredentialsSignin }));
vi.mock("@/auth", () => ({
  signIn: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { signIn } from "@/auth";

import { wallboardSignIn } from "./actions";

const signInMock = vi.mocked(signIn);

function credentialsFormData() {
  const formData = new FormData();
  formData.set("username", "  WALLBOARD  ");
  formData.set("password", "Display-only 42!");
  return formData;
}

describe("wallboardSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits normalized local credentials and returns to the wallboard", async () => {
    signInMock.mockResolvedValue(undefined as never);

    await wallboardSignIn(credentialsFormData());

    expect(signInMock).toHaveBeenCalledWith("wallboard", {
      password: "Display-only 42!",
      redirectTo: "/wallboard",
      username: "wallboard",
    });
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("redirects credential failures to the generic invalid details state", async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());

    await expect(wallboardSignIn(credentialsFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/auth/wallboard-sign-in?error=invalid",
    );

    expect(redirectMock).toHaveBeenCalledWith(
      "/auth/wallboard-sign-in?error=invalid",
    );
  });

  it("rethrows unexpected sign-in failures", async () => {
    const unexpectedError = new Error("Auth service unavailable");
    signInMock.mockRejectedValue(unexpectedError);

    await expect(wallboardSignIn(credentialsFormData())).rejects.toBe(
      unexpectedError,
    );
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
