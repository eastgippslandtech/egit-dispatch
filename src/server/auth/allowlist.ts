export function getAllowedAuthEmails(allowlist: string | undefined) {
  return (allowlist ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAuthEmail(
  email: string | null | undefined,
  allowlist: string | undefined = process.env.ALLOWED_AUTH_EMAILS,
) {
  if (!email) {
    return false;
  }

  return getAllowedAuthEmails(allowlist).includes(email.trim().toLowerCase());
}
