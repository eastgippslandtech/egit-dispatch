import type { DispatchRequest } from "@/server/dispatch/types";

export type ZohoCrmAccountRecord = {
  Account_Name?: string;
  Billing_City?: string;
  Billing_Code?: string;
  Billing_Country?: string;
  Billing_State?: string;
  Billing_Street?: string;
  Shipping_City?: string;
  Shipping_Code?: string;
  Shipping_Country?: string;
  Shipping_State?: string;
  Shipping_Street?: string;
  id: string;
};

const AMBIGUOUS_MATCH_WARNING =
  "Multiple Zoho CRM accounts match this customer; site address needs review.";
const MISSING_ADDRESS_WARNING =
  "No usable Helpdesk or Zoho CRM site address was found.";

export function enrichRequestsWithZohoCrmAddresses(
  requests: readonly DispatchRequest[],
  accounts: readonly ZohoCrmAccountRecord[],
): DispatchRequest[] {
  const accountsByName = new Map<string, ZohoCrmAccountRecord[]>();
  const accountsByCanonicalName = new Map<string, ZohoCrmAccountRecord[]>();

  for (const account of accounts) {
    const key = normalizeAccountName(account.Account_Name);
    const canonicalKey = normalizeHighConfidenceAccountName(account.Account_Name);
    if (key) {
      accountsByName.set(key, [...(accountsByName.get(key) ?? []), account]);
    }
    if (canonicalKey) {
      accountsByCanonicalName.set(canonicalKey, [
        ...(accountsByCanonicalName.get(canonicalKey) ?? []),
        account,
      ]);
    }
  }

  return requests.map((request) => {
    if (isRemoteRequest(request) || isUsableStreetAddress(request.siteAddress)) {
      return {
        ...request,
        siteAddressSource: request.siteAddress ? "msp-central" : "unknown",
      };
    }

    const matches = findHighConfidenceAccountMatches({
      accountsByCanonicalName,
      accountsByName,
      customer: request.customer,
    });
    if (matches.length > 1) {
      return withAddressWarning(request, AMBIGUOUS_MATCH_WARNING);
    }

    const account = matches[0];
    const crmAddress = account ? getZohoCrmAccountAddress(account) : undefined;
    if (!account || !crmAddress) {
      return withAddressWarning(request, MISSING_ADDRESS_WARNING);
    }

    return {
      ...request,
      crmAccountId: account.id,
      site: crmAddress.address,
      siteAddress: crmAddress.address,
      siteAddressSource: "zoho-crm",
      siteTown: crmAddress.city ?? request.siteTown,
      warnings: request.warnings.filter(
        (warning) => warning.toLowerCase() !== "missing site address",
      ),
    };
  });
}

export function getZohoCrmAccountAddress(account: ZohoCrmAccountRecord) {
  return (
    formatAddress({
      city: account.Shipping_City,
      code: account.Shipping_Code,
      country: account.Shipping_Country,
      state: account.Shipping_State,
      street: account.Shipping_Street,
    }) ??
    formatAddress({
      city: account.Billing_City,
      code: account.Billing_Code,
      country: account.Billing_Country,
      state: account.Billing_State,
      street: account.Billing_Street,
    })
  );
}

export function isUsableStreetAddress(address?: string) {
  const value = address?.trim();
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (
    [
      "business",
      "n/a",
      "na",
      "none",
      "remote",
      "remote / virtual",
      "unknown",
      "unknown site",
    ].includes(normalized)
  ) {
    return false;
  }

  return /\d+\s+[a-z]/i.test(value) && /[a-z]{3,}/i.test(value);
}

function isRemoteRequest(request: DispatchRequest) {
  return (
    request.bookingType === "Remote" ||
    request.onsite === false ||
    /\b(remote|virtual)\b/i.test(
      [request.siteAddress, request.site].filter(Boolean).join(" "),
    )
  );
}

function normalizeAccountName(value?: string) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeHighConfidenceAccountName(value?: string) {
  return normalizeAccountName(value)
    .split(" ")
    .filter((token) => !LEGAL_SUFFIX_TOKENS.has(token))
    .join(" ");
}

function findHighConfidenceAccountMatches({
  accountsByCanonicalName,
  accountsByName,
  customer,
}: {
  accountsByCanonicalName: Map<string, ZohoCrmAccountRecord[]>;
  accountsByName: Map<string, ZohoCrmAccountRecord[]>;
  customer: string;
}) {
  const exactKey = normalizeAccountName(customer);
  const exactMatches = accountsByName.get(exactKey);
  if (exactMatches?.length) {
    return exactMatches;
  }

  const canonicalKey = normalizeHighConfidenceAccountName(customer);
  if (!canonicalKey) {
    return [];
  }

  return accountsByCanonicalName.get(canonicalKey) ?? [];
}

const LEGAL_SUFFIX_TOKENS = new Set([
  "inc",
  "limited",
  "llc",
  "ltd",
  "proprietary",
  "pty",
]);

function formatAddress(parts: {
  city?: string;
  code?: string;
  country?: string;
  state?: string;
  street?: string;
}) {
  const street = clean(parts.street);
  if (!street) return undefined;
  const city = clean(parts.city);
  const stateAndCode = [clean(parts.state), clean(parts.code)]
    .filter(Boolean)
    .join(" ");
  const country = clean(parts.country);
  const locality = [city, stateAndCode].filter(Boolean).join(" ");
  const address = [street, locality, country].filter(Boolean).join(", ");

  return { address, city };
}

function clean(value?: string) {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned || undefined;
}

function withAddressWarning(request: DispatchRequest, warning: string) {
  return {
    ...request,
    siteAddressSource: "unknown" as const,
    warnings: [...new Set([...request.warnings, warning])],
  };
}
