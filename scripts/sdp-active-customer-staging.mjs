import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_STATE = "VIC";
const DEFAULT_COUNTRY = "Australia";

export function normalizeCompanyName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function splitPersonName(value) {
  const parts = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] ?? "", lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  };
}

export function buildActiveCustomerStaging({
  companies,
  contacts,
  eligibleTickets,
}) {
  const companiesByName = new Map();
  for (const company of companies) {
    const key = normalizeCompanyName(company["Company Name"]);
    if (!eligibleCompanyRow(company)) continue;
    if (!key || companiesByName.has(key)) continue;
    companiesByName.set(key, company);
  }

  const contactsByCompany = new Map();
  for (const contact of contacts) {
    if (!eligibleContactRow(contact)) continue;
    const key = normalizeCompanyName(contact.Company);
    if (!key) continue;
    const rows = contactsByCompany.get(key) ?? [];
    rows.push(contact);
    contactsByCompany.set(key, rows);
  }

  const eligibleByCustomer = new Map();
  for (const ticket of eligibleTickets) {
    const key = normalizeCompanyName(ticket.Company);
    if (placeholderCustomerKey(key)) continue;
    if (!key) continue;
    const rows = eligibleByCustomer.get(key) ?? [];
    rows.push(ticket);
    eligibleByCustomer.set(key, rows);
  }

  const customers = [];
  const requesters = [];
  const warnings = [];

  for (const [key, tickets] of [...eligibleByCustomer.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const sourceCompany = companiesByName.get(key);
    const firstTicket = tickets[0];
    const customerName = clean(sourceCompany?.["Company Name"]) || clean(firstTicket.Company);
    const customerType = classifyCustomerType(sourceCompany?.Type);
    const companyContacts = contactsByCompany.get(key) ?? [];
    const primaryContact = choosePrimaryContact(companyContacts, tickets);
    const email = clean(primaryContact?.Email) || clean(firstTicket.RequesterEmail);

    customers.push({
      customerName,
      customerType,
      companyId: clean(sourceCompany?.["Company ID"]),
      phone: clean(sourceCompany?.["Phone Number"]) || clean(primaryContact?.["Phone Number"]),
      email,
      siteName: clean(sourceCompany?.Site) || clean(primaryContact?.Site) || "Main",
      street: clean(sourceCompany?.["Address Line 1"]) || clean(primaryContact?.["Address Line 1"]),
      city: clean(sourceCompany?.Suburb) || clean(primaryContact?.Suburb),
      state: clean(primaryContact?.State) || DEFAULT_STATE,
      country: DEFAULT_COUNTRY,
      eligibleTicketCount: String(tickets.length),
      eligibleTicketNumbers: tickets.map((ticket) => ticket.TicketNumber).filter(Boolean).join("; "),
      eligibility: unique(tickets.map((ticket) => ticket.Source)).join("; "),
    });

    if (!sourceCompany) {
      warnings.push({
        level: "review",
        customerName,
        issue: "No matching company row in companypickerlist.csv",
      });
    }
    if (!email) {
      warnings.push({
        level: "review",
        customerName,
        issue: "No email found on matching contact or eligible ticket",
      });
    }
    if (!customers.at(-1).street || !customers.at(-1).city) {
      warnings.push({
        level: "review",
        customerName,
        issue: "Street/city address is incomplete",
      });
    }

    for (const requester of buildRequestersForCustomer({
      companyContacts,
      customerName,
      tickets,
    })) {
      requesters.push(requester);
    }
  }

  return { customers, requesters, warnings };
}

function buildRequestersForCustomer({ companyContacts, customerName, tickets }) {
  const requestersByEmailOrName = new Map();

  for (const contact of companyContacts) {
    const email = clean(contact.Email).toLowerCase();
    const fullName = [clean(contact["First Name"]), clean(contact["Last Name"])]
      .filter(Boolean)
      .join(" ");
    const key = email || normalizeCompanyName(fullName);
    if (!key || requestersByEmailOrName.has(key)) continue;
    requestersByEmailOrName.set(key, {
      customerName,
      firstName: clean(contact["First Name"]) || fullName || customerName,
      lastName: clean(contact["Last Name"]),
      displayName: fullName || clean(contact.Email) || customerName,
      email: clean(contact.Email),
      phone: clean(contact["Phone Number"]),
      siteName: clean(contact.Site) || "Main",
      street: clean(contact["Address Line 1"]),
      city: clean(contact.Suburb),
      state: clean(contact.State) || DEFAULT_STATE,
      source: "contact export",
    });
  }

  for (const ticket of tickets) {
    const email = clean(ticket.RequesterEmail).toLowerCase();
    const key = email || normalizeCompanyName(ticket.Requester);
    if (!key || requestersByEmailOrName.has(key)) continue;
    const name = splitPersonName(clean(ticket.Requester) || clean(ticket.Company));
    requestersByEmailOrName.set(key, {
      customerName,
      firstName: name.firstName || clean(ticket.Company),
      lastName: name.lastName,
      displayName: clean(ticket.Requester) || clean(ticket.Company),
      email: clean(ticket.RequesterEmail),
      phone: "",
      siteName: "Main",
      street: "",
      city: "",
      state: DEFAULT_STATE,
      source: "ticket activity",
    });
  }

  return [...requestersByEmailOrName.values()].sort((a, b) =>
    `${a.customerName} ${a.displayName}`.localeCompare(`${b.customerName} ${b.displayName}`),
  );
}

function choosePrimaryContact(contacts, tickets) {
  const ticketEmails = new Set(
    tickets.map((ticket) => clean(ticket.RequesterEmail).toLowerCase()).filter(Boolean),
  );
  return (
    contacts.find((contact) => ticketEmails.has(clean(contact.Email).toLowerCase())) ??
    contacts.find((contact) => clean(contact.Email)) ??
    contacts[0]
  );
}

function classifyCustomerType(type) {
  const cleanType = clean(type).toLowerCase();
  if (cleanType.includes("residential")) return "Residential";
  if (cleanType.includes("managed")) return "Managed";
  if (cleanType.includes("vendor")) return "Vendor";
  if (cleanType.includes("contract")) return "Contract";
  return "Business";
}

function eligibleCompanyRow(company) {
  const name = normalizeCompanyName(company["Company Name"]);
  const type = clean(company.Type).toLowerCase();
  const status = clean(company.Status).toLowerCase();
  return (
    Boolean(name) &&
    !placeholderCustomerKey(name) &&
    !type.includes("do not use") &&
    (!status || status === "active")
  );
}

function eligibleContactRow(contact) {
  const status = clean(contact.Status).toLowerCase();
  const companyStatus = clean(contact["Company Status"]).toLowerCase();
  return (
    (!status || status === "active") &&
    (!companyStatus || companyStatus === "active") &&
    !placeholderCustomerKey(normalizeCompanyName(contact.Company))
  );
}

function placeholderCustomerKey(key) {
  return key === "change me" || key === "do not use" || key === "unknown";
}

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
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
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);

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
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function readCsv(filePath) {
  return parseCsv(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function srBoardTickets(rows) {
  return rows.map((row) => ({
    Company: row.Company,
    Requester: "",
    RequesterEmail: "",
    Source: "open",
    TicketNumber: row["Ticket #"] || row.Selected_Sr_Service_Recid,
  }));
}

async function main() {
  const { values } = parseArgs({
    options: {
      companies: { type: "string" },
      contacts: { type: "string" },
      outputDir: { type: "string" },
      srboard: { type: "string" },
      august: { type: "string", multiple: true },
    },
  });

  if (!values.companies || !values.contacts || !values.srboard || !values.outputDir) {
    throw new Error("Required: --companies --contacts --srboard --outputDir");
  }

  const eligibleTickets = [
    ...srBoardTickets(readCsv(values.srboard)),
    ...(values.august ?? []).flatMap((file) => readCsv(file)),
  ];
  const result = buildActiveCustomerStaging({
    companies: readCsv(values.companies),
    contacts: readCsv(values.contacts),
    eligibleTickets,
  });

  fs.mkdirSync(values.outputDir, { recursive: true });
  fs.writeFileSync(path.join(values.outputDir, "active_customers.csv"), toCsv(result.customers));
  fs.writeFileSync(path.join(values.outputDir, "active_requesters.csv"), toCsv(result.requesters));
  fs.writeFileSync(path.join(values.outputDir, "active_customer_warnings.csv"), toCsv(result.warnings));
  fs.writeFileSync(
    path.join(values.outputDir, "summary.json"),
    JSON.stringify(
      {
        customers: result.customers.length,
        requesters: result.requesters.length,
        warnings: result.warnings.length,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
