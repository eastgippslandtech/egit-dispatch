import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessLevel: "staff" | "wallboard";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessLevel?: "staff" | "wallboard";
  }
}
