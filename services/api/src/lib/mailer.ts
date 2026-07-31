/**
 * Invitation mailer. Without SMTP/API credentials it logs the email and the
 * portal also surfaces the link so ops can share it over WhatsApp/SMS.
 * Set RESEND_API_KEY (+ MAIL_FROM) to send real email via Resend.
 */
export async function sendInviteEmail(opts: {
  to: string;
  name: string;
  inviteLink: string;
}): Promise<{ sent: boolean }> {
  const { to, name, inviteLink } = opts;
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log(`[MAIL] (no RESEND_API_KEY — logging instead)
  To: ${to}
  Subject: You're invited — Baraat event transport
  Hi ${name}, your ride coordinator has set up transport for you.
  Set your password and view your pickup details: ${inviteLink}`);
    return { sent: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? "Baraat <onboarding@resend.dev>",
        to: [to],
        subject: "You're invited — Baraat event transport",
        html: `<p>Hi ${name},</p>
<p>Your event's transport team has set up airport pickups and rides for you.</p>
<p><a href="${inviteLink}">Tap here to activate your account and set your password</a>.</p>
<p>After activating, sign in to the Baraat guest app with this email address.</p>`,
      }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
