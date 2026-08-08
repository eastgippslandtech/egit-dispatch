import { describe, expect, it } from "vitest";

import {
  buildActiveCustomerStaging,
  normalizeCompanyName,
  splitPersonName,
} from "./sdp-active-customer-staging.mjs";

describe("normalizeCompanyName", () => {
  it("normalizes spacing, case, and harmless punctuation differences", () => {
    expect(
      normalizeCompanyName(" Elite Print Solutions P/L "),
    ).toBe(normalizeCompanyName("elite print solutions p l"));
  });
});

describe("splitPersonName", () => {
  it("keeps single-word requester names usable", () => {
    expect(splitPersonName("Sales")).toEqual({
      firstName: "Sales",
      lastName: "",
    });
  });

  it("splits normal full names", () => {
    expect(splitPersonName("Ryan Kilpatrick")).toEqual({
      firstName: "Ryan",
      lastName: "Kilpatrick",
    });
  });
});

describe("buildActiveCustomerStaging", () => {
  const companies = [
    {
      "Company Name": "Cold Az Refrigeration & Airconditioning",
      "Company ID": "COLDAZ",
      "Phone Number": "5152 0000",
      Type: "2. Unmanaged Client",
      Status: "Active",
      Site: "Main",
      "Address Line 1": "1 Test Street",
      Suburb: "Sale",
    },
    {
      "Company Name": "Old No Ticket",
      "Company ID": "OLD",
      "Phone Number": "5152 1111",
      Type: "2. Unmanaged Client",
      Status: "Active",
      Site: "Main",
      "Address Line 1": "2 Old Street",
      Suburb: "Maffra",
    },
  ];

  const contacts = [
    {
      "First Name": "Aaron",
      "Last Name": "Ceveri",
      Company: "Cold Az Refrigeration & Airconditioning",
      Email: "aaron@example.test",
      "Phone Number": "0400 000 000",
      Status: "Active",
      Site: "Main",
      "Address Line 1": "1 Test Street",
      Suburb: "Sale",
      State: "VIC",
    },
    {
      "First Name": "Pat",
      "Last Name": "Unused",
      Company: "Old No Ticket",
      Email: "pat@example.test",
      Status: "Active",
      Site: "Main",
    },
  ];

  it("includes only customers from eligible ticket activity", () => {
    const result = buildActiveCustomerStaging({
      companies,
      contacts,
      eligibleTickets: [
        {
          Company: "Cold Az Refrigeration & Airconditioning",
          Requester: "Aaron Ceveri",
          RequesterEmail: "aaron@example.test",
          Source: "open",
          TicketNumber: "238100",
        },
      ],
    });

    expect(result.customers.map((row) => row.customerName)).toEqual([
      "Cold Az Refrigeration & Airconditioning",
    ]);
    expect(result.requesters).toHaveLength(1);
    expect(result.requesters[0].customerName).toBe(
      "Cold Az Refrigeration & Airconditioning",
    );
  });

  it("ignores inactive contacts and placeholder customers", () => {
    const result = buildActiveCustomerStaging({
      companies: [
        ...companies,
        {
          "Company Name": "*CHANGE ME*",
          Type: "90. DO NOT USE",
          Status: "Active",
        },
      ],
      contacts: [
        ...contacts,
        {
          "First Name": "Old",
          "Last Name": "Contact",
          Company: "Cold Az Refrigeration & Airconditioning",
          Email: "old@example.test",
          Status: "Inactive",
        },
      ],
      eligibleTickets: [
        {
          Company: "Cold Az Refrigeration & Airconditioning",
          Source: "open",
          TicketNumber: "238100",
        },
        {
          Company: "*CHANGE ME*",
          Source: "open",
          TicketNumber: "238101",
        },
      ],
    });

    expect(result.customers.map((row) => row.customerName)).toEqual([
      "Cold Az Refrigeration & Airconditioning",
    ]);
    expect(
      result.requesters.some((row) => row.email === "old@example.test"),
    ).toBe(false);
  });

  it("creates a real residential customer record when a person has an eligible ticket", () => {
    const result = buildActiveCustomerStaging({
      companies: [
        {
          "Company Name": "Pamela Inch",
          "Company ID": "Pamela Inch",
          Type: "4. Residential Customer",
          Status: "Active",
          Site: "Main",
          "Address Line 1": "3 Home Road",
          Suburb: "Bairnsdale",
        },
      ],
      contacts: [],
      eligibleTickets: [
        {
          Company: "Pamela Inch",
          Requester: "Pamela Inch",
          RequesterEmail: "pamela@example.test",
          Source: "open",
          TicketNumber: "238101",
        },
      ],
    });

    expect(result.customers[0].customerType).toBe("Residential");
    expect(result.customers[0].customerName).toBe("Pamela Inch");
  });
});
