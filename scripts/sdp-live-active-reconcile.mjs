import fs from "node:fs";
import path from "node:path";

import {
  buildActiveCustomerStaging,
  normalizeCompanyName,
} from "./sdp-active-customer-staging.mjs";

const API_ROOT = "https://servicedeskplus.net.au/app/memsp1783593801295/api/v3";
const AUGUST_START = Date.UTC(2026, 7, 1);

function readEnv(file) {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([^=]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}

async function getAccessToken(env) {
  const response = await fetch("https://accounts.zoho.com.au/oauth/v2/token", {
    body: new URLSearchParams({
      client_id: env.MSP_CENTRAL_CLIENT_ID,
      client_secret: env.MSP_CENTRAL_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: env.MSP_CENTRAL_REFRESH_TOKEN,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error(`OAuth refresh failed: ${payload.error ?? response.status}`);
  }
  return payload.access_token;
}

async function getJson(token, endpoint, inputData) {
  const url = new URL(`${API_ROOT}/${endpoint}`);
  if (inputData) url.searchParams.set("input_data", JSON.stringify(inputData));
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.manageengine.sdp.v3+json",
      Authorization: `Zoho-oauthtoken ${token}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint} failed ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

async function fetchPaged(token, endpoint, readRows, listInfo = {}) {
  const rows = [];
  let startIndex = 1;
  for (let page = 0; page < 200; page += 1) {
    const payload = await getJson(token, endpoint, {
      list_info: {
        row_count: 100,
        start_index: startIndex,
        ...listInfo,
      },
    });
    const pageRows = readRows(payload);
    rows.push(...pageRows);
    const info = payload.list_info ?? {};
    if (!info.has_more_rows || pageRows.length === 0) break;
    startIndex = Number(info.start_index ?? startIndex) + Number(info.row_count ?? pageRows.length);
  }
  return rows;
}

function requestCustomer(request) {
  return (
    request.account?.name ??
    request.customer?.name ??
    request.customer ??
    "Unknown customer"
  );
}

function requestRequesterName(request) {
  return (
    [request.requester?.first_name, request.requester?.last_name]
      .filter(Boolean)
      .join(" ") ||
    request.requester?.name ||
    request.requester_name ||
    ""
  );
}

function requestRequesterEmail(request) {
  return request.requester?.email_id ?? request.requester?.email ?? request.requester_email ?? "";
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || Date.parse(value) || 0;
  return Number(value.value) || Date.parse(value.display_value ?? "") || 0;
}

function isOpenRequest(request) {
  const status = String(request.status?.name ?? request.status ?? "").toLowerCase();
  return !/(closed|resolved|cancelled|canceled)/.test(status);
}

function isAugustRequest(request) {
  return (
    timestampValue(request.created_time) >= AUGUST_START ||
    timestampValue(request.updated_time) >= AUGUST_START
  );
}

function uniqueBy(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function buildContactsByEmail(contacts) {
  const map = new Map();
  for (const contact of contacts) {
    const email = normalizeEmail(contact.Email);
    const company = clean(contact.Company);
    const status = clean(contact.Status).toLowerCase();
    const companyStatus = clean(contact["Company Status"]).toLowerCase();
    if (!email || !company) continue;
    if (status && status !== "active") continue;
    if (companyStatus && companyStatus !== "active") continue;
    if (!map.has(email)) map.set(email, contact);
  }
  return map;
}

function resolveTicketCustomer({ contactByEmail, request }) {
  const currentCustomer = clean(requestCustomer(request));
  if (!/^(business|residential)$/i.test(currentCustomer)) {
    return currentCustomer;
  }

  const requesterEmail = normalizeEmail(requestRequesterEmail(request));
  const contact = requesterEmail ? contactByEmail.get(requesterEmail) : undefined;
  const contactCompany = clean(contact?.Company);
  if (contactCompany && !/^(business|residential)$/i.test(contactCompany)) {
    return contactCompany;
  }

  const requester = clean(requestRequesterName(request));
  if (currentCustomer.toLowerCase() === "residential" && requester) {
    return requester;
  }

  return requester || currentCustomer;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  const [headers, ...records] = rows;
  return records.map((record) =>
    Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])),
  );
}

function toCsv(rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const workspace = process.cwd();
  const env = readEnv(path.join(workspace, ".env.codex-sdp-live.local"));
  const token = await getAccessToken(env);
  const outputDir = path.join(
    "C:\\Users\\SimeonWeller\\OneDrive - East Gippsland IT Services\\Desktop",
    "sdp_live_active_cleanup_20260808",
  );
  fs.mkdirSync(outputDir, { recursive: true });

  const [requests, requesters] = await Promise.all([
    fetchPaged(token, "requests", (payload) => payload.requests ?? [], {
      sort_field: "updated_time",
      sort_order: "desc",
    }),
    fetchPaged(token, "requesters", (payload) => payload.requesters ?? [], {
      sort_field: "name",
      sort_order: "asc",
    }),
  ]);
  const companies = parseCsv(fs.readFileSync(
    "C:\\Users\\SimeonWeller\\OneDrive - East Gippsland IT Services\\Desktop\\companypickerlist.csv",
    "utf8",
  ));
  const contacts = parseCsv(fs.readFileSync(
    "C:\\Users\\SimeonWeller\\OneDrive - East Gippsland IT Services\\Desktop\\contactsearchlist.csv",
    "utf8",
  ));
  const contactByEmail = buildContactsByEmail(contacts);

  const activeRequests = requests.filter(
    (request) => isOpenRequest(request) || isAugustRequest(request),
  );
  const eligibleTickets = activeRequests.map((request) => ({
    Company: resolveTicketCustomer({ contactByEmail, request }),
    Requester: requestRequesterName(request),
    RequesterEmail: requestRequesterEmail(request),
    Source: isOpenRequest(request) ? "open" : "august",
    TicketNumber: request.request_number ?? request.id,
  }));

  const staging = buildActiveCustomerStaging({
    companies,
    contacts,
    eligibleTickets,
  });

  const liveGenericRequesters = requesters.filter((requester) => {
    const customerName = requester.account?.name ?? requester.customer?.name ?? requester.customer ?? "";
    return /^(business|residential)$/i.test(customerName);
  });
  const liveGenericRequests = activeRequests.filter((request) =>
    /^(business|residential)$/i.test(requestCustomer(request)),
  );

  const targetCustomerKeys = new Set(
    staging.customers.map((customer) => normalizeCompanyName(customer.customerName)),
  );
  const currentCustomerNames = uniqueBy(
    requests.map((request) => ({ customerName: requestCustomer(request) })),
    (row) => normalizeCompanyName(row.customerName),
  );
  const likelyMissingCustomers = staging.customers.filter(
    (customer) =>
      !currentCustomerNames.some(
        (row) => normalizeCompanyName(row.customerName) === normalizeCompanyName(customer.customerName),
      ),
  );

  fs.writeFileSync(path.join(outputDir, "live_active_requests.json"), JSON.stringify(activeRequests, null, 2));
  fs.writeFileSync(path.join(outputDir, "target_customers.csv"), toCsv(staging.customers));
  fs.writeFileSync(path.join(outputDir, "target_requesters.csv"), toCsv(staging.requesters));
  fs.writeFileSync(path.join(outputDir, "target_warnings.csv"), toCsv(staging.warnings));
  fs.writeFileSync(path.join(outputDir, "generic_bucket_requests.csv"), toCsv(liveGenericRequests.map((request) => ({
    requestNumber: request.request_number ?? request.id,
    customerName: requestCustomer(request),
    requester: requestRequesterName(request),
    requesterEmail: requestRequesterEmail(request),
    subject: request.subject ?? "",
    status: request.status?.name ?? request.status ?? "",
  }))));
  fs.writeFileSync(path.join(outputDir, "generic_bucket_requesters.csv"), toCsv(liveGenericRequesters.map((requester) => ({
    id: requester.id,
    name: requester.name ?? [requester.first_name, requester.last_name].filter(Boolean).join(" "),
    email: requester.email_id ?? "",
    customerName: requester.account?.name ?? requester.customer?.name ?? requester.customer ?? "",
  }))));
  fs.writeFileSync(path.join(outputDir, "likely_missing_customers.csv"), toCsv(likelyMissingCustomers));
  fs.writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify(
      {
        requestsFetched: requests.length,
        activeRequests: activeRequests.length,
        targetCustomers: staging.customers.length,
        targetRequesters: staging.requesters.length,
        warnings: staging.warnings.length,
        genericBucketRequests: liveGenericRequests.length,
        genericBucketRequesters: liveGenericRequesters.length,
        likelyMissingCustomers: likelyMissingCustomers.length,
        knownCustomerNamesFromFetchedRequests: currentCustomerNames.length,
        targetCustomerKeys: targetCustomerKeys.size,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
