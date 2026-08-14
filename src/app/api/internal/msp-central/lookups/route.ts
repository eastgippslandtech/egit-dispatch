import { NextResponse } from "next/server";

import {
  getCommandCentreAccess,
  isApprovedStaffAccess,
} from "@/server/auth/session";
import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type")?.trim();
    const query = url.searchParams.get("q")?.trim() || undefined;
    const customerId = url.searchParams.get("customerId")?.trim() || undefined;
    const client = createMspCentralClient(readDispatchConfig());

    if (type === "customers") {
      return json({ customers: await client.listCustomers(query) }, 200);
    }

    if (type === "contacts") {
      if (!client.listContacts) {
        return json({ contacts: [] }, 200);
      }
      return json({
        contacts: await client.listContacts({ customerId, query }),
      }, 200);
    }

    if (type === "request-options") {
      if (!client.listRequestFormOptions) {
        return json({ options: null }, 200);
      }
      return json({ options: await client.listRequestFormOptions() }, 200);
    }

    return json({ error: "Lookup type is required." }, 400);
  } catch (error) {
    console.error("MSP Central lookup route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central lookup could not be loaded.",
      },
      502,
    );
  }
}

export async function POST(request: Request) {
  const access = await getCommandCentreAccess();
  if (access.status === "unauthenticated") {
    return json({ error: "Authentication required." }, 401);
  }
  if (!isApprovedStaffAccess(access)) {
    return json({ error: "Access not approved." }, 403);
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          address?: string;
          city?: string;
          country?: string;
          customerGroup?: string;
          email?: string;
          name?: string;
          phone?: string;
          postalCode?: string;
          state?: string;
          type?: string;
        }
      | null;

    if (body?.type === "customer-group") {
      const name = body.name?.trim();
      if (!name) {
        return json({ error: "Customer group name is required." }, 400);
      }

      const client = createMspCentralClient(readDispatchConfig());
      if (!client.createCustomerGroup) {
        return json({ error: "Customer group creation is not available." }, 501);
      }

      const customerGroup = await client.createCustomerGroup({ name });
      return json({ customerGroup }, 201);
    }

    if (body?.type !== "customer") {
      return json({ error: "Lookup type is required." }, 400);
    }

    const name = body.name?.trim();
    if (!name) {
      return json({ error: "Customer name is required." }, 400);
    }

    const client = createMspCentralClient(readDispatchConfig());
    if (!client.createCustomer) {
      return json({ error: "Customer creation is not available." }, 501);
    }

    const customer = await client.createCustomer({
      address: cleanOptional(body.address),
      city: cleanOptional(body.city),
      country: cleanOptional(body.country),
      customerGroup: cleanOptional(body.customerGroup),
      email: cleanOptional(body.email),
      name,
      phone: cleanOptional(body.phone),
      postalCode: cleanOptional(body.postalCode),
      state: cleanOptional(body.state),
    });

    return json({ customer }, 201);
  } catch (error) {
    console.error("MSP Central customer create route failed", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MSP Central customer could not be created.",
      },
      502,
    );
  }
}

function cleanOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}
