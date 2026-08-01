import type { ZohoCrmRecord } from "./client";

type SearchClient = {
  searchAccountsByPhone(phone: string): Promise<ZohoCrmRecord[]>;
  searchContactsByPhone(phone: string): Promise<ZohoCrmRecord[]>;
};

export async function matchPhoneToZohoCrm(
  phone: string,
  client: SearchClient,
) {
  const contact = (await client.searchContactsByPhone(phone))[0];
  if (contact) {
    const account =
      typeof contact.Account_Name === "object"
        ? contact.Account_Name
        : undefined;
    return {
      accountId: account?.id,
      contactId: contact.id,
      contactName: contact.Full_Name,
      customerName:
        account?.name ??
        (typeof contact.Account_Name === "string"
          ? contact.Account_Name
          : undefined),
      matchType: "contact" as const,
    };
  }

  const account = (await client.searchAccountsByPhone(phone))[0];
  if (!account) return undefined;
  return {
    accountId: account.id,
    customerName:
      typeof account.Account_Name === "string"
        ? account.Account_Name
        : account.Account_Name?.name,
    matchType: "account" as const,
  };
}
