import type { BookingType, DispatchRequest } from "./types";

type TrainingTechnician = {
  code: string;
  id: string;
  name: string;
  onsiteAddress: string;
  onsiteArea: string;
  onsiteSite: string;
  onsiteTown: string;
};

const TRAINING_TECHNICIANS: TrainingTechnician[] = [
  {
    code: "SIM",
    id: "tech-simeon",
    name: "Simeon",
    onsiteAddress: "Lucknow VIC 3875",
    onsiteArea: "Bairnsdale",
    onsiteSite: "Training site - Lucknow",
    onsiteTown: "Lucknow",
  },
  {
    code: "MAT",
    id: "tech-matt",
    name: "Matt",
    onsiteAddress: "Longford VIC 3851",
    onsiteArea: "Sale",
    onsiteSite: "Training site - Longford",
    onsiteTown: "Longford",
  },
  {
    code: "JER",
    id: "tech-jervy",
    name: "Jervy",
    onsiteAddress: "Lucknow VIC 3875",
    onsiteArea: "Bairnsdale",
    onsiteSite: "Training site - Lucknow",
    onsiteTown: "Lucknow",
  },
  {
    code: "RIL",
    id: "tech-riley",
    name: "Riley",
    onsiteAddress: "Lucknow VIC 3875",
    onsiteArea: "Bairnsdale",
    onsiteSite: "Training site - Lucknow",
    onsiteTown: "Lucknow",
  },
];

export function getCommandCentreTrainingRequests(
  dateKey: string,
): DispatchRequest[] {
  return TRAINING_TECHNICIANS.flatMap((technician) => [
    buildTrainingRequest(technician, "Remote", dateKey),
    buildTrainingRequest(technician, "Onsite", dateKey),
  ]);
}

function buildTrainingRequest(
  technician: TrainingTechnician,
  bookingType: Extract<BookingType, "Remote" | "Onsite">,
  dateKey: string,
): DispatchRequest {
  const remote = bookingType === "Remote";
  const typeKey = bookingType.toLowerCase();

  return {
    ageHours: 0,
    billable: false,
    bookingType,
    contact: "Command Centre training",
    customer: "EGIT Training",
    dueAt: `${dateKey}T17:00:00+10:00`,
    id: `training-${technician.code.toLowerCase()}-${typeKey}`,
    mockTravelMinutes: remote ? 0 : 15,
    notes: remote
      ? "Training example for scheduling, rescheduling, Work Log entry, and completion without travel."
      : "Training example for scheduling an onsite visit with a 15-minute travel buffer each way.",
    onsite: !remote,
    priority: "Medium",
    readyToBook: true,
    requester: "EGIT Training",
    requestNumber: `TRAIN-${technician.code}-${remote ? "REMOTE" : "ONSITE"}`,
    site: remote ? "Remote / Virtual" : technician.onsiteSite,
    siteAddress: remote ? "Remote" : technician.onsiteAddress,
    siteArea: remote ? "Remote" : technician.onsiteArea,
    siteName: remote ? "Remote training session" : technician.onsiteSite,
    siteTown: remote ? "Remote" : technician.onsiteTown,
    slaState: "normal",
    sourceSystem: "mock",
    status: "Ready for Scheduling",
    subject: `${technician.name} training: ${typeKey} support example`,
    technicianId: technician.id,
    warnings: [
      "Training sample",
      remote ? "No travel" : "15 min travel each way",
      "Ready to book",
    ],
  };
}
