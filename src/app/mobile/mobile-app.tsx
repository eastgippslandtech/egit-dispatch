"use client";

import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Mail,
  MapPin,
  PackagePlus,
  Phone,
  Play,
  Save,
  Square,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  ActiveMobileTimer,
  MobileCustomerSignOff,
  MobileEvidenceKind,
  MobileJob,
  MobileJobActions,
  MobileJobEvidence,
  MobileJobStatus,
  MobilePageData,
  MobilePartUsed,
  MobileWorklogType,
  StoppedMobileTimer,
} from "@/server/mobile/types";

const statusOptions: MobileJobStatus[] = [
  "Scheduled",
  "In Progress",
  "Waiting on Customer",
  "Waiting on Parts",
  "Needs Follow-up",
  "Completed",
  "Cancelled / No Access",
];

const worklogTypes: { label: string; value: MobileWorklogType }[] = [
  { label: "Billable", value: "billable" },
  { label: "Internal", value: "internal" },
  { label: "Non-billable", value: "non_billable" },
];

type Tab = "schedule" | "workload";
type EtaState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; distanceKm: number; etaMinutes: number }
  | { status: "denied" };

const destinationCoordinates: Array<{
  match: string;
  latitude: number;
  longitude: number;
}> = [
  { match: "sale vic 3850", latitude: -38.1026, longitude: 147.073 },
  { match: "bairnsdale vic 3875", latitude: -37.825, longitude: 147.63 },
  { match: "lakes entrance vic 3909", latitude: -37.881, longitude: 147.981 },
];

export function CommandCentreMobileApp({ data }: { data: MobilePageData }) {
  const [activeTab, setActiveTab] = useState<Tab>("schedule");
  const [selectedDate, setSelectedDate] = useState(data.initialDate);
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>(
    data.jobs.find((job) => job.scheduledDate === data.initialDate)?.id,
  );
  const [jobs, setJobs] = useState(data.jobs);
  const [activeTimer, setActiveTimer] = useState<ActiveMobileTimer>();
  const [stoppedTimer, setStoppedTimer] = useState<StoppedMobileTimer>();
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState<MobileWorklogType>("billable");
  const [noteMinutes, setNoteMinutes] = useState("");
  const [noteStatus, setNoteStatus] = useState<MobileJobStatus>("In Progress");
  const [simulateNoteFailure, setSimulateNoteFailure] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string>();
  const [completeMessage, setCompleteMessage] = useState<string>();
  const [followUpNeeded, setFollowUpNeeded] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState(
    data.assignableTechnicians[0]?.id ?? "",
  );

  const selectedDateJobs = useMemo(
    () => jobs.filter((job) => job.scheduledDate === selectedDate),
    [jobs, selectedDate],
  );
  const selectedJob = useMemo(
    () =>
      jobs.find((job) => job.id === selectedJobId) ??
      selectedDateJobs[0],
    [jobs, selectedDateJobs, selectedJobId],
  );
  const jobActions = selectedJob ? actionsForJob(selectedJob) : undefined;
  const activeTimerJob = activeTimer
    ? jobs.find((job) => job.id === activeTimer.jobId)
    : undefined;

  function moveDate(days: number) {
    setSelectedDate((current) => shiftDate(current, days));
    setSelectedJobId(undefined);
  }

  function startSelectedTimer() {
    if (!selectedJob || selectedJob.readOnlyOutlook) {
      return;
    }

    if (activeTimer) {
      setNoteMessage("A timer is already running for this technician.");
      return;
    }

    setActiveTimer({
      id: `timer-${Date.now()}`,
      jobId: selectedJob.id,
      technicianId: selectedJob.technicianId,
      startedAt: new Date().toISOString(),
    });
    setNoteMessage(undefined);
  }

  function stopSelectedTimer() {
    if (!activeTimer) {
      return;
    }

    const stoppedAt = new Date();
    const actualElapsedMinutes = Math.max(
      1,
      Math.ceil(
        (stoppedAt.getTime() - new Date(activeTimer.startedAt).getTime()) / 60000,
      ),
    );

    setStoppedTimer({
      ...activeTimer,
      stoppedAt: stoppedAt.toISOString(),
      actualElapsedMinutes,
      roundedMinutes: Math.ceil(actualElapsedMinutes / 15) * 15,
    });
    setActiveTimer(undefined);
  }

  function updateSelectedJobStatus(status: MobileJobStatus) {
    if (!selectedJob || selectedJob.readOnlyOutlook) {
      return;
    }

    setJobs((current) =>
      current.map((job) => (job.id === selectedJob.id ? { ...job, status } : job)),
    );
  }

  function addEvidenceToSelectedJob(evidence: MobileJobEvidence) {
    setJobs((current) =>
      current.map((job) =>
        job.id === evidence.jobId
          ? { ...job, evidence: [...job.evidence, evidence] }
          : job,
      ),
    );
  }

  function saveSignOffForSelectedJob(signOff: MobileCustomerSignOff) {
    setJobs((current) =>
      current.map((job) =>
        job.id === signOff.jobId ? { ...job, customerSignOff: signOff } : job,
      ),
    );
  }

  function addPartToSelectedJob(part: MobilePartUsed) {
    setJobs((current) =>
      current.map((job) =>
        job.id === part.jobId
          ? { ...job, partsUsed: [...job.partsUsed, part] }
          : job,
      ),
    );
  }

  function saveNote() {
    if (!selectedJob) {
      return;
    }

    if (!noteText.trim()) {
      setNoteMessage("Work note is required.");
      return;
    }

    if (simulateNoteFailure) {
      window.sessionStorage.setItem(
        `mobile-note-draft-${selectedJob.id}`,
        JSON.stringify({
          jobId: selectedJob.id,
          noteText,
          optionalMinutes: noteMinutes,
          optionalStatus: noteStatus,
          worklogType: noteType,
        }),
      );
      setNoteMessage("Note save failed. Draft preserved for retry.");
      return;
    }

    setJobs((current) =>
      current.map((job) =>
        job.id === selectedJob.id
          ? {
              ...job,
              previousNotes: [...job.previousNotes, noteText.trim()],
              status: noteStatus,
            }
          : job,
      ),
    );
    setNoteText("");
    setNoteMessage("Note saved locally. MSP Central writeback is not enabled.");
  }

  function completeJob() {
    if (!selectedJob || selectedJob.readOnlyOutlook) {
      return;
    }

    if (activeTimer?.jobId === selectedJob.id) {
      stopSelectedTimer();
      return;
    }

    if (!selectedJob.previousNotes.length && !noteText.trim()) {
      setCompleteMessage("A work note is required before completing this job.");
      return;
    }

    setJobs((current) =>
      current.map((job) =>
        job.id === selectedJob.id
          ? {
              ...job,
              status: followUpNeeded ? "Needs Follow-up" : "Completed",
              previousNotes: noteText.trim()
                ? [...job.previousNotes, noteText.trim()]
                : job.previousNotes,
            }
          : job,
      ),
    );
    setCompleteMessage(
      followUpNeeded
        ? "Job marked as needing follow-up locally."
        : "Job completed locally.",
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#07111f] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07111f]/95 px-4 pb-3 pt-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                {data.signedInStaff.displayName}
              </p>
              <h1 className="text-2xl font-bold text-white">
                Command Centre Mobile
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                {formatDisplayDate(selectedDate)}
              </p>
            </div>
            <div className="rounded-md border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">
              API-ready
            </div>
          </div>

          {activeTimerJob ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-emerald-200/60 bg-emerald-300/18 px-3 py-3 shadow-[0_0_0_1px_rgba(110,231,183,0.16)]">
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-100">
                  Timer running
                </p>
                <p className="truncate text-sm text-white">{activeTimerJob.title}</p>
              </div>
              <button
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-300 px-3 text-sm font-bold text-[#07111f]"
                type="button"
                onClick={stopSelectedTimer}
              >
                <Square size={16} />
                Stop
              </button>
            </div>
          ) : null}

          <nav className="mt-3 grid grid-cols-2 rounded-md border border-white/10 bg-white/[0.04] p-1">
            <TabButton
              active={activeTab === "schedule"}
              label="My Schedule"
              onClick={() => setActiveTab("schedule")}
            />
            <TabButton
              active={activeTab === "workload"}
              label="My Workload"
              onClick={() => setActiveTab("workload")}
            />
          </nav>
        </header>

        {activeTab === "schedule" ? (
          <section className="flex-1 px-4 py-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <IconButton label="Previous day" onClick={() => moveDate(-1)}>
                <ChevronLeft size={18} />
              </IconButton>
              <button
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-slate-100"
                type="button"
                onClick={() => setSelectedDate(data.initialDate)}
              >
                <CalendarDays size={17} />
                Today
              </button>
              <IconButton label="Next day" onClick={() => moveDate(1)}>
                <ChevronRight size={18} />
              </IconButton>
            </div>

            {selectedDateJobs.length ? (
              <div className="space-y-3">
                {selectedDateJobs.map((job) => (
                  <JobCard
                    active={selectedJob?.id === job.id}
                    job={job}
                    key={job.id}
                    onSelect={() => setSelectedJobId(job.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                No jobs scheduled for today.
              </div>
            )}
          </section>
        ) : (
          <section className="flex-1 space-y-3 px-4 py-4">
            {data.workload.map((section) => (
              <div
                className="rounded-md border border-white/10 bg-white/[0.04] p-3"
                key={section.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    {section.label}
                  </h2>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                    {section.jobs.length}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {section.jobs.slice(0, 3).map((job) => (
                    <button
                      className="w-full rounded-md border border-white/10 bg-[#0b1728] px-3 py-2 text-left"
                      key={`${section.id}-${job.id}`}
                      type="button"
                      onClick={() => {
                        setActiveTab("schedule");
                        setSelectedDate(job.scheduledDate);
                        setSelectedJobId(job.id);
                      }}
                    >
                      <span className="block text-sm font-semibold text-slate-100">
                        {job.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        {job.customer} - {job.status}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {selectedJob && jobActions ? (
          <JobDetail
            activeTimer={activeTimer}
            assignableTechnicians={data.assignableTechnicians}
            completeMessage={completeMessage}
            followUpNeeded={followUpNeeded}
            job={selectedJob}
            jobActions={jobActions}
            noteMessage={noteMessage}
            noteMinutes={noteMinutes}
            noteStatus={noteStatus}
            noteText={noteText}
            noteType={noteType}
            selectedAssignee={selectedAssignee}
            simulateNoteFailure={simulateNoteFailure}
            onCompleteJob={completeJob}
            onFollowUpNeededChange={setFollowUpNeeded}
            onNoteMinutesChange={setNoteMinutes}
            onNoteStatusChange={setNoteStatus}
            onNoteTextChange={setNoteText}
            onNoteTypeChange={setNoteType}
            onSaveNote={saveNote}
            onAddEvidence={addEvidenceToSelectedJob}
            onAddPart={addPartToSelectedJob}
            onSaveSignOff={saveSignOffForSelectedJob}
            onSelectedAssigneeChange={setSelectedAssignee}
            onSimulateNoteFailureChange={setSimulateNoteFailure}
            onStartTimer={startSelectedTimer}
            onStopTimer={stopSelectedTimer}
            onStatusChange={updateSelectedJobStatus}
          />
        ) : null}
      </div>

      {stoppedTimer ? (
        <WorklogSummary
          job={jobs.find((job) => job.id === stoppedTimer.jobId)}
          noteText={noteText}
          stoppedTimer={stoppedTimer}
          worklogType={noteType}
          onClose={() => setStoppedTimer(undefined)}
          onNoteTextChange={setNoteText}
          onWorklogTypeChange={setNoteType}
        />
      ) : null}
    </main>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-10 rounded-md text-sm font-semibold ${
        active ? "bg-cyan-300 text-[#07111f]" : "text-slate-300"
      }`}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function JobCard({
  active,
  job,
  onSelect,
}: {
  active: boolean;
  job: MobileJob;
  onSelect: () => void;
}) {
  return (
    <button
      aria-label={`${job.title} ${job.scheduledStart}`}
      className={`w-full rounded-md border p-3 text-left transition ${
        active
          ? "border-cyan-300/50 bg-cyan-300/10"
          : "border-white/10 bg-white/[0.04]"
      }`}
      type="button"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-cyan-100">
            {job.scheduledStart}-{job.scheduledEnd}
          </p>
          <p className="mt-1 text-base font-bold text-white">{job.title}</p>
          <p className="mt-1 text-sm text-slate-300">
            {job.customer} / {job.site}
          </p>
        </div>
        <PriorityChip priority={job.priority} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.requestNumber ? <Chip>{job.requestNumber}</Chip> : null}
        <Chip>{job.status}</Chip>
        <Chip>{job.jobMode}</Chip>
        {job.travelIndicator ? <Chip>{job.travelIndicator}</Chip> : null}
        {job.readOnlyOutlook ? <Chip>Outlook read-only</Chip> : null}
      </div>
    </button>
  );
}

function JobDetail({
  activeTimer,
  assignableTechnicians,
  completeMessage,
  followUpNeeded,
  job,
  jobActions,
  noteMessage,
  noteMinutes,
  noteStatus,
  noteText,
  noteType,
  selectedAssignee,
  simulateNoteFailure,
  onCompleteJob,
  onFollowUpNeededChange,
  onNoteMinutesChange,
  onNoteStatusChange,
  onNoteTextChange,
  onNoteTypeChange,
  onSaveNote,
  onAddEvidence,
  onAddPart,
  onSaveSignOff,
  onSelectedAssigneeChange,
  onSimulateNoteFailureChange,
  onStartTimer,
  onStatusChange,
  onStopTimer,
}: {
  activeTimer?: ActiveMobileTimer;
  assignableTechnicians: MobilePageData["assignableTechnicians"];
  completeMessage?: string;
  followUpNeeded: boolean;
  job: MobileJob;
  jobActions: MobileJobActions;
  noteMessage?: string;
  noteMinutes: string;
  noteStatus: MobileJobStatus;
  noteText: string;
  noteType: MobileWorklogType;
  selectedAssignee: string;
  simulateNoteFailure: boolean;
  onCompleteJob: () => void;
  onFollowUpNeededChange: (value: boolean) => void;
  onNoteMinutesChange: (value: string) => void;
  onNoteStatusChange: (value: MobileJobStatus) => void;
  onNoteTextChange: (value: string) => void;
  onNoteTypeChange: (value: MobileWorklogType) => void;
  onSaveNote: () => void;
  onAddEvidence: (evidence: MobileJobEvidence) => void;
  onAddPart: (part: MobilePartUsed) => void;
  onSaveSignOff: (signOff: MobileCustomerSignOff) => void;
  onSelectedAssigneeChange: (value: string) => void;
  onSimulateNoteFailureChange: (value: boolean) => void;
  onStartTimer: () => void;
  onStatusChange: (status: MobileJobStatus) => void;
  onStopTimer: () => void;
}) {
  const timerRunningForJob = activeTimer?.jobId === job.id;
  const [evidenceKind, setEvidenceKind] = useState<MobileEvidenceKind>("photo");
  const [evidenceFileName, setEvidenceFileName] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceMessage, setEvidenceMessage] = useState<string>();
  const [customerName, setCustomerName] = useState("");
  const [signatureText, setSignatureText] = useState("");
  const [customerAccepted, setCustomerAccepted] = useState(false);
  const [signOffMessage, setSignOffMessage] = useState<string>();
  const [partName, setPartName] = useState("");
  const [partSku, setPartSku] = useState("");
  const [partQuantity, setPartQuantity] = useState("1");
  const [partsMessage, setPartsMessage] = useState<string>();
  const [etaState, setEtaState] = useState<EtaState>({ status: "idle" });
  const canCalculateEta = Boolean(job.address && job.address !== "Remote");
  const mspCentralUnavailable = "MSP Central API access is not configured yet.";
  const outlookWritebackUnavailable = "Outlook writeback is not enabled yet.";

  function handleAddEvidence() {
    if (!evidenceFileName.trim()) {
      setEvidenceMessage("Evidence file name is required.");
      return;
    }

    onAddEvidence({
      id: `evidence-${job.id}-${Date.now()}`,
      capturedAt: new Date().toISOString(),
      fileName: evidenceFileName.trim(),
      jobId: job.id,
      kind: evidenceKind,
      note: evidenceNote.trim() || undefined,
      uploadState: "mock_pending",
    });
    setEvidenceFileName("");
    setEvidenceNote("");
    setEvidenceMessage("Evidence staged locally. Mock pending upload.");
  }

  function handleSaveSignOff() {
    if (!customerAccepted) {
      setSignOffMessage("Customer sign-off must be accepted.");
      return;
    }

    if (!customerName.trim()) {
      setSignOffMessage("Customer name is required for sign-off.");
      return;
    }

    onSaveSignOff({
      id: `signoff-${job.id}-${Date.now()}`,
      accepted: customerAccepted,
      customerName: customerName.trim(),
      jobId: job.id,
      signatureText: signatureText.trim() || undefined,
      signedAt: new Date().toISOString(),
      syncState: "mock_pending",
    });
    setSignOffMessage("Customer sign-off saved locally. Mock pending sync.");
  }

  function handleAddPart() {
    const quantity = Number(partQuantity);

    if (!partName.trim()) {
      setPartsMessage("Part name is required.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPartsMessage("Part quantity must be greater than zero.");
      return;
    }

    onAddPart({
      id: `part-${job.id}-${Date.now()}`,
      jobId: job.id,
      partName: partName.trim(),
      quantity,
      sku: partSku.trim() || undefined,
      syncState: "mock_pending",
    });
    setPartName("");
    setPartSku("");
    setPartQuantity("1");
    setPartsMessage("Part staged locally. Mock pending sync. No inventory writeback.");
  }

  function handleCalculateEta() {
    if (!canCalculateEta || !job.address || !navigator.geolocation) {
      setEtaState({ status: "denied" });
      return;
    }

    const destination = coordinatesForAddress(job.address);

    if (!destination) {
      setEtaState({ status: "denied" });
      return;
    }

    setEtaState({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const distanceKm = calculateDistanceKm(
          {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          destination,
        );

        setEtaState({
          status: "ready",
          distanceKm,
          etaMinutes: Math.max(1, Math.ceil((distanceKm / 60) * 60)),
        });
      },
      () => {
        setEtaState({ status: "denied" });
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  return (
    <section className="border-t border-white/10 bg-[#091527] px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-cyan-200">
            {job.requestNumber ?? "Outlook event"}
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">{job.title}</h2>
        </div>
        {job.readOnlyOutlook ? (
          <span className="rounded-md border border-amber-300/25 bg-amber-300/12 px-2 py-1 text-xs font-semibold text-amber-100">
            Outlook Read Only
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 text-sm">
        <DetailRow label="Description" value={job.description} />
        <DetailRow label="Customer" value={job.customer} />
        <DetailRow label="Site" value={job.site} />
        <DetailRow label="Address" value={job.address ?? "No address recorded"} />
        <DetailRow label="Contact" value={job.contactName ?? "No contact"} />
        <DetailRow label="Phone" value={job.contactPhone ?? "No phone"} />
        <DetailRow label="Email" value={job.contactEmail ?? "No email"} />
        <DetailRow label="Priority" value={job.priority} />
        <DetailRow label="Status" value={job.status} />
        <DetailRow label="SLA/due" value={formatDateTime(job.slaDueAt)} />
        <DetailRow
          label="Scheduled"
          value={`${job.scheduledDate} ${job.scheduledStart}-${job.scheduledEnd}`}
        />
        <DetailRow label="Technician" value={job.technicianName} />
        <DetailRow
          label="Outlook"
          value={job.outlookEventId ? `Linked event ${job.outlookEventId}` : "No link"}
        />
        <DetailRow label="Helpdesk" value={job.linkedMspCentralRequest} />
        <DetailRow label="Travel" value={job.travelInformation} />
      </div>

      {job.readOnlyOutlook ? (
        <p className="mt-3 rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm leading-5 text-amber-100">
          This is a read-only Outlook event. Helpdesk actions are disabled.
          {` ${outlookWritebackUnavailable}`}
        </p>
      ) : (
        <p className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm leading-5 text-cyan-100">
          {mspCentralUnavailable}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ActionButton
          disabled={!jobActions.canStartTimer || Boolean(activeTimer)}
          icon={<Play size={17} />}
          label="Start timer"
          onClick={onStartTimer}
          primary
        />
        <ActionButton
          disabled={!timerRunningForJob}
          icon={<Square size={17} />}
          label="Stop timer"
          onClick={onStopTimer}
        />
        <ActionLink
          disabled={!jobActions.canOpenMaps}
          href={job.address ? `https://maps.google.com/?q=${encodeURIComponent(job.address)}` : ""}
          icon={<MapPin size={17} />}
          label="Open Maps"
        />
        <ActionLink
          disabled={!jobActions.canCallContact}
          href={job.contactPhone ? `tel:${job.contactPhone}` : ""}
          icon={<Phone size={17} />}
          label="Call contact"
        />
        <ActionLink
          disabled={!jobActions.canEmailContact}
          href={job.contactEmail ? `mailto:${job.contactEmail}` : ""}
          icon={<Mail size={17} />}
          label="Email contact"
        />
        <ActionLink
          disabled={!jobActions.canOpenOutlookEvent}
          href={job.outlookWebLink ?? ""}
          icon={<ExternalLink size={17} />}
          label="Open Outlook Event"
        />
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <label className="text-sm font-semibold text-slate-100" htmlFor="work-note">
          Work note
        </label>
        {job.readOnlyOutlook ? (
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Helpdesk notes are disabled for Outlook Read Only events.
          </p>
        ) : null}
        <textarea
          className="mt-2 min-h-44 w-full rounded-md border border-white/10 bg-[#07111f] p-3 text-base text-white outline-none focus:border-cyan-300/60"
          disabled={!jobActions.canAddWorkNote}
          id="work-note"
          value={noteText}
          onChange={(event) => onNoteTextChange(event.target.value)}
        />
        <div className="mt-2 grid grid-cols-1 gap-2">
          <select
            className="min-h-11 rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
            disabled={!jobActions.canAddWorkNote}
            value={noteType}
            onChange={(event) =>
              onNoteTypeChange(event.target.value as MobileWorklogType)
            }
          >
            {worklogTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <input
            className="min-h-11 rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
            disabled={!jobActions.canAddWorkNote}
            inputMode="numeric"
            placeholder="Optional time spent"
            value={noteMinutes}
            onChange={(event) => onNoteMinutesChange(event.target.value)}
          />
          <select
            className="min-h-11 rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
            disabled={!jobActions.canAddWorkNote}
            value={noteStatus}
            onChange={(event) =>
              onNoteStatusChange(event.target.value as MobileJobStatus)
            }
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-slate-300">
          <input
            aria-label="Simulate note save failure"
            checked={simulateNoteFailure}
            type="checkbox"
            onChange={(event) => onSimulateNoteFailureChange(event.target.checked)}
          />
          Simulate save failure
        </label>
        <ActionButton
          disabled={!jobActions.canAddWorkNote}
          icon={<Save size={17} />}
          label="Save note"
          onClick={onSaveNote}
          primary
        />
        {noteMessage ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-amber-100">
            <AlertTriangle size={15} />
            {noteMessage}
          </p>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <label className="text-sm font-semibold text-slate-100" htmlFor="status">
          Change status
        </label>
        {job.readOnlyOutlook ? (
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Status writeback is disabled because this is an Outlook Read Only event.
          </p>
        ) : null}
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
          disabled={!jobActions.canChangeStatus}
          id="status"
          value={job.status}
          onChange={(event) => onStatusChange(event.target.value as MobileJobStatus)}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <label className="flex min-h-10 items-center gap-2 text-sm text-slate-200">
          <input
            checked={followUpNeeded}
            disabled={!jobActions.canComplete}
            type="checkbox"
            onChange={(event) => onFollowUpNeededChange(event.target.checked)}
          />
          Follow-up needed
        </label>
        <ActionButton
          disabled={!jobActions.canComplete}
          icon={<Check size={17} />}
          label="Complete job"
          onClick={onCompleteJob}
          primary
        />
        {completeMessage ? (
          <p className="mt-2 text-sm text-slate-300">{completeMessage}</p>
        ) : null}
        {job.readOnlyOutlook ? (
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Complete and Helpdesk writeback actions are disabled for Outlook Read
            Only events.
          </p>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h3 className="text-sm font-semibold text-slate-100">Travel / ETA</h3>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          Location is only used on this device to calculate your ETA for this job.
        </p>
        <p className="mt-2 text-sm text-slate-300">{job.travelInformation}</p>
        {canCalculateEta && job.address ? (
          <div className="mt-3 grid grid-cols-1 gap-2">
            <ActionButton
              disabled={etaState.status === "loading"}
              icon={<MapPin size={17} />}
              label={
                etaState.status === "loading" ? "Calculating ETA" : "Calculate ETA"
              }
              onClick={handleCalculateEta}
            />
            <ActionLink
              disabled={false}
              href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
              icon={<MapPin size={17} />}
              label="Open in Maps"
            />
            {etaState.status === "ready" ? (
              <p className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-semibold text-cyan-100">
                ETA: {etaState.etaMinutes} min / {etaState.distanceKm.toFixed(1)} km
              </p>
            ) : null}
            {etaState.status === "denied" ? (
              <p className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                Location permission is off. Open in Maps instead.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h3 className="text-sm font-semibold text-slate-100">
          Attachments and photos
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <select
            aria-label="Evidence type"
            className="min-h-11 rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
            disabled={!jobActions.canAttachEvidence}
            value={evidenceKind}
            onChange={(event) =>
              setEvidenceKind(event.target.value as MobileEvidenceKind)
            }
          >
            <option value="photo">Photo</option>
            <option value="attachment">Attachment</option>
          </select>
          <label className="text-xs font-semibold text-slate-300">
            Evidence file name
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canAttachEvidence}
              value={evidenceFileName}
              onChange={(event) => setEvidenceFileName(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-300">
            Evidence note
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canAttachEvidence}
              value={evidenceNote}
              onChange={(event) => setEvidenceNote(event.target.value)}
            />
          </label>
          <ActionButton
            disabled={!jobActions.canAttachEvidence}
            icon={<Camera size={17} />}
            label="Add photo/attachment"
            onClick={handleAddEvidence}
          />
        </div>
        {evidenceMessage ? (
          <p className="mt-2 text-sm text-slate-300">{evidenceMessage}</p>
        ) : null}
        {job.evidence.length ? (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {job.evidence.map((evidence) => (
              <li
                className="rounded-md border border-white/10 bg-[#07111f] px-3 py-2"
                key={evidence.id}
              >
                <span className="block font-semibold text-slate-100">
                  {evidence.fileName}
                </span>
                <span className="mt-0.5 block text-xs text-cyan-100">
                  Mock pending upload
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h3 className="text-sm font-semibold text-slate-100">
          Customer sign-off
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <label className="text-xs font-semibold text-slate-300">
            Customer name
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canCaptureCustomerSignOff}
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-300">
            Signature text
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canCaptureCustomerSignOff}
              placeholder="Typed signature or initials"
              value={signatureText}
              onChange={(event) => setSignatureText(event.target.value)}
            />
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-300">
            <input
              aria-label="Customer accepted work"
              checked={customerAccepted}
              disabled={!jobActions.canCaptureCustomerSignOff}
              type="checkbox"
              onChange={(event) => setCustomerAccepted(event.target.checked)}
            />
            Customer accepted work
          </label>
          <ActionButton
            disabled={!jobActions.canCaptureCustomerSignOff}
            icon={<ClipboardCheck size={17} />}
            label="Save sign-off"
            onClick={handleSaveSignOff}
          />
        </div>
        {signOffMessage ? (
          <p className="mt-2 text-sm text-slate-300">{signOffMessage}</p>
        ) : null}
        {job.customerSignOff ? (
          <p className="mt-3 rounded-md border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-sm text-emerald-100">
            Signed by {job.customerSignOff.customerName}. Mock pending sync.
          </p>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <h3 className="text-sm font-semibold text-slate-100">Parts used</h3>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <label className="text-xs font-semibold text-slate-300">
            Part name
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canTrackParts}
              value={partName}
              onChange={(event) => setPartName(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-300">
            Part SKU
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canTrackParts}
              value={partSku}
              onChange={(event) => setPartSku(event.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-300">
            Part quantity
            <input
              className="mt-1 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
              disabled={!jobActions.canTrackParts}
              inputMode="decimal"
              value={partQuantity}
              onChange={(event) => setPartQuantity(event.target.value)}
            />
          </label>
          <ActionButton
            disabled={!jobActions.canTrackParts}
            icon={<PackagePlus size={17} />}
            label="Add part used"
            onClick={handleAddPart}
          />
        </div>
        {partsMessage ? (
          <p className="mt-2 text-sm text-slate-300">{partsMessage}</p>
        ) : null}
        {job.partsUsed.length ? (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {job.partsUsed.map((part) => (
              <li
                className="rounded-md border border-white/10 bg-[#07111f] px-3 py-2"
                key={part.id}
              >
                <span className="font-semibold text-slate-100">
                  {part.partName} x{part.quantity}
                </span>
                <span className="ml-2 text-xs text-cyan-100">
                  Mock pending sync
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
        <label className="text-sm font-semibold text-slate-100" htmlFor="reassign">
          Reassign technician
        </label>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
          disabled={!jobActions.canReassign}
          id="reassign"
          value={selectedAssignee}
          onChange={(event) => onSelectedAssigneeChange(event.target.value)}
        >
          {assignableTechnicians.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.displayName}
            </option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ActionButton
            disabled={!jobActions.canReassign}
            icon={<UserRound size={17} />}
            label="Reassign technician"
            onClick={() => undefined}
          />
          <ActionButton
            disabled={!jobActions.canReassign}
            icon={<AlertTriangle size={17} />}
            label="Escalate"
            onClick={() => undefined}
          />
          <ActionButton
            disabled={!jobActions.canReassign}
            icon={<AlertTriangle size={17} />}
            label="Needs follow-up"
            onClick={() => onStatusChange("Needs Follow-up")}
          />
          <ActionButton
            disabled={!jobActions.canReassign}
            icon={<AlertTriangle size={17} />}
            label="Needs quote"
            onClick={() => onStatusChange("Needs Follow-up")}
          />
          <ActionButton
            disabled={!jobActions.canReassign}
            icon={<AlertTriangle size={17} />}
            label="Waiting on parts"
            onClick={() => onStatusChange("Waiting on Parts")}
          />
        </div>
      </div>

      {job.previousNotes.length ? (
        <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-3">
          <h3 className="text-sm font-semibold text-slate-100">Previous notes</h3>
          <ul className="mt-2 space-y-2 text-sm text-slate-300">
            {job.previousNotes.map((note, index) => (
              <li key={`${job.id}-note-${index}`}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function WorklogSummary({
  job,
  noteText,
  stoppedTimer,
  worklogType,
  onClose,
  onNoteTextChange,
  onWorklogTypeChange,
}: {
  job?: MobileJob;
  noteText: string;
  stoppedTimer: StoppedMobileTimer;
  worklogType: MobileWorklogType;
  onClose: () => void;
  onNoteTextChange: (value: string) => void;
  onWorklogTypeChange: (value: MobileWorklogType) => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60 p-3">
      <section className="mx-auto w-full max-w-md rounded-md border border-white/10 bg-[#091527] p-4 shadow-2xl">
        <h2 className="text-xl font-bold text-white">Worklog Summary</h2>
        <div className="mt-3 grid gap-2 text-sm">
          <DetailRow label="Job" value={job?.title ?? stoppedTimer.jobId} />
          <DetailRow label="Actual start" value={formatDateTime(stoppedTimer.startedAt)} />
          <DetailRow label="Actual stop" value={formatDateTime(stoppedTimer.stoppedAt)} />
          <DetailRow
            label="Actual elapsed time"
            value={`${stoppedTimer.actualElapsedMinutes} minutes`}
          />
          <DetailRow label="Rounded time" value={`${stoppedTimer.roundedMinutes} minutes`} />
        </div>
        <p className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
          Time rounds up to the next 15 minutes.
        </p>
        <label className="mt-3 block text-sm font-semibold text-slate-100">
          Worklog type
          <select
            className="mt-2 min-h-11 w-full rounded-md border border-white/10 bg-[#07111f] px-3 text-sm text-white"
            value={worklogType}
            onChange={(event) =>
              onWorklogTypeChange(event.target.value as MobileWorklogType)
            }
          >
            {worklogTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-semibold text-slate-100">
          Work note
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-[#07111f] p-3 text-base text-white"
            value={noteText}
            onChange={(event) => onNoteTextChange(event.target.value)}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ActionButton icon={<Save size={17} />} label="Save" onClick={onClose} primary />
          <ActionButton icon={<ChevronLeft size={17} />} label="Cancel/back" onClick={onClose} />
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value || "Not set"}</span>
    </div>
  );
}

function PriorityChip({ priority }: { priority: MobileJob["priority"] }) {
  const classes = {
    Critical: "border-rose-300/30 bg-rose-400/15 text-rose-100",
    High: "border-amber-300/30 bg-amber-300/15 text-amber-100",
    Medium: "border-sky-300/30 bg-sky-300/15 text-sky-100",
    Low: "border-slate-300/20 bg-slate-300/10 text-slate-200",
  };

  return (
    <span className={`rounded-full border px-2 py-1 text-xs font-bold ${classes[priority]}`}>
      {priority}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-medium text-slate-200">
      {children}
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-slate-100"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ActionButton({
  disabled = false,
  icon,
  label,
  onClick,
  primary = false,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold ${
        disabled
          ? "cursor-not-allowed border border-white/10 bg-white/[0.03] text-slate-500"
          : primary
          ? "bg-cyan-300 text-[#07111f]"
          : "border border-white/10 bg-white/[0.06] text-slate-100"
      }`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ActionLink({
  disabled,
  href,
  icon,
  label,
}: {
  disabled: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  const className = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-bold ${
    disabled
      ? "cursor-not-allowed border border-white/10 bg-white/[0.03] text-slate-500"
      : "border border-white/10 bg-white/[0.06] text-slate-100"
  }`;

  if (disabled) {
    return (
      <span aria-disabled="true" className={className}>
        {icon}
        {label}
      </span>
    );
  }

  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {icon}
      {label}
    </a>
  );
}

function actionsForJob(job: MobileJob): MobileJobActions {
  return {
    canAddWorkNote: !job.readOnlyOutlook,
    canAttachEvidence: !job.readOnlyOutlook,
    canCallContact: Boolean(job.contactPhone),
    canCaptureCustomerSignOff: !job.readOnlyOutlook,
    canChangeStatus: !job.readOnlyOutlook,
    canComplete: !job.readOnlyOutlook,
    canEmailContact: Boolean(job.contactEmail),
    canOpenMaps: Boolean(job.address && job.address !== "Remote"),
    canOpenOutlookEvent: Boolean(job.outlookWebLink),
    canReassign: !job.readOnlyOutlook,
    canStartTimer: !job.readOnlyOutlook,
    canTrackParts: !job.readOnlyOutlook,
  };
}

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+10:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(dateKey: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00+10:00`));
}

function formatDateTime(value?: string) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function coordinatesForAddress(address: string) {
  const normalized = address.trim().toLowerCase();
  return destinationCoordinates.find((candidate) =>
    normalized.includes(candidate.match),
  );
}

function calculateDistanceKm(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  const radiusKm = 6371;
  const latitudeDelta = degreesToRadians(destination.latitude - origin.latitude);
  const longitudeDelta = degreesToRadians(destination.longitude - origin.longitude);
  const originLatitude = degreesToRadians(origin.latitude);
  const destinationLatitude = degreesToRadians(destination.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
