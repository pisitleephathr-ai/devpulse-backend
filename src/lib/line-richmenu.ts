/**
 * LINE OA rich menu setup — build a 2x3 grid of buttons that deep-link into the
 * web app, publish it, and set it as the default for all users. Callable from a
 * CLI script (src/scripts/line-richmenu.ts) or a server-side trigger (the cron
 * controller) — the latter matters because the image-upload host
 * (api-data.line.me) may be unreachable from some networks, so running inside
 * the deployed environment is the reliable path.
 */
import { v2 as cloudinary } from "cloudinary";
import { env } from "./env";
import { appBaseUrl } from "./line";

const API = "https://api.line.me/v2/bot";
const API_DATA = "https://api-data.line.me/v2/bot";

export const RICHMENU_WIDTH = 2500;
export const RICHMENU_HEIGHT = 1686;
const COLS = 3;
const ROWS = 2;
const CELL_W = RICHMENU_WIDTH / COLS;
const CELL_H = RICHMENU_HEIGHT / ROWS;

/**
 * A rich-menu cell. `chat` cells fire a postback command the bot answers inside
 * the chat; `web` cells open a page in the app. Mixed by design.
 */
type Cell =
  | { kind: "chat"; label: string; emoji: string; cmd: string; displayText: string }
  | { kind: "web"; label: string; emoji: string; path: string };

/** The 6 buttons, left→right, top→bottom. Row 1 = in-chat, row 2 = open web. */
export const CELLS: Cell[] = [
  { kind: "chat", label: "งานของฉัน", emoji: "📋", cmd: "my_tasks", displayText: "งานของฉัน" },
  { kind: "chat", label: "ใครลาวันนี้", emoji: "🌴", cmd: "leave_today", displayText: "ใครลาวันนี้" },
  { kind: "chat", label: "สถานะรายงานวันนี้", emoji: "📊", cmd: "report_today", displayText: "สถานะรายงานวันนี้" },
  { kind: "web", label: "บอร์ดงาน", emoji: "🗂", path: "/tasks" },
  { kind: "web", label: "ปฏิทินทีม", emoji: "📅", path: "/calendar" },
  { kind: "web", label: "ส่งรายงาน", emoji: "📝", path: "/reports" },
];

function token(): string {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  }
  return env.LINE_CHANNEL_ACCESS_TOKEN;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token()}` };
}

async function lineJson<T>(
  url: string,
  init: RequestInit & { body?: string } = {}
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Delete every existing rich menu so a publish fully replaces the old one. */
export async function clearRichMenus(): Promise<string[]> {
  const { richmenus } = await lineJson<{ richmenus: { richMenuId: string }[] }>(
    `${API}/richmenu/list`
  );
  const deleted: string[] = [];
  for (const m of richmenus ?? []) {
    await lineJson(`${API}/richmenu/${m.richMenuId}`, { method: "DELETE" });
    deleted.push(m.richMenuId);
  }
  return deleted;
}

/** Build the rich menu object (grid areas → chat postbacks or web URIs). */
function buildMenu(base: string) {
  const areas = CELLS.map((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const action =
      cell.kind === "chat"
        ? {
            type: "postback",
            label: cell.label,
            data: `cmd=${cell.cmd}`,
            displayText: cell.displayText,
          }
        : { type: "uri", label: cell.label, uri: `${base}${cell.path}` };
    return {
      bounds: {
        x: Math.round(col * CELL_W),
        y: Math.round(row * CELL_H),
        width: Math.round(CELL_W),
        height: Math.round(CELL_H),
      },
      action,
    };
  });
  return {
    size: { width: RICHMENU_WIDTH, height: RICHMENU_HEIGHT },
    selected: true,
    name: "DevPulse main menu",
    chatBarText: "เมนู DevPulse",
    areas,
  };
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

/**
 * A minimal, glassy SVG matching the 2x3 tappable grid, rasterized to PNG by
 * Cloudinary. Soft teal gradient background with translucent white cards; a
 * tinted icon chip and a small tag ("ตอบในแชท" / "เปิดหน้าเว็บ") per cell.
 */
function buildSvg(): string {
  const M = 54; // card margin inside each grid cell (airy spacing)
  const cards = CELLS.map((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CELL_W + M;
    const y = row * CELL_H + M;
    const w = CELL_W - M * 2;
    const h = CELL_H - M * 2;
    const cx = x + w / 2;

    const isChat = cell.kind === "chat";
    const chipFill = isChat ? "#cffafe" : "#dbeafe";
    const tag = isChat ? "💬  ตอบในแชท" : "↗  เปิดหน้าเว็บ";
    const iconCy = y + h * 0.37;

    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="80" fill="#ffffff" fill-opacity="0.82" stroke="#ffffff" stroke-opacity="0.9" stroke-width="3"/>
        <circle cx="${cx}" cy="${iconCy}" r="118" fill="${chipFill}"/>
        <text x="${cx}" y="${iconCy}" font-size="122" text-anchor="middle" dominant-baseline="central">${cell.emoji}</text>
        <text x="${cx}" y="${y + h * 0.70}" font-size="72" font-family="sans-serif" font-weight="700" fill="#0f5c55" text-anchor="middle">${esc(cell.label)}</text>
        <text x="${cx}" y="${y + h * 0.84}" font-size="42" font-family="sans-serif" font-weight="600" fill="#0d9488" text-anchor="middle">${esc(tag)}</text>
      </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" viewBox="0 0 ${RICHMENU_WIDTH} ${RICHMENU_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a7f3e4"/>
        <stop offset="0.55" stop-color="#6fd7cf" />
        <stop offset="1" stop-color="#4fc9b4"/>
      </linearGradient>
    </defs>
    <rect width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" fill="url(#bg)"/>
    ${cards}
  </svg>`;
}

/** Rasterize the generated SVG via Cloudinary and return the delivered PNG URL. */
export async function generateRichMenuPngUrl(): Promise<string> {
  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("Cannot auto-generate the image: CLOUDINARY_* not set");
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  const svg = buildSvg();
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    resource_type: "image",
    folder: `${env.CLOUDINARY_UPLOAD_FOLDER || "devpulse"}/system`,
    public_id: "line-richmenu",
    overwrite: true,
    invalidate: true,
  });
  return cloudinary.url(uploaded.public_id, {
    resource_type: "image",
    format: "png",
    width: RICHMENU_WIDTH,
    height: RICHMENU_HEIGHT,
    crop: "fill",
    secure: true,
    version: uploaded.version,
  });
}

/** Rasterize the generated SVG to a PNG buffer via Cloudinary. */
export async function generateRichMenuImage(): Promise<Buffer> {
  const pngUrl = await generateRichMenuPngUrl();
  const res = await fetch(pngUrl);
  if (!res.ok) throw new Error(`rasterize failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Publish the rich menu: clear existing → create → upload image → set default.
 * Auto-generates the image when none is supplied. Returns the new menu id.
 */
export async function publishRichMenu(
  image?: Buffer
): Promise<{ richMenuId: string; buttons: string[] }> {
  const base = appBaseUrl();
  if (!base) throw new Error("APP_URL (or a single CORS_ORIGIN) must be an http(s) URL");

  const png = image ?? (await generateRichMenuImage());
  if (png.byteLength > 1_000_000) {
    throw new Error(`image is ${png.byteLength} bytes (LINE limit is 1MB)`);
  }

  await clearRichMenus();

  const { richMenuId } = await lineJson<{ richMenuId: string }>(`${API}/richmenu`, {
    method: "POST",
    body: JSON.stringify(buildMenu(base)),
  });

  const up = await fetch(`${API_DATA}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "image/png" },
    body: new Uint8Array(png),
  });
  if (!up.ok) throw new Error(`image upload failed: ${up.status} ${await up.text()}`);

  await lineJson(`${API}/user/all/richmenu/${richMenuId}`, { method: "POST" });

  return { richMenuId, buttons: CELLS.map((c) => c.label) };
}
