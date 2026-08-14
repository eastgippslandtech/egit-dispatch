import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCommandCentreAccess } from "@/server/auth/session";
import { createMspCentralClient } from "@/server/msp-central/client";

import { GET, POST } from "./route";

vi.mock("@/server/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/session")>()),
  getCommandCentreAccess: vi.fn(),
}));

vi.mock("@/server/msp-central/client", () => ({
  createMspCentralClient: vi.fn(),
}));

const getAccessMock = vi.mocked(getCommandCentreAccess);
const createClientMock = vi.mocked(createMspCentralClient);
const listCustomers = vi.fn();
const listContacts = vi.fn();
const listRequestFormOptions = vi.fn();
const createCustomer = vi.fn();

describe("MSP Central lookup route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccessMock.mockResolvedValue({
      accessLevel: "staff",
      email: "simeon@egit.com.au",
      name: "Simeon",
      status: "approved",
    });
    createClientMock.mockReturnValue({
      createCustomer,
      listContacts,
      listCustomers,
      listRequestFormOptions,
    } as never);
  });

  it("returns customer lookup results", async () => {
    listCustomers.mockResolvedValueOnce([
      {
        address: "1 Rovan Place, Bairnsdale VIC 3875",
        id: "customer-1",
        name: "Bairnsdale Bearings",
      },
    ]);

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/lookups?type=customers&q=bairnsdale",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      customers: [
        {
          address: "1 Rovan Place, Bairnsdale VIC 3875",
          id: "customer-1",
          name: "Bairnsdale Bearings",
        },
      ],
    });
    expect(listCustomers).toHaveBeenCalledWith("bairnsdale");
  });

  it("returns contacts for a selected customer", async () => {
    listContacts.mockResolvedValueOnce([
      {
        email: "contact@example.com",
        id: "contact-1",
        name: "Mireille",
      },
    ]);

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/lookups?type=contacts&customerId=customer-1&q=mir",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      contacts: [
        {
          email: "contact@example.com",
          id: "contact-1",
          name: "Mireille",
        },
      ],
    });
    expect(listContacts).toHaveBeenCalledWith({
      customerId: "customer-1",
      query: "mir",
    });
  });

  it("blocks wallboard-only sessions", async () => {
    getAccessMock.mockResolvedValueOnce({
      name: "Command Centre Wallboard",
      status: "wallboard-only",
    });

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/lookups?type=customers",
      ),
    );

    expect(response.status).toBe(403);
    expect(listCustomers).not.toHaveBeenCalled();
  });

  it("returns request form options", async () => {
    listRequestFormOptions.mockResolvedValueOnce({
      categories: ["Hardware"],
      impacts: ["Affects User"],
      priorities: ["Low", "Medium", "High", "Critical"],
      requestTypes: ["Incident"],
      subcategories: ["Printer"],
      urgencies: ["Normal", "High"],
    });

    const response = await GET(
      new Request(
        "https://command.egit.com.au/api/internal/msp-central/lookups?type=request-options",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      options: {
        categories: ["Hardware"],
        impacts: ["Affects User"],
        priorities: ["Low", "Medium", "High", "Critical"],
        requestTypes: ["Incident"],
        subcategories: ["Printer"],
        urgencies: ["Normal", "High"],
      },
    });
  });

  it("creates a customer for request creation lookup", async () => {
    createCustomer.mockResolvedValueOnce({
      address: "10 Main Street, Bairnsdale VIC 3875",
      customerGroup: "Sale",
      id: "customer-new-1",
      name: "Wildlife Rescue",
      phone: "51520000",
    });

    const response = await POST(
      new Request("https://command.egit.com.au/api/internal/msp-central/lookups", {
        body: JSON.stringify({
          address: "10 Main Street",
          city: "Bairnsdale",
          country: "Australia",
          customerGroup: "Sale",
          email: "help@wildlife.example",
          name: "Wildlife Rescue",
          phone: "51520000",
          postalCode: "3875",
          state: "VIC",
          type: "customer",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      customer: {
        address: "10 Main Street, Bairnsdale VIC 3875",
        customerGroup: "Sale",
        id: "customer-new-1",
        name: "Wildlife Rescue",
        phone: "51520000",
      },
    });
    expect(createCustomer).toHaveBeenCalledWith({
      address: "10 Main Street",
      city: "Bairnsdale",
      country: "Australia",
      customerGroup: "Sale",
      email: "help@wildlife.example",
      name: "Wildlife Rescue",
      phone: "51520000",
      postalCode: "3875",
      state: "VIC",
    });
  });
});
