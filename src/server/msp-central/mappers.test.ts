import { describe, expect, it } from "vitest";

import { getInitialStaffProfiles } from "@/server/staff/profiles";

import {
  mapMspCentralPriority,
  mapMspCentralRequest,
  mapMspCentralRequestNotifications,
  mapMspCentralRequestNotes,
  mapMspCentralRequestWorklogs,
  mapMspCentralRequests,
  mapMspCentralSentiment,
  mapMspCentralSlaState,
  mapMspCentralStatus,
  mapMspCentralTechnicians,
} from "./mappers";

describe("MSP Central request mappers", () => {
  const now = new Date("2026-07-09T09:00:00+10:00");
  const afterHours = new Date("2026-07-09T19:00:00+10:00");

  it("keeps customer-visible technician replies in the customer conversation", () => {
    const result = mapMspCentralRequestNotes([
      {
        created_by: { is_technician: true, name: "Simeon" },
        description: "The printer is back online.",
        id: "outbound-1",
        show_to_requester: true,
      },
      {
        created_by: { is_technician: true, name: "Simeon" },
        description: "Checked the switch port.",
        id: "internal-1",
        show_to_requester: false,
      },
    ]);

    expect(result.customerResponses).toEqual([
      expect.objectContaining({ id: "outbound-1" }),
    ]);
    expect(result.internalNotes).toEqual([
      expect.objectContaining({ id: "internal-1" }),
    ]);
  });

  it("maps fixture-style requests into Command Centre requests", () => {
    const request = mapMspCentralRequest(
      {
        account: { name: "Fixture Customer" },
        assets: [{ name: "Fixture printer" }],
        category: { name: "Hardware" },
        description: "Printer queue is stuck after driver update.",
        due_by_time: "2026-07-09T12:00:00+10:00",
        id: "msp-1",
        item: { name: "Printer" },
        priority: { name: "High" },
        request_number: "REQ-MSP-1",
        requester: { email: "person@example.invalid", name: "Pat" },
        site: {
          address: "Bairnsdale VIC 3875",
          area: "Bairnsdale",
          city: "Bairnsdale",
          name: "Main office",
        },
        status: { name: "Ready for Scheduling" },
        subcategory: { name: "Peripherals" },
        subject: "Fixture mapped request",
        technician: {
          email: "mattd@egit.com.au",
          id: "msp-tech-matt",
          name: "Matt",
        },
        udf_fields: { ready_to_book: true },
      },
      {
        now,
        requestWebBaseUrl: "https://helpdesk.example/requests/{request}",
      },
    );

    expect(request).toMatchObject({
      customer: "Fixture Customer",
      helpdeskUrl: "https://helpdesk.example/requests/REQ-MSP-1",
      mspCentralTechnicianEmail: "mattd@egit.com.au",
      mspCentralTechnicianId: "msp-tech-matt",
      mspCentralTechnicianName: "Matt",
      notes: "Printer queue is stuck after driver update.",
      priority: "High",
      readyToBook: true,
      requestNumber: "REQ-MSP-1",
      site: "Main office",
      slaState: "due-soon",
      sourceSystem: "msp-central-fixture",
      status: "Ready for Scheduling",
      technicianId: "tech-matt",
    });
    expect(request.assetNames).toEqual(["Fixture printer"]);
    expect(request).toMatchObject({
      category: "Hardware",
      item: "Printer",
      subcategory: "Peripherals",
    });
  });

  it("handles null and missing fields safely", () => {
    const request = mapMspCentralRequest(
      {
        assets: null,
        id: null,
        priority: null,
        requester: null,
        site: null,
        status: null,
        technician: null,
      },
      { now },
    );

    expect(request).toMatchObject({
      customer: "Unknown customer",
      priority: "Medium",
      requestNumber: "REQ-UNKNOWN",
      requester: "Unknown requester",
      site: "Unknown site",
      status: "Open",
      subject: "Untitled MSP Central request",
    });
    expect(request.warnings).toContain("Assets unavailable");
    expect(request.warnings).toContain(
      "No staff profile matched the MSP Central technician.",
    );
  });

  it("maps ServiceDesk timestamp objects and ignores malformed dates", () => {
    const dueTime = new Date("2026-07-10T12:00:00+10:00");
    const structured = mapMspCentralRequest(
      {
        created_time: {
          display_value: "Jul 9, 2026 9:00 AM",
          value: String(new Date("2026-07-09T09:00:00+10:00").getTime()),
        },
        due_by_time: {
          display_value: "Jul 10, 2026 12:00 PM",
          value: String(dueTime.getTime()),
        },
        request_number: "REQ-MSP-TIME",
        updated_time: {
          value: String(new Date("2026-07-09T10:00:00+10:00").getTime()),
        },
      },
      { now },
    );
    const malformed = mapMspCentralRequest(
      {
        created_time: { value: "not-a-date" },
        due_by_time: { display_value: "Unknown" },
        request_number: "REQ-MSP-BAD-TIME",
        scheduled_start_time: {
          value: "not-a-date",
        },
      },
      { now },
    );

    expect(structured).toMatchObject({
      ageHours: 0,
      dueAt: dueTime.toISOString(),
      updatedAt: new Date("2026-07-09T10:00:00+10:00").toISOString(),
    });
    expect(malformed).toMatchObject({
      dueAt: "",
      scheduledStart: undefined,
    });
  });

  it("does not invent a 1970 SLA due time when MSP Central sends zero or unknown values", () => {
    const zeroDue = mapMspCentralRequest(
      {
        due_by_time: {
          display_value: "",
          value: "0",
        },
        request_number: "REQ-MSP-ZERO-DUE",
      },
      { now },
    );
    const numericZeroDue = mapMspCentralRequest(
      {
        due_by_time: 0,
        request_number: "REQ-MSP-NUMERIC-ZERO-DUE",
      },
      { now },
    );

    expect(zeroDue.dueAt).toBe("");
    expect(zeroDue.slaState).toBe("normal");
    expect(numericZeroDue.dueAt).toBe("");
    expect(numericZeroDue.slaState).toBe("normal");
  });

  it("keeps the MSP Central identifier out of the request title", () => {
    const request = mapMspCentralRequest(
      {
        id: "6768000001414219",
        request_number: "6768000001414219",
        subject: "6768000001414219 Printer offline",
      },
      { now },
    );

    expect(request.requestNumber).toBe("6768000001414219");
    expect(request.subject).toBe("Printer offline");
  });

  it("uses the short Helpdesk request number instead of the long MSP Central object id", () => {
    const request = mapMspCentralRequest(
      {
        display_id: "22242",
        id: "6768000001482447",
        subject: "Allocated to you ANZ client onboarding",
      },
      {
        now,
        requestWebBaseUrl: "https://helpdesk.example/requests/{request}",
      },
    );

    expect(request.id).toBe("6768000001482447");
    expect(request.requestNumber).toBe("22242");
    expect(request.helpdeskUrl).toBe(
      "https://helpdesk.example/requests/6768000001482447",
    );
  });

  it("maps nested MSP customer details and cleans HTML descriptions", () => {
    const request = mapMspCentralRequest(
      {
        customer: { name: "Client Company" },
        description:
          "<p>Printer is offline.</p><p>Please call reception &amp; confirm access.</p>",
        id: "msp-detail-1",
        requester: {
          email_id: "requester@example.com",
          name: "Requesting User",
        },
      },
      { now },
    );

    expect(request).toMatchObject({
      contact: "requester@example.com",
      customer: "Client Company",
      notes: "Printer is offline.\nPlease call reception & confirm access.",
    });
  });

  it("uses MSP Central account address fields when no site address is present", () => {
    const request = mapMspCentralRequest(
      {
        account: {
          billing_city: "Bairnsdale",
          billing_code: "3875",
          billing_state: "VIC",
          billing_street: "12 Service Street",
          name: "Bairnsdale Tyre Service",
        },
        request_number: "REQ-MSP-ACCOUNT-ADDRESS",
        site: { name: "Unknown site" },
      },
      { now },
    );

    expect(request).toMatchObject({
      customer: "Bairnsdale Tyre Service",
      siteAddress: "12 Service Street, Bairnsdale VIC 3875",
      siteAddressSource: "msp-central",
      siteTown: "Bairnsdale",
    });
  });

  it("maps the MSP Central account id for exact CRM account address matching", () => {
    const request = mapMspCentralRequest(
      {
        account: {
          id: "crm-account-144",
          name: "Bairnsdale Tyre Service",
        },
        request_number: "REQ-MSP-CRM-ID",
      },
      { now },
    );

    expect(request.crmAccountId).toBe("crm-account-144");
  });

  it("does not auto-assign Advanced Works during office hours", () => {
    const request = mapMspCentralRequest(
      {
        account: { name: "Advanced Works" },
        request_number: "REQ-AW-DAYTIME",
        site: {
          city: "Bairnsdale",
          name: "Bairnsdale client site",
        },
        technician: null,
      },
      { now },
    );

    expect(request.technicianId).toBeUndefined();
    expect(request.warnings).not.toContain(
      "Auto-assigned by Advanced Works/Viridian IT site proximity.",
    );
  });

  it("maps priority, status, due, and scheduled classification", () => {
    expect(mapMspCentralPriority("urgent")).toBe("Critical");
    expect(mapMspCentralPriority("low")).toBe("Low");
    expect(mapMspCentralStatus("Scheduled", "2026-07-09T09:00:00+10:00")).toBe(
      "Scheduled",
    );
    expect(mapMspCentralStatus("closed")).toBe("Resolved");
    expect(mapMspCentralSlaState("violated", undefined, now)).toBe("overdue");
    expect(
      mapMspCentralSlaState(
        undefined,
        "2026-07-09T12:00:00+10:00",
        now,
      ),
    ).toBe("due-soon");
  });

  it("maps supported Zia sentiment values and hides unknown sentiment", () => {
    expect(mapMspCentralSentiment("Positive")).toBe("positive");
    expect(mapMspCentralSentiment("Neutral")).toBe("neutral");
    expect(mapMspCentralSentiment("Very negative")).toBe("negative");
    expect(mapMspCentralSentiment("Not calculated")).toBeUndefined();

    expect(
      mapMspCentralRequest(
        {
          request_number: "REQ-SENTIMENT",
          sentiment_analysis: { name: "Negative" },
        },
        { now },
      ).sentiment,
    ).toBe("negative");
  });

  it("preserves the MSP billable flag on Work Log readback", () => {
    expect(
      mapMspCentralRequestWorklogs([
        {
          description: "Billable test",
          id: "worklog-1",
          is_billable: true,
          time_spent: { hours: "0", minutes: "15" },
        },
        {
          description: "Non-billable test",
          id: "worklog-2",
          is_billable: false,
          time_spent: { hours: "0", minutes: "15" },
        },
      ]),
    ).toEqual([
      expect.objectContaining({ id: "worklog-1", isBillable: true }),
      expect.objectContaining({ id: "worklog-2", isBillable: false }),
    ]);
  });

  it("uses requester visibility to distinguish replies from internal notes", () => {
    const mapped = mapMspCentralRequestNotes([
      {
        created_by: { is_technician: true, name: "Riley" },
        description: "Technician response sent to the customer.",
        id: "reply-1",
        show_to_requester: true,
      },
      {
        created_by: { is_technician: true, name: "Riley" },
        description: "Private diagnostic note.",
        id: "note-1",
        show_to_requester: false,
      },
    ]);

    expect(mapped.customerResponses.map(({ id }) => id)).toEqual(["reply-1"]);
    expect(mapped.internalNotes.map(({ id }) => id)).toEqual(["note-1"]);
  });

  it("maps MSP email notifications into the customer conversation", () => {
    expect(
      mapMspCentralRequestNotifications([
        {
          description: "<p>Your printer is back online.</p>",
          id: "notification-1",
          sender: { email_id: "simeon@egit.com.au", name: "Simeon" },
          sent_time: { value: "1785801600000" },
          type: "reply",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        author: "Simeon",
        body: "Your printer is back online.",
        id: "notification-1",
      }),
    ]);
  });

  it("prefers MSP technician ID and warns on display-name-only matches", () => {
    const [profile] = getInitialStaffProfiles();
    const request = mapMspCentralRequest(
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-ID",
        technician: { email: "other@example.invalid", id: "msp-id", name: "Other" },
      },
      {
        now,
        profiles: [{ ...profile, mspCentralTechnicianId: "msp-id" }],
      },
    );

    expect(request.technicianId).toBe("tech-simeon");

    const displayNameOnly = mapMspCentralRequest(
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-NAME",
        technician: { name: "Riley" },
      },
      { now: afterHours },
    );

    expect(displayNameOnly.technicianId).toBe("tech-riley");
    expect(displayNameOnly.warnings).toContain(
      "Display name match requires manual review.",
    );
  });

  it("maps request and technician lists", () => {
    const requests = mapMspCentralRequests([
      {
        due_by_time: "2026-07-10T12:00:00+10:00",
        request_number: "REQ-MSP-LIST",
      },
    ]);
    const technicians = mapMspCentralTechnicians([
      { email: "jervy@egit.com.au", id: "msp-jervy", name: "Jervy" },
    ]);

    expect(requests).toHaveLength(1);
    expect(technicians).toEqual([
      expect.objectContaining({ displayName: "Jervy", id: "tech-jervy" }),
    ]);
  });

  it("preserves the canonical MSP Central technician identity", () => {
    const technicians = mapMspCentralTechnicians([
      {
        email_id: "riley@egit.com.au",
        id: "msp-technician-riley",
        name: "Riley Pearson",
      },
    ]);

    expect(technicians).toEqual([
      expect.objectContaining({
        displayName: "Riley",
        id: "tech-riley",
        mspCentralEmail: "riley@egit.com.au",
        mspCentralTechnicianId: "msp-technician-riley",
        mspCentralTechnicianName: "Riley Pearson",
        sdpTechnicianName: "Riley Pearson",
      }),
    ]);
  });

  it("does not treat a missing onsite flag as remote", () => {
    const unknown = mapMspCentralRequest({
      description: "Technician required at the customer office.",
      request_number: "REQ-ONSITE-UNKNOWN",
      subject: "Printer offline",
    });
    const remote = mapMspCentralRequest({
      description: "Please resolve remotely using Microsoft Teams.",
      request_number: "REQ-REMOTE-INFERRED",
      subject: "Mailbox support",
    });

    expect(unknown.onsite).toBeUndefined();
    expect(unknown.bookingType).toBe("Onsite");
    expect(remote.bookingType).toBe("Remote");
  });

  it("auto-assigns Advanced Works and Viridian IT requests by site proximity", () => {
    const bairnsdaleRequest = mapMspCentralRequest(
      {
        account: { name: "Advanced Works" },
        request_number: "REQ-AW-BAIRNSDALE",
        site: {
          address: "Bairnsdale VIC 3875",
          city: "Bairnsdale",
          name: "Bairnsdale client site",
        },
        technician: null,
      },
      { now: afterHours },
    );
    const saleRequest = mapMspCentralRequest(
      {
        account: { name: "Viridian IT" },
        request_number: "REQ-VIRIDIAN-SALE",
        site: {
          address: "Sale VIC 3850",
          city: "Sale",
          name: "Sale client site",
        },
        technician: null,
      },
      { now: afterHours },
    );

    expect(bairnsdaleRequest.technicianId).toBe("tech-jervy");
    expect(bairnsdaleRequest.warnings).toContain(
      "Auto-assigned by Advanced Works/Viridian IT site proximity.",
    );
    expect(saleRequest.technicianId).toBe("tech-matt");
    expect(saleRequest.warnings).toContain(
      "Auto-assigned by Advanced Works/Viridian IT site proximity.",
    );
  });

  it("does not override an explicitly assigned Advanced Works technician", () => {
    const request = mapMspCentralRequest(
      {
        account: { name: "Advanced Works" },
        request_number: "REQ-AW-ASSIGNED",
        site: {
          address: "Sale VIC 3850",
          city: "Sale",
          name: "Sale client site",
        },
        technician: {
          email: "jervy@egit.com.au",
          id: "msp-tech-jervy",
          name: "Jervy",
        },
      },
      { now: afterHours },
    );

    expect(request.technicianId).toBe("tech-jervy");
    expect(request.warnings).not.toContain(
      "Auto-assigned by Advanced Works/Viridian IT site proximity.",
    );
  });

  it("uses request subject and description when Advanced Works location is not in the site fields", () => {
    const subjectLocation = mapMspCentralRequest(
      {
        account: { name: "Advanced Works" },
        request_number: "REQ-AW-SUBJECT",
        subject: "Printer offline at Lakes Entrance office",
        technician: null,
      },
      { now: afterHours },
    );
    const descriptionLocation = mapMspCentralRequest(
      {
        account: { name: "Viridian IT" },
        description: "POS terminal needs onsite work in Sale showroom.",
        request_number: "REQ-VIRIDIAN-DESCRIPTION",
        subject: "POS issue",
        technician: null,
      },
      { now: afterHours },
    );

    expect(subjectLocation.technicianId).toBe("tech-jervy");
    expect(descriptionLocation.technicianId).toBe("tech-matt");
  });

  it("maps a known site town from request subject or description", () => {
    const fromSubject = mapMspCentralRequest({
      account: { name: "Coastal Retail" },
      request_number: "REQ-SITE-SUBJECT",
      subject: "Printer offline at Lakes Entrance office",
    });
    const fromDescription = mapMspCentralRequest({
      account: { name: "Regional Client" },
      description: "Please attend the Sale showroom to replace the router.",
      request_number: "REQ-SITE-DESCRIPTION",
      subject: "Router replacement",
    });

    expect(fromSubject).toMatchObject({
      site: "Lakes Entrance",
      siteName: "Lakes Entrance",
      siteTown: "Lakes Entrance",
    });
    expect(fromDescription).toMatchObject({
      site: "Sale",
      siteName: "Sale",
      siteTown: "Sale",
    });
  });
});
