import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";
import {
  sanitizeYeastarPayload,
  verifyYeastarWebhookSignature,
} from "@/server/yeastar/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.YEASTAR_WEBHOOK_SECRET?.trim();
  const repository = getConfiguredYeastarRepository();
  if (!secret || !repository) {
    return NextResponse.json({ error: "Yeastar ingestion is not configured." }, { status: 503 });
  }

  const body = await request.text();
  if (
    !verifyYeastarWebhookSignature({
      body,
      secret,
      signature: request.headers.get("x-signature"),
    })
  ) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const eventType = stringValue(payload.event) || stringValue(payload.event_type);
  if (eventType && eventType !== "30012") {
    return NextResponse.json({ accepted: true, ignored: true }, { status: 202 });
  }
  const callId =
    stringValue(payload.uid) ||
    stringValue(payload.cdr_id) ||
    stringValue(payload.call_id);
  const eventKey =
    stringValue(payload.event_id) ||
    createHash("sha256").update(body).digest("hex");

  const inserted = await repository.recordEvent({
    callId: callId || undefined,
    eventKey,
    eventType: eventType || "30012",
    payload: sanitizeYeastarPayload(payload),
  });
  return NextResponse.json({ accepted: true, duplicate: !inserted }, { status: 202 });
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
