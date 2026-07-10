import NextAuth from "next-auth";

import { createZohoProvider } from "@/server/auth/zoho-provider";

const zohoClientId = process.env.ZOHO_CLIENT_ID ?? process.env.AUTH_ZOHO_ID;
const zohoClientSecret =
  process.env.ZOHO_CLIENT_SECRET ?? process.env.AUTH_ZOHO_SECRET;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    createZohoProvider({
      clientId: zohoClientId,
      clientSecret: zohoClientSecret,
    }),
  ],
  pages: {
    signIn: "/auth/sign-in",
    error: "/auth/access-denied",
  },
  secret: authSecret,
  trustHost: true,
});
