export type PushMessage = {
  body: string;
  data: {
    eventType: string;
    requestId: string;
    requestNumber: string;
  };
  title: string;
  to: string;
};

export async function sendExpoPushNotification(message: PushMessage) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    body: JSON.stringify({
      ...message,
      channelId: "job-updates",
      priority: "high",
      sound: "default",
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: { id?: string; message?: string; status?: string };
  };

  if (!response.ok || payload.data?.status === "error") {
    throw new Error(payload.data?.message ?? "Expo push delivery failed.");
  }

  return { receiptId: payload.data?.id };
}
