import { PermanentIntegrationError } from "../errors";
import type { IntegrationStepAdapter } from "../registry";

type EmailGraphClient = {
  sendMail(input: {
    fromUserPrincipalName: string;
    html?: string;
    plainText: string;
    subject: string;
    to: string;
  }): Promise<{ id?: string } | void>;
};

export function createEmailAdapters({
  fromUserPrincipalName,
  graphClient,
}: {
  fromUserPrincipalName?: string;
  graphClient: EmailGraphClient;
}): Record<string, IntegrationStepAdapter> {
  return {
    "email.send_technician_schedule_confirmation": {
      async execute(step) {
        const sender = clean(fromUserPrincipalName);
        if (!sender) {
          throw new PermanentIntegrationError(
            "Command Centre notification sender email is not configured.",
          );
        }

        const toEmail = requiredString(step.payload, "toEmail");
        const subject = requiredString(step.payload, "subjectLine");
        const plainText = requiredString(step.payload, "plainText");
        const html = optionalString(step.payload, "html");
        const result = await graphClient.sendMail({
          fromUserPrincipalName: sender,
          html,
          plainText,
          subject,
          to: toEmail,
        });

        return {
          externalId: result?.id,
          sent: true,
          toEmail,
        };
      },
      writeSafety: "idempotent",
    },
  };
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = optionalString(payload, key);
  if (!value) throw new PermanentIntegrationError(`${key} is required.`);
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clean(value?: string) {
  return value?.trim() || undefined;
}
