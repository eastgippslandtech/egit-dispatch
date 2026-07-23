import { buildDispatchHealthItems } from "./health";
import {
  getInitialStaffProfiles,
  staffProfileToTechnician,
} from "@/server/staff/profiles";
import type {
  Appointment,
  DispatchDesignMockData,
  DispatchRequest,
  SlaState,
  Technician,
} from "./types";

export type {
  Appointment,
  DispatchAppointment,
  DispatchDesignMockData,
  DispatchLink,
  DispatchRequest,
  HealthItem,
  Severity,
  SlaState,
  Technician,
} from "./types";

const technicians: Technician[] = getInitialStaffProfiles()
  .map(staffProfileToTechnician)
  .sort((first, second) => {
    const order = ["Matt", "Jervy", "Riley", "Simeon"];
    return order.indexOf(first.displayName) - order.indexOf(second.displayName);
  });

const unscheduledSeeds = [
  ["100284", "Packhouse label printer offline", "OneHarvest", "Bairnsdale packing floor", "Mel Harris", "Critical", "overdue", "SLA overdue"],
  ["100301", "Finance workstation replacement", "Internal EGIT", "Bairnsdale office", "Priya Stone", "Medium", "due-soon", "Unassigned"],
  ["100317", "POS terminal intermittent dropouts", "Decor Floors", "Sale showroom", "Tom Nguyen", "High", "due-soon", "Missing schedule"],
  ["100322", "Microsoft 365 shared mailbox access", "East Gippsland Homes", "Sales office", "Alice Dean", "Low", "normal", "Remote possible"],
  ["100329", "Treatment room Wi-Fi coverage check", "Sale Family Dentist", "Main clinic", "Sarah Mills", "Medium", "normal", "Onsite required"],
  ["100337", "Backup check failed on reception server", "Lakeside Motel", "Reception", "Dan Cole", "High", "due-soon", "SLA risk"],
  ["100349", "Printer replacement and driver cleanup", "Decor Floors", "Warehouse office", "Leah Boyd", "Low", "normal", "Billable"],
  ["100356", "NBN failover test for front desk router", "Lakeside Motel", "Reception", "Grant Naylor", "Medium", "normal", "Travel required"],
  ["100361", "Reception PC slow after software update", "Sale Family Dentist", "Reception", "Emma Kline", "Medium", "normal", "Remote first"],
  ["100368", "Camera NVR disk health alert", "East Gippsland Homes", "Depot", "Mick Evans", "High", "overdue", "Hardware likely"],
  ["100372", "Boardroom Teams audio not detected", "OneHarvest", "Meeting room", "Nina Miles", "Medium", "normal", "VIP room"],
  ["100380", "Warehouse scanner cradle replacement", "Decor Floors", "Warehouse", "Owen Clarke", "Low", "normal", "Parts ready"],
  ["100389", "Kiosk login loop after update", "Lakeside Motel", "Guest kiosk", "Kara Frost", "High", "due-soon", "Public device"],
  ["100394", "Switch port patching for new counter", "East Gippsland Homes", "Front counter", "Marta Bell", "Medium", "normal", "Onsite required"],
  ["100402", "Password reset assistance for payroll", "Internal EGIT", "Remote", "Harvey Ross", "Low", "normal", "Not ready"],
] as const;

const unscheduledDueDates = [
  "2026-07-06",
  "2026-07-07",
  "2026-07-08",
  "2026-07-09",
  "2026-07-10",
  "2026-07-11",
  "2026-07-12",
] as const;

const siteMetadata = [
  ["OneHarvest packing floor", "Bairnsdale", "Bairnsdale VIC 3875", true],
  ["EGIT Bairnsdale office", "Bairnsdale", "137 Main Street, Bairnsdale VIC 3875", true],
  ["Decor Floors Sale showroom", "Sale", "Sale VIC 3850", true],
  ["Remote", "Remote", "Remote", false],
  ["Sale Family Dentist clinic", "Sale", "Sale VIC 3850", true],
  ["Lakeside Motel reception", "Lakes Entrance", "Lakes Entrance VIC 3909", true],
  ["Decor Floors warehouse", "Sale", "Sale VIC 3850", true],
  ["Lakeside Motel reception", "Lakes Entrance", "Lakes Entrance VIC 3909", true],
  ["Sale Family Dentist reception", "Sale", "Sale VIC 3850", true],
  ["East Gippsland Homes depot", "Unknown", "", true],
  ["OneHarvest meeting room", "Bairnsdale", "Bairnsdale VIC 3875", true],
  ["Decor Floors warehouse", "Sale", "Sale VIC 3850", true],
  ["Lakeside Motel kiosk", "Lakes Entrance", "Lakes Entrance VIC 3909", true],
  ["East Gippsland Homes front counter", "Bairnsdale", "Bairnsdale VIC 3875", true],
  ["Remote payroll", "Remote", "Remote", false],
] as const;

const requests: DispatchRequest[] = [
  ...unscheduledSeeds.map((seed, index) => ({
    id: seed[0],
    requestNumber: `REQ-${seed[0]}`,
    subject: seed[1],
    customer: seed[2],
    site: seed[3],
    siteName: siteMetadata[index][0],
    siteTown: siteMetadata[index][1],
    siteArea: siteMetadata[index][1],
    siteAddress: siteMetadata[index][2],
    onsite: siteMetadata[index][3],
    requester: seed[4],
    contact: `03 515${index} ${String(1000 + index * 137).slice(0, 4)}`,
    priority: seed[5] as DispatchRequest["priority"],
    status: (index % 3 === 0
      ? "Ready for Scheduling"
      : "Open") as DispatchRequest["status"],
    technicianId: index === 2 ? "tech-jervy" : undefined,
    dueAt: `${unscheduledDueDates[index % unscheduledDueDates.length]}T${String(10 + (index % 8)).padStart(2, "0")}:30:00+10:00`,
    ageHours: 2 + index * 3,
    billable: index % 4 !== 3,
    readyToBook: index !== 14,
    slaState: seed[6] as SlaState,
    updateInfo:
      index === 2
        ? {
            at: "2026-07-08T10:45:00+10:00",
            detail: "Customer confirmed the POS dropouts are still happening.",
            source: "msp-central" as const,
            summary: "Notes added",
          }
        : undefined,
    warnings: [seed[7], index % 2 === 0 ? "Ready to book" : "Needs review"],
  })),
  {
    id: "100211",
    requestNumber: "REQ-100211",
    subject: "File server disk expansion",
    customer: "OneHarvest",
    site: "Server room",
    siteName: "OneHarvest server room",
    siteAddress: "Bairnsdale VIC 3875",
    siteTown: "Bairnsdale",
    siteArea: "Bairnsdale",
    onsite: true,
    requester: "Alice Dean",
    contact: "03 5152 4820",
    priority: "High",
    status: "Scheduled",
    technicianId: "tech-matt",
    scheduledStart: "2026-07-08T09:30:00+10:00",
    scheduledEnd: "2026-07-08T10:45:00+10:00",
    dueAt: "2026-07-08T17:30:00+10:00",
    ageHours: 31,
    billable: true,
    readyToBook: false,
    slaState: "normal",
    updateInfo: {
      at: "2026-07-08T09:05:00+10:00",
      detail: "Technician added a Work Log from the mobile app.",
      source: "technician-app",
      summary: "Work Log added",
    },
    warnings: ["Outlook linked"],
  },
  {
    id: "100246",
    requestNumber: "REQ-100246",
    subject: "Practice management update",
    customer: "Sale Family Dentist",
    site: "Consult rooms",
    siteName: "Sale Family Dentist consult rooms",
    siteAddress: "Sale VIC 3850",
    siteTown: "Sale",
    siteArea: "Sale",
    onsite: true,
    requester: "Sarah Mills",
    contact: "03 5156 8899",
    priority: "Medium",
    status: "Scheduled",
    technicianId: "tech-jervy",
    scheduledStart: "2026-07-08T10:00:00+10:00",
    scheduledEnd: "2026-07-08T12:00:00+10:00",
    dueAt: "2026-07-08T11:00:00+10:00",
    ageHours: 24,
    billable: true,
    readyToBook: false,
    slaState: "normal",
    warnings: ["Double-booked"],
  },
  {
    id: "100252",
    requestNumber: "REQ-100252",
    subject: "After-hours firewall firmware window",
    customer: "Decor Floors",
    site: "Warehouse office",
    siteName: "Decor Floors warehouse office",
    siteAddress: "Sale VIC 3850",
    siteTown: "Sale",
    siteArea: "Sale",
    onsite: true,
    requester: "Dan Cole",
    contact: "03 5156 1021",
    priority: "Medium",
    status: "Scheduled",
    technicianId: "tech-riley",
    scheduledStart: "2026-07-09T17:45:00+10:00",
    scheduledEnd: "2026-07-09T19:00:00+10:00",
    dueAt: "2026-07-09T17:00:00+10:00",
    ageHours: 17,
    billable: true,
    readyToBook: false,
    slaState: "normal",
    warnings: ["Out of hours"],
  },
  {
    id: "100263",
    requestNumber: "REQ-100263",
    subject: "Network cabinet tidy and patch audit",
    customer: "East Gippsland Homes",
    site: "Comms room",
    siteName: "East Gippsland Homes comms room",
    siteAddress: "",
    siteTown: "Unknown",
    siteArea: "Unknown",
    onsite: true,
    requester: "Priya Stone",
    contact: "03 5154 1180",
    priority: "Medium",
    status: "Scheduled",
    technicianId: "tech-simeon",
    scheduledStart: "2026-07-10T13:00:00+10:00",
    scheduledEnd: "2026-07-10T15:30:00+10:00",
    dueAt: "2026-07-10T17:00:00+10:00",
    ageHours: 29,
    billable: true,
    readyToBook: false,
    slaState: "normal",
    warnings: ["Missing technician mapping"],
  },
  {
    id: "100198",
    requestNumber: "REQ-100198",
    subject: "Old scheduled onsite still open",
    customer: "Lakeside Motel",
    site: "Back office",
    siteName: "Lakeside Motel back office",
    siteAddress: "Lakes Entrance VIC 3909",
    siteTown: "Lakes Entrance",
    siteArea: "Lakes Entrance",
    onsite: true,
    requester: "Tom Nguyen",
    contact: "03 5155 2271",
    priority: "High",
    status: "Open",
    technicianId: "tech-matt",
    scheduledStart: "2026-07-07T08:00:00+10:00",
    scheduledEnd: "2026-07-07T08:45:00+10:00",
    dueAt: "2026-07-07T09:00:00+10:00",
    ageHours: 44,
    billable: true,
    readyToBook: false,
    slaState: "overdue",
    warnings: ["Past scheduled open job"],
  },
  {
    id: "100405",
    requestNumber: "REQ-100405",
    subject: "Scheduled job missing calendar",
    customer: "Internal EGIT",
    site: "Bairnsdale office",
    siteName: "EGIT Bairnsdale office",
    siteAddress: "137 Main Street, Bairnsdale VIC 3875",
    siteTown: "Bairnsdale",
    siteArea: "Bairnsdale",
    onsite: true,
    requester: "Priya Stone",
    contact: "03 5152 4450",
    priority: "High",
    status: "Scheduled",
    technicianId: "tech-simeon",
    scheduledStart: "2026-07-11T15:30:00+10:00",
    scheduledEnd: "2026-07-11T16:30:00+10:00",
    dueAt: "2026-07-11T16:30:00+10:00",
    ageHours: 12,
    billable: false,
    readyToBook: false,
    slaState: "due-soon",
    warnings: ["Missing calendar event"],
  },
];

const appointments: Appointment[] = [
  { id: "appt-1", date: "2026-07-08", requestId: "100211", technicianId: "tech-matt", title: "File server disk expansion", customer: "OneHarvest", siteAddress: "Bairnsdale VIC 3875", siteTown: "Bairnsdale", officeOriginId: "sale", officeOriginName: "Sale", officeOriginAddress: "387 Raymond Street, Sale VIC 3850", travelToSiteMinutes: 70, travelBackToOfficeMinutes: 70, travelEstimated: false, start: "09:30", end: "10:45", status: "confirmed", source: "linked" },
  { id: "appt-2", date: "2026-07-07", requestId: "100198", technicianId: "tech-matt", title: "Past scheduled open job", customer: "Lakeside Motel", siteAddress: "Lakes Entrance VIC 3909", siteTown: "Lakes Entrance", officeOriginId: "sale", officeOriginName: "Sale", officeOriginAddress: "387 Raymond Street, Sale VIC 3850", travelToSiteMinutes: 15, travelBackToOfficeMinutes: 15, travelEstimated: true, travelWarning: "estimated travel", start: "09:00", end: "09:20", status: "busy", source: "linked", syncIssue: "past-open" },
  { id: "appt-3", date: "2026-07-08", requestId: "100246", technicianId: "tech-jervy", title: "Practice management update", customer: "Sale Family Dentist", siteAddress: "Sale VIC 3850", siteTown: "Sale", officeOriginId: "bairnsdale", officeOriginName: "Bairnsdale", officeOriginAddress: "137 Main Street, Bairnsdale VIC 3875", travelToSiteMinutes: 70, travelBackToOfficeMinutes: 70, travelEstimated: false, start: "10:00", end: "12:00", status: "confirmed", source: "linked", syncIssue: "double-booked" },
  { id: "appt-4", date: "2026-07-08", technicianId: "tech-jervy", title: "Outlook busy: supplier call", customer: "Internal EGIT", start: "11:15", end: "12:30", status: "busy", source: "outlook", syncIssue: "double-booked" },
  { id: "appt-5", date: "2026-07-09", requestId: "100252", technicianId: "tech-riley", title: "Firewall firmware window", customer: "Decor Floors", siteAddress: "Sale VIC 3850", siteTown: "Sale", officeOriginId: "bairnsdale", officeOriginName: "Bairnsdale", officeOriginAddress: "137 Main Street, Bairnsdale VIC 3875", travelToSiteMinutes: 70, travelBackToOfficeMinutes: 70, travelEstimated: false, start: "17:45", end: "19:00", status: "tentative", source: "linked" },
  { id: "appt-6", date: "2026-07-09", technicianId: "tech-riley", title: "Outlook calendar block", customer: "Internal EGIT", start: "13:30", end: "14:30", status: "busy", source: "outlook" },
  { id: "appt-7", date: "2026-07-10", requestId: "100263", technicianId: "tech-simeon", title: "Network cabinet tidy", customer: "East Gippsland Homes", siteAddress: "", siteTown: "Unknown", officeOriginId: "bairnsdale", officeOriginName: "Bairnsdale", officeOriginAddress: "137 Main Street, Bairnsdale VIC 3875", travelToSiteMinutes: 15, travelBackToOfficeMinutes: 15, travelEstimated: true, travelWarning: "missing site address", start: "13:00", end: "15:30", status: "confirmed", source: "linked", syncIssue: "time-mismatch" },
  { id: "appt-8", date: "2026-07-11", requestId: "100405", technicianId: "tech-simeon", title: "Scheduled job missing calendar", customer: "Internal EGIT", siteAddress: "137 Main Street, Bairnsdale VIC 3875", siteTown: "Bairnsdale", officeOriginId: "bairnsdale", officeOriginName: "Bairnsdale", officeOriginAddress: "137 Main Street, Bairnsdale VIC 3875", travelToSiteMinutes: 10, travelBackToOfficeMinutes: 10, travelEstimated: false, start: "15:30", end: "16:30", status: "sdp-only", source: "sdp", syncIssue: "missing-calendar" },
  { id: "appt-9", date: "2026-07-06", technicianId: "tech-matt", title: "Monday Outlook hold", customer: "Internal EGIT", start: "14:00", end: "15:00", status: "busy", source: "outlook" },
  { id: "appt-10", date: "2026-07-12", technicianId: "tech-jervy", title: "Sunday client travel prep", customer: "Decor Floors", start: "10:30", end: "11:30", status: "tentative", source: "outlook" },
];

export function getEmptyCommandCentreData(): DispatchDesignMockData {
  const data: DispatchDesignMockData = {
    selectedDateLabel: "Today",
    timezone: "Australia/Melbourne",
    technicians,
    requests: [],
    appointments: [],
    healthItems: [],
    selectedRequestId: "",
  };

  return {
    ...data,
    healthItems: buildDispatchHealthItems(data),
  };
}

export function getDispatchDesignMockData(): DispatchDesignMockData {
  const contextAppointments = appointments.map((appointment) =>
    appointment.travelToSiteMinutes !== undefined ||
    appointment.travelBackToOfficeMinutes !== undefined
      ? {
          ...appointment,
          travelMode: appointment.travelMode ?? "office_to_site_and_back",
          travelCalculatedFrom:
            appointment.travelCalculatedFrom ?? "technician_base_office",
          travelCalculationReason:
            appointment.travelCalculationReason ??
            "Estimated from technician base office",
        }
      : appointment,
  );

  return {
    selectedDateLabel: "Tuesday 7 July 2026",
    timezone: "Australia/Melbourne",
    technicians,
    requests,
    appointments: contextAppointments,
    healthItems: buildDispatchHealthItems({
      technicians,
      requests,
      appointments: contextAppointments,
    }),
    selectedRequestId: "100284",
  };
}
