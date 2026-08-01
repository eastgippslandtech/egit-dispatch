import type { Technician } from "@/server/dispatch/types";

import type { PresenceLeave } from "./types";

type FetchLike = typeof fetch;
type ZohoPeopleEnv = Record<string, string | undefined>;

export type ZohoPeopleConfig = {
  accountsUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type ZohoPeopleLeaveRecord = {
  approval_status?: string;
  days?: Record<
    string,
    {
      end_time?: string;
      start_time?: string;
    }
  >;
  employee?: {
    zoho_id?: number | string;
  };
  leave_type?: {
    name?: string;
  };
};

export function readZohoPeopleConfig(
  env: ZohoPeopleEnv = process.env,
): ZohoPeopleConfig | null {
  const clientId = env.ZOHO_PEOPLE_CLIENT_ID?.trim();
  const clientSecret = env.ZOHO_PEOPLE_CLIENT_SECRET?.trim();
  const refreshToken = env.ZOHO_PEOPLE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    accountsUrl:
      env.ZOHO_PEOPLE_ACCOUNTS_URL?.trim() ||
      "https://accounts.zoho.com.au",
    apiBaseUrl:
      env.ZOHO_PEOPLE_API_BASE_URL?.trim() ||
      "https://people.zoho.com.au",
    clientId,
    clientSecret,
    refreshToken,
  };
}

export function createZohoPeopleClient({
  config,
  fetchImpl = fetch,
}: {
  config: ZohoPeopleConfig;
  fetchImpl?: FetchLike;
}) {
  async function acquireToken() {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    });
    const response = await fetchImpl(
      `${trimSlash(config.accountsUrl)}/oauth/v2/token`,
      {
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`Zoho People token request failed (${response.status}).`);
    }
    const payload = (await response.json()) as { access_token?: string };
    if (!payload.access_token) {
      throw new Error("Zoho People token response was incomplete.");
    }
    return payload.access_token;
  }

  async function listApprovedLeave({
    fromDate,
    technicians,
    toDate,
  }: {
    fromDate: string;
    technicians: Technician[];
    toDate: string;
  }): Promise<PresenceLeave[]> {
    const mappedTechnicians = technicians.filter(
      (technician) => technician.zohoPeopleEmployeeId,
    );
    if (mappedTechnicians.length === 0) {
      return [];
    }

    const token = await acquireToken();
    const employeeIds = mappedTechnicians.map(
      (technician) => technician.zohoPeopleEmployeeId as string,
    );
    const query = new URLSearchParams({
      approval_status: "APPROVED",
      data_select: "ALL",
      employee_zoho_ids: JSON.stringify(employeeIds),
      from_date: formatPeopleDate(fromDate),
      limit: "200",
      to_date: formatPeopleDate(toDate),
    });
    const response = await fetchImpl(
      `${trimSlash(
        config.apiBaseUrl,
      )}/people/api/v3/leave-tracker/leaves?${query.toString()}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Zoho-oauthtoken ${token}`,
        },
        method: "GET",
      },
    );
    if (!response.ok) {
      throw new Error(`Zoho People leave read failed (${response.status}).`);
    }
    const payload = (await response.json()) as {
      data?: ZohoPeopleLeaveRecord[];
    };

    return (payload.data ?? []).flatMap((record) => {
      if (record.approval_status?.toLowerCase() !== "approved") {
        return [];
      }
      const employeeId = String(record.employee?.zoho_id ?? "");
      const technician = mappedTechnicians.find(
        (candidate) => candidate.zohoPeopleEmployeeId === employeeId,
      );
      if (!technician) {
        return [];
      }
      const technicianEmail =
        technician.zohoEmail ?? technician.outlookEmail;
      return Object.entries(record.days ?? {}).flatMap(([date, day]) => {
        const dateKey = parsePeopleDate(date);
        if (!dateKey) {
          return [];
        }
        return [
          {
            endsAt: melbourneLocalTimestamp(
              dateKey,
              day.end_time ?? "17:30",
            ),
            label: safeLeaveLabel(record.leave_type?.name),
            source: "zoho_people" as const,
            startsAt: melbourneLocalTimestamp(
              dateKey,
              day.start_time ?? "09:00",
            ),
            technicianEmail,
          },
        ];
      });
    });
  }

  return { acquireToken, listApprovedLeave };
}

function safeLeaveLabel(value?: string) {
  const label = value?.trim().replace(/\s+/g, " ");
  return label ? label.slice(0, 60) : "Leave";
}

function formatPeopleDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}-${MONTHS[Number(month) - 1]}-${year}`;
}

function parsePeopleDate(value: string) {
  const match = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return null;
  const month = MONTHS.findIndex(
    (candidate) => candidate.toLowerCase() === match[2].toLowerCase(),
  );
  if (month < 0) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1]}`;
}

function melbourneLocalTimestamp(dateKey: string, time: string) {
  const month = Number(dateKey.slice(5, 7));
  const offset = month >= 4 && month <= 9 ? "+10:00" : "+11:00";
  return `${dateKey}T${time.slice(0, 5)}:00${offset}`;
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
