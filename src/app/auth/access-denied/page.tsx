import { AccessNotApproved, AuthenticationProblem } from "../auth-screen";

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return error ? <AuthenticationProblem /> : <AccessNotApproved />;
}
