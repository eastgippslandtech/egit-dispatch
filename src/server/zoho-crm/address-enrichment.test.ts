import { describe, expect, it } from "vitest";

import type { DispatchRequest } from "@/server/dispatch/types";
import {
  enrichRequestsWithZohoCrmAddresses,
  type ZohoCrmAccountRecord,
} from "./address-enrichment";

function request(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    ageHours: 1,
    billable: false,
    contact: "support@acme.example",
    customer: "Acme Health",
    dueAt: "2026-08-04T07:00:00.000Z",
    id: "request-1",
    priority: "Medium",
    readyToBook: true,
    requester: "Alex",
    requestNumber: "REQ-1",
    site: "Unknown site",
    slaState: "normal",
    status: "Open",
    subject: "Printer offline",
    warnings: [],
    ...overrides,
  };
}

function account(overrides: Partial<ZohoCrmAccountRecord> = {}): ZohoCrmAccountRecord {
  return {
    Account_Name: "Acme Health",
    Billing_City: "Bairnsdale",
    Billing_Code: "3875",
    Billing_State: "VIC",
    Billing_Street: "9 Billing Road",
    Shipping_City: "Sale",
    Shipping_Code: "3850",
    Shipping_State: "VIC",
    Shipping_Street: "42 Raymond Street",
    id: "crm-account-1",
    ...overrides,
  };
}

describe("Zoho CRM site address enrichment", () => {
  it("uses the shipping address for an exact unique account match", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request()],
      [account()],
    );

    expect(enriched).toMatchObject({
      crmAccountId: "crm-account-1",
      site: "42 Raymond Street, Sale VIC 3850",
      siteAddress: "42 Raymond Street, Sale VIC 3850",
      siteAddressSource: "zoho-crm",
      siteTown: "Sale",
    });
  });

  it("uses a unique high-confidence CRM account match after legal suffix cleanup", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request({ customer: "Bairnsdale Tyre Service" })],
      [
        account({
          Account_Name: "Bairnsdale Tyre Service Pty Ltd",
          Shipping_City: "Bairnsdale",
          Shipping_Code: "3875",
          Shipping_State: "VIC",
          Shipping_Street: "18 Bosworth Road",
          id: "crm-bairnsdale-tyre",
        }),
      ],
    );

    expect(enriched).toMatchObject({
      crmAccountId: "crm-bairnsdale-tyre",
      siteAddress: "18 Bosworth Road, Bairnsdale VIC 3875",
      siteAddressSource: "zoho-crm",
      siteTown: "Bairnsdale",
    });
  });

  it("uses the exact CRM account id before falling back to customer name matching", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [
        request({
          crmAccountId: "crm-bairnsdale-tyre",
          customer: "Short trading name",
        }),
      ],
      [
        account({
          Account_Name: "Different Customer",
          id: "crm-different-customer",
        }),
        account({
          Account_Name: "Bairnsdale Tyre Service Pty Ltd",
          Shipping_City: "Bairnsdale",
          Shipping_Code: "3875",
          Shipping_State: "VIC",
          Shipping_Street: "18 Bosworth Road",
          id: "crm-bairnsdale-tyre",
        }),
      ],
    );

    expect(enriched).toMatchObject({
      crmAccountId: "crm-bairnsdale-tyre",
      siteAddress: "18 Bosworth Road, Bairnsdale VIC 3875",
      siteAddressSource: "zoho-crm",
      siteTown: "Bairnsdale",
    });
  });

  it("clears stale missing-address warnings after a CRM address is found", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [
        request({
          warnings: [
            "Missing site address",
            "No usable Helpdesk or Zoho CRM site address was found.",
            "Assets unavailable",
          ],
        }),
      ],
      [account()],
    );

    expect(enriched.siteAddressSource).toBe("zoho-crm");
    expect(enriched.warnings).toEqual(["Assets unavailable"]);
  });

  it("falls back to the billing address when shipping is incomplete", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request()],
      [account({ Shipping_Street: undefined })],
    );

    expect(enriched.siteAddress).toBe("9 Billing Road, Bairnsdale VIC 3875");
    expect(enriched.siteTown).toBe("Bairnsdale");
  });

  it("preserves a usable Helpdesk address", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request({ site: "7 Main Street", siteAddress: "7 Main Street, Lakes Entrance VIC 3909" })],
      [account()],
    );

    expect(enriched.siteAddress).toBe("7 Main Street, Lakes Entrance VIC 3909");
    expect(enriched.siteAddressSource).toBe("msp-central");
  });

  it("does not replace a remote location with a CRM street address", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request({ bookingType: "Remote", onsite: false, site: "Remote / Virtual", siteAddress: "Remote / Virtual" })],
      [account()],
    );

    expect(enriched.siteAddress).toBe("Remote / Virtual");
    expect(enriched.siteAddressSource).toBe("msp-central");
  });

  it("does not mistake an onsite remote-access issue for a remote booking", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [
        request({
          bookingType: "Onsite",
          onsite: true,
          subject: "Remote access is not working at reception",
        }),
      ],
      [account()],
    );

    expect(enriched.siteAddress).toBe("42 Raymond Street, Sale VIC 3850");
    expect(enriched.siteAddressSource).toBe("zoho-crm");
  });

  it("leaves duplicate exact account matches unresolved", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request()],
      [account(), account({ id: "crm-account-2" })],
    );

    expect(enriched.siteAddress).toBeUndefined();
    expect(enriched.siteAddressSource).toBe("unknown");
    expect(enriched.warnings).toContain(
      "Multiple Zoho CRM accounts match this customer; site address needs review.",
    );
  });

  it("does not use a similar name as an automatic match", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [request({ customer: "Acme Health East" })],
      [account()],
    );

    expect(enriched.siteAddress).toBeUndefined();
    expect(enriched.crmAccountId).toBeUndefined();
  });

  it("keeps a town-level Helpdesk location when CRM has no exact match", () => {
    const [enriched] = enrichRequestsWithZohoCrmAddresses(
      [
        request({
          customer: "Different Customer",
          site: "Bairnsdale",
          siteAddress: "Bairnsdale VIC 3875",
          siteTown: "Bairnsdale",
        }),
      ],
      [account()],
    );

    expect(enriched.siteAddress).toBe("Bairnsdale VIC 3875");
    expect(enriched.siteAddressSource).toBe("unknown");
  });
});
