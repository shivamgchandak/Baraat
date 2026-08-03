

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function sendPush(
  expoPushTokens: (string | null | undefined)[],
  message: PushMessage,
): Promise<void> {
  const tokens = expoPushTokens.filter(
    (t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken"),
  );
  if (tokens.length === 0) {
    console.log(`[PUSH] (no tokens) ${message.title} — ${message.body}`);
    return;
  }
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          data: message.data ?? {},
          sound: "default",
        })),
      ),
    });
    console.log(`[PUSH] sent to ${tokens.length} device(s): ${message.title}`);
  } catch (err) {
    console.error("[PUSH] send failed (non-fatal):", err);
  }
}
