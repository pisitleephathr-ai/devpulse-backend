import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./lib/env";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import roleRoutes from "./routes/role.routes";
import profileRoutes from "./routes/profile.routes";
import projectRoutes from "./routes/project.routes";
import reportRoutes from "./routes/report.routes";
import taskRoutes from "./routes/task.routes";
import leaveRoutes from "./routes/leave.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import activityRoutes from "./routes/activity.routes";
import notificationRoutes from "./routes/notification.routes";
import searchRoutes from "./routes/search.routes";
import standupRoutes from "./routes/standup.routes";
import actionItemRoutes from "./routes/action-item.routes";
import kudosRoutes from "./routes/kudos.routes";
import calendarRoutes from "./routes/calendar.routes";
import settingsRoutes from "./routes/settings.routes";
import cronRoutes from "./routes/cron.routes";
import uploadRoutes from "./routes/uploads.routes";
import { lineWebhook } from "./controllers/line.controller";
import { errorHandler, notFound } from "./middleware/error";

const app = express();

// Behind Railway's proxy — needed for correct client IPs (rate limiting).
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    // Auth is Bearer-token based (no cookies), so credentials aren't needed.
    // Never combine a wildcard origin with credentials — only allow credentials
    // when the origin is explicitly restricted.
    credentials: env.CORS_ORIGIN !== "*",
  })
);
// LINE webhook must verify X-Line-Signature over the RAW body, so mount it with
// a raw parser BEFORE the global JSON middleware (json() would consume/reparse
// the body and break the HMAC).
app.post("/api/line/webhook", express.raw({ type: "*/*" }), lineWebhook);

app.use(express.json({ limit: "1mb" }));
if (env.NODE_ENV !== "test") app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.json({ name: "DevPulse API", version: "0.1.0", status: "ok" });
});
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/daily-reports", reportRoutes); // alias
app.use("/api/tasks", taskRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/standup", standupRoutes);
app.use("/api/action-items", actionItemRoutes);
app.use("/api/kudos", kudosRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/uploads", uploadRoutes);
// Public (secret-gated) — no user session; for an external scheduler.
app.use("/api/cron", cronRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
