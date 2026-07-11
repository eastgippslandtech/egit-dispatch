import { useLocalSearchParams } from "expo-router";

import { JobDetail } from "../../src/features/jobs/job-detail";

export default function JobDetailRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return <JobDetail jobId={jobId} />;
}
