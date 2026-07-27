import NextAuth, { type NextAuthConfig } from "next-auth";

import { createWallboardProvider } from "@/server/auth/wallboard-provider";
import { createZohoProvider } from "@/server/auth/zoho-provider";

const zohoClientId = process.env.ZOHO_CLIENT_ID ?? process.env.AUTH_ZOHO_ID;
const zohoClientSecret =
  process.env.ZOHO_CLIENT_SECRET ?? process.env.AUTH_ZOHO_SECRET;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const authCallbacks = {
  async jwt({ token, account }) {
    if (account?.provider === "wallboard") {
      return { ...token, accessLevel: "wallboard" };
    }

    if (account?.provider === "zoho" || (!token.accessLevel && token.email)) {
      return { ...token, accessLevel: "staff" };
    }

    return token;
  },
  async session({ session, token }) {
    if (token.accessLevel) {
      session.accessLevel = token.accessLevel;
    }

    return session;
  },
} satisfies NonNullable<NextAuthConfig["callbacks"]>;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    createZohoProvider({
      clientId: zohoClientId,
      clientSecret: zohoClientSecret,
    }),
    createWallboardProvider(),
  ],
  callbacks: authCallbacks,
  pages: {
    signIn: "/auth/sign-in",
    error: "/auth/access-denied",
  },
  secret: authSecret,
  session: { maxAge: 30 * 24 * 60 * 60, strategy: "jwt" },
  trustHost: true,
});
