import { describe, expect, it, vi } from "vitest";

import { matchPhoneToZohoCrm } from "./matching";

describe("matchPhoneToZohoCrm", () => {
  it("uses a Contact match before Accounts", async () => {
    const client = {
      searchAccountsByPhone: vi.fn(),
      searchContactsByPhone: vi.fn().mockResolvedValue([
        { Account_Name: { id: "account-1", name: "Acme" }, Full_Name: "Mel", id: "contact-1" },
      ]),
    };

    await expect(matchPhoneToZohoCrm("+61351501000", client)).resolves.toMatchObject({
      accountId: "account-1",
      contactId: "contact-1",
      contactName: "Mel",
      customerName: "Acme",
    });
    expect(client.searchAccountsByPhone).not.toHaveBeenCalled();
  });

  it("falls back to Accounts when no Contact matches", async () => {
    const client = {
      searchAccountsByPhone: vi.fn().mockResolvedValue([{ Account_Name: "Acme", id: "account-1" }]),
      searchContactsByPhone: vi.fn().mockResolvedValue([]),
    };

    await expect(matchPhoneToZohoCrm("+61351501000", client)).resolves.toMatchObject({
      accountId: "account-1",
      customerName: "Acme",
    });
  });
});
