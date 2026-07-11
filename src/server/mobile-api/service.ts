import {
  cloneMobileFixture,
  MOBILE_JOB_FIXTURES,
  MOBILE_STAFF_FIXTURES,
} from "../../../apps/technician-mobile/src/testing/fixtures";
import type { MobileJob } from "../../../apps/technician-mobile/src/contracts/mobile";

import type { MobileAuthContext, MobileWorklogCommand } from "./contracts";

export const rileyMobileAuth: MobileAuthContext = {
  email: "riley@egit.com.au",
  staffId: "staff-riley",
};

export async function getMobileMe({ auth }: { auth: MobileAuthContext }) {
  const staff = MOBILE_STAFF_FIXTURES.find(
    (candidate) => candidate.email.toLowerCase() === auth.email.toLowerCase(),
  );
  if (!staff) {
    throw Object.assign(new Error("Mobile staff profile was not found."), {
      status: 404,
    });
  }
  return { staff: cloneMobileFixture(staff) };
}

export async function listMobileJobs({
  auth,
  from,
  to,
}: {
  auth: MobileAuthContext;
  from: string;
  to: string;
}): Promise<{ jobs: MobileJob[] }> {
  return {
    jobs: MOBILE_JOB_FIXTURES.filter(
      (job) => job.technician.email.toLowerCase() === auth.email.toLowerCase(),
    )
      .filter((job) => {
        const date = job.startAt.slice(0, 10);
        return date >= from && date <= to;
      })
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map(cloneMobileFixture),
  };
}

export async function getMobileJob({
  auth,
  jobId,
}: {
  auth: MobileAuthContext;
  jobId: string;
}): Promise<{ job: MobileJob }> {
  const job = findOwnedJob(auth, jobId);
  return { job: cloneMobileFixture(job) };
}

export async function saveMobileWorklog({
  auth,
  command,
  jobId,
}: {
  auth: MobileAuthContext;
  command: MobileWorklogCommand;
  jobId: string;
}) {
  const job = findOwnedJob(auth, jobId);
  if (!job.permissions.canWriteWorklog) {
    throw Object.assign(
      new Error(job.permissions.readOnlyReason ?? "This source is read-only."),
      { code: "READ_ONLY_SOURCE", status: 409 },
    );
  }

  if (!command.body.trim()) {
    throw Object.assign(new Error("Worklog body is required."), {
      code: "BAD_REQUEST",
      status: 400,
    });
  }

  return {
    receipt: {
      clientMutationId: command.clientMutationId,
      resourceId: `note-${command.clientMutationId}`,
      resourceVersion: `${job.version}-note`,
      status: "applied" as const,
    },
  };
}

export async function registerMobilePushToken({
  appVersion,
  installationId,
  platform,
}: {
  appVersion: string;
  installationId: string;
  platform: string;
  pushToken: string;
}) {
  return {
    device: {
      appVersion,
      installationId,
      platform,
      registered: true,
    },
  };
}

function findOwnedJob(auth: MobileAuthContext, jobId: string): MobileJob {
  const job = MOBILE_JOB_FIXTURES.find((candidate) => candidate.id === jobId);
  if (!job || job.technician.email.toLowerCase() !== auth.email.toLowerCase()) {
    throw Object.assign(new Error("Mobile job was not found."), {
      code: "NOT_FOUND",
      status: 404,
    });
  }
  return job;
}
