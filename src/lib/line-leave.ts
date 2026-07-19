/**
 * LINE handler for approving/rejecting a leave request straight from the DM card
 * an approver receives. The tapper must be a linked user who holds leave-approval
 * rights; the actual decision reuses the same logic as the web route.
 */
import type { LeaveStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { infoFlex } from "./line-messages";
import type { LineMessage } from "./line";
import { applyLeaveDecision, canApproveLeave } from "../controllers/leave.controller";
import { AppError } from "../middleware/error";

function card(header: string, color: string, body: string): LineMessage {
  const c = infoFlex(header, color, body);
  return { type: "flex", altText: c.altText.slice(0, 400), contents: c.contents };
}

/** Approve/reject a leave from a rich-card postback. Returns the reply message(s). */
export async function handleLeaveDecision(
  lineUserId: string,
  leaveId: string,
  decision: LeaveStatus
): Promise<LineMessage[]> {
  const user = await prisma.user.findFirst({
    where: { lineUserId },
    select: { id: true, name: true },
  });
  if (!user) {
    return [
      card(
        "🔗 ยังไม่ได้เชื่อมต่อ",
        "#d97706",
        "เชื่อมต่อบัญชี DevPulse กับ LINE ก่อนจึงจะอนุมัติได้ครับ"
      ),
    ];
  }
  if (!(await canApproveLeave(user.id))) {
    return [card("⛔ ไม่มีสิทธิ์", "#dc2626", "คุณไม่มีสิทธิ์อนุมัติคำขอลา")];
  }

  try {
    const leave = await applyLeaveDecision(leaveId, user.id, decision);
    const ok = decision === "APPROVED";
    return [
      card(
        ok ? "✅ อนุมัติแล้ว" : "❌ ปฏิเสธแล้ว",
        ok ? "#16a34a" : "#dc2626",
        `คำขอลาของ ${leave.user.name} ถูก${ok ? "อนุมัติ" : "ปฏิเสธ"}เรียบร้อยแล้ว`
      ),
    ];
  } catch (e) {
    if (e instanceof AppError) {
      // e.g. already decided (409) or not found (404).
      return [card("⚠️ ทำรายการไม่ได้", "#d97706", e.message)];
    }
    return [card("⚠️ เกิดข้อผิดพลาด", "#dc2626", "ลองใหม่อีกครั้งครับ")];
  }
}
