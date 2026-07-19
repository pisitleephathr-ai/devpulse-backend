import { env } from "./env";
import { appBaseUrl } from "./line";

const RESEND_URL = "https://api.resend.com/emails";

/** Whether email sending is configured (a Resend API key is present). */
export function isMailerConfigured(): boolean {
  return !!env.RESEND_API_KEY;
}

/**
 * Send one email via Resend's REST API (no SDK dependency). Best-effort — never
 * throws, so a mail failure can't break the mutation that triggered it. Returns
 * whether it was accepted.
 */
export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "mailer not configured" };
  // MAIL_FROM must be a verified Resend sender; the sandbox address only
  // delivers to the account owner's verified email (fine for testing).
  const from = env.MAIL_FROM || "DevPulse <onboarding@resend.dev>";
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[mail] send failed: ${res.status} ${await res.text()}`);
      return { ok: false, error: `status ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[mail] send error:", err);
    return { ok: false, error: "network" };
  }
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}

/** Branded welcome email: greeting + how to sign in + the initial credentials. */
export function welcomeEmailHtml(input: {
  name: string;
  email: string;
  password: string;
}): { subject: string; html: string } {
  const base = appBaseUrl();
  const loginUrl = base ? `${base}/login` : "";
  const subject = "ยินดีต้อนรับสู่ DevPulse 🎉";
  const button = loginUrl
    ? `<a href="${esc(loginUrl)}" style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px;font-size:15px">เข้าสู่ระบบ</a>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
      <div style="background:#0d9488;padding:22px 28px">
        <div style="color:#ffffff;font-size:20px;font-weight:800">DevPulse</div>
        <div style="color:#ccfbf1;font-size:13px;margin-top:2px">ระบบจัดการทีม</div>
      </div>
      <div style="padding:28px">
        <p style="font-size:16px;margin:0 0 6px">สวัสดีคุณ${esc(input.name)} 👋</p>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px">
          บัญชีของคุณถูกสร้างเรียบร้อยแล้ว ใช้ข้อมูลด้านล่างเพื่อเข้าสู่ระบบ และแนะนำให้เปลี่ยนรหัสผ่านหลังเข้าครั้งแรก
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:22px;font-size:14px">
          <div style="margin-bottom:8px"><span style="color:#64748b">อีเมล:</span> <b>${esc(input.email)}</b></div>
          <div><span style="color:#64748b">รหัสผ่านเริ่มต้น:</span> <b style="font-family:monospace;font-size:15px">${esc(input.password)}</b></div>
        </div>
        ${button}
        <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:22px 0 0">
          หากคุณไม่ได้เป็นผู้ร้องขอบัญชีนี้ กรุณาละเว้นอีเมลฉบับนี้
        </p>
      </div>
    </div>
  </div></body></html>`;
  return { subject, html };
}
