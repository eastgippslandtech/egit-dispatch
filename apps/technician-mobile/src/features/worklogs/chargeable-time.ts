import type { MobileJob } from "../../contracts/mobile";

export function getMobileChargeableTime(job: MobileJob) {
  const start = new Date(job.startAt).getTime();
  const end = new Date(job.endAt).getTime();
  const jobMinutes =
    Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, Math.round((end - start) / 60_000))
      : 0;
  const travelMinutes =
    job.bookingType === "Onsite"
      ? Math.max(
          0,
          (job.travel?.travelToSiteMinutes ?? 0) +
            (job.travel?.travelBackToOfficeMinutes ?? 0),
        )
      : 0;

  return {
    jobMinutes,
    totalMinutes: jobMinutes + travelMinutes,
    travelMinutes,
  };
}
