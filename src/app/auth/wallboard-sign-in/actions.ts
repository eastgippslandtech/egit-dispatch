"use server";

import { CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";

export async function wallboardSignIn(formData: FormData) {
  const username = formValue(formData, "username").trim().toLowerCase();
  const password = formValue(formData, "password");

  try {
    await signIn("wallboard", {
      password,
      redirectTo: "/wallboard",
      username,
    });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      redirect("/auth/wallboard-sign-in?error=invalid");
    }

    throw error;
  }
}

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
