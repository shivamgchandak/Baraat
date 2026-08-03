import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let configured = false;

function getTransporter(): Transporter | null {
  if (configured) return transporter;
  configured = true;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
  return transporter;
}

function portalUrl(): string {
  const isProd = process.env.NODE_ENV === "production";
  const picked = isProd ? process.env.PORTAL_URL_PROD : process.env.PORTAL_URL_DEV;
  return picked ?? process.env.PORTAL_URL ?? (isProd ? "https://baraat-ops.vercel.app" : "http://localhost:3000");
}

const GUEST_APK_URL =
  "https://expo.dev/artifacts/eas/MfybBkcXDv18xxOqcPoGfkDMdovH8v-3NOQGd_6YrB4.apk";

export async function sendCredentialsEmail(opts: {
  to: string;
  name: string;
  role: "guest" | "driver";
  password: string;
}): Promise<{ sent: boolean }> {
  const { to, name, role, password } = opts;
  const isGuest = role === "guest";
  const url = portalUrl();
  const appLine = isGuest
    ? `Download the Baraat guest app and sign in:\n${GUEST_APK_URL}\n(Downloadable on Android only, as it is an APK.)`
    : `Open the Baraat Ops portal and sign in under your driver account:\n${url}`;
  const appHtml = isGuest
    ? `Download the Baraat guest app and sign in:<br/><a href="${GUEST_APK_URL}">${GUEST_APK_URL}</a><br/><span style="font-size:12px;color:#666;">(Downloadable on Android only, as it is an APK.)</span>`
    : `Open the Baraat Ops portal and sign in under your driver account:<br/><a href="${url}">${url}</a>`;
  const subject = isGuest
    ? "Your Baraat ride account is ready"
    : "Your Baraat driver account is ready";
  const text =
    `Hi ${name},\n\n` +
    `An account has been created for you for the event's transport.\n\n` +
    `Email: ${to}\n` +
    `Password: ${password}\n\n` +
    `${appLine}\n\nYou can change your password after signing in.\n`;
  const html = `<p>Hi ${name},</p>
<p>An account has been created for you for the event's transport.</p>
<p><b>Email:</b> ${to}<br/><b>Password:</b> ${password}</p>
<p>${appHtml}</p>
<p>You can change your password after signing in.</p>`;

  const tx = getTransporter();
  if (!tx) {
    console.log(`[MAIL] (SMTP not configured — logging instead)\n  To: ${to}\n  Subject: ${subject}\n${text}`);
    return { sent: false };
  }

  try {
    await tx.sendMail({
      from: process.env.MAIL_FROM ?? '"Baraat" <no-reply@baraat.events>',
      to,
      subject,
      text,
      html,
    });
    console.log(`[MAIL] sent credentials to ${to}`);
    return { sent: true };
  } catch (err) {
    console.error("[MAIL] send failed (non-fatal):", err);
    return { sent: false };
  }
}
