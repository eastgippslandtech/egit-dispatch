type DeploymentEnv = Record<string, string | undefined> & {
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_URL?: string;
};

export function getDeploymentVersion(env: DeploymentEnv = process.env) {
  return (
    env.VERCEL_URL?.trim() ||
    env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    "local"
  );
}

export function shouldReloadForDeployment(
  currentVersion: string,
  responseVersion: string | null,
) {
  const current = currentVersion.trim();
  const response = responseVersion?.trim();

  return Boolean(current && response && current !== response);
}
