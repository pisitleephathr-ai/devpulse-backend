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
 * the chat; `web` cells open a page in the app. Mixed by design. `icon` names a
 * white line-icon drawn in the image; `sub` is the English subtitle.
 */
type Cell =
  | { kind: "chat"; label: string; sub: string; icon: IconName; cmd: string; displayText: string }
  | { kind: "web"; label: string; sub: string; icon: IconName; path: string };

/** The 6 buttons, left→right, top→bottom. Row 1 = in-chat, row 2 = open web. */
export const CELLS: Cell[] = [
  { kind: "chat", label: "งานของฉัน", sub: "MY TASKS", icon: "tasks", cmd: "my_tasks", displayText: "งานของฉัน" },
  { kind: "chat", label: "ใครลาวันนี้", sub: "ON LEAVE TODAY", icon: "umbrella", cmd: "leave_today", displayText: "ใครลาวันนี้" },
  { kind: "chat", label: "สถานะรายงานวันนี้", sub: "REPORT STATUS", icon: "chart", cmd: "report_today", displayText: "สถานะรายงานวันนี้" },
  { kind: "web", label: "บอร์ดงาน", sub: "WORK BOARD", icon: "board", path: "/tasks" },
  { kind: "web", label: "ปฏิทินทีม", sub: "TEAM CALENDAR", icon: "calendar", path: "/calendar" },
  { kind: "web", label: "ส่งรายงาน", sub: "SUBMIT REPORT", icon: "pencil", path: "/reports" },
];

/** White line icons (24×24 viewBox, stroked) drawn into the rich-menu image. */
type IconName =
  | "tasks" | "umbrella" | "chart" | "board" | "calendar" | "pencil"
  | "chat" | "external";

const ICON_PATHS: Record<IconName, string> = {
  tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  umbrella: '<path d="M22 12a10.06 10.06 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 13 3-3 3 2 5-6"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v8"/><path d="M12 7v10"/><path d="M16 7v5"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};

/** Place a white line icon centered at (cx, cy) at the given display size. */
function icon(name: IconName, cx: number, cy: number, size: number, sw: number, opacity = 1): string {
  const s = size / 24;
  return `<g transform="translate(${(cx - size / 2).toFixed(1)} ${(cy - size / 2).toFixed(1)}) scale(${s.toFixed(3)})" fill="none" stroke="#ffffff" stroke-opacity="${opacity}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</g>`;
}

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
 * A dark-teal, glassy SVG matching the 2x3 tappable grid, rasterized to PNG by
 * Cloudinary. Translucent glass cards on a teal gradient, each with a white line
 * icon in a soft circle, a Thai label + English subtitle, and a "ตอบในแชท" /
 * "เปิดหน้าเว็บ" tag with its own icon.
 */
function buildSvg(): string {
  const M = 40; // card margin inside each grid cell
  const cards = CELLS.map((cell, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * CELL_W + M;
    const y = row * CELL_H + M;
    const w = CELL_W - M * 2;
    const h = CELL_H - M * 2;
    const cx = x + w / 2;

    const isChat = cell.kind === "chat";
    const iconCy = y + h * 0.33;

    // Tag: a small white icon + text, laid out left-aligned then centered.
    const tagText = isChat ? "ตอบในแชท" : "เปิดหน้าเว็บ";
    const tagIcon: IconName = isChat ? "chat" : "external";
    const tagY = y + h * 0.85;
    const tw = isChat ? 150 : 172; // approx text width at size 44
    const total = 48 + 16 + tw;
    const startX = cx - total / 2;

    return `
      <g>
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="44" fill="#ffffff" fill-opacity="0.10" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2.5"/>
        <circle cx="${cx}" cy="${iconCy}" r="110" fill="#ffffff" fill-opacity="0.16"/>
        ${icon(cell.icon, cx, iconCy, 120, 1.7)}
        <text x="${cx}" y="${y + h * 0.60}" font-size="62" font-family="sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(cell.label)}</text>
        <text x="${cx}" y="${y + h * 0.705}" font-size="30" font-family="sans-serif" font-weight="600" letter-spacing="4" fill="#ffffff" fill-opacity="0.6" text-anchor="middle">${esc(cell.sub)}</text>
        ${icon(tagIcon, startX + 24, tagY, 48, 2)}
        <text x="${(startX + 48 + 16).toFixed(1)}" y="${(tagY + 16).toFixed(1)}" font-size="44" font-family="sans-serif" font-weight="600" fill="#ffffff" fill-opacity="0.9" text-anchor="start">${esc(tagText)}</text>
      </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" viewBox="0 0 ${RICHMENU_WIDTH} ${RICHMENU_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#24a897"/>
        <stop offset="0.55" stop-color="#128577" />
        <stop offset="1" stop-color="#0a6055"/>
      </linearGradient>
    </defs>
    <rect width="${RICHMENU_WIDTH}" height="${RICHMENU_HEIGHT}" fill="url(#bg)"/>
    ${cards}
  </svg>`;
}

/** Configure the Cloudinary SDK from env (throws if credentials are missing). */
function configureCloudinary(): void {
  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    throw new Error("CLOUDINARY_* not set");
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/**
 * Fit a provided image to LINE's rich-menu constraints via Cloudinary: exact
 * 2500×1686 and ≤1MB. Tries progressively smaller encodings (optimized PNG →
 * good JPEG → leaner JPEG) and returns the first that fits.
 */
export async function optimizeForLine(image: Buffer): Promise<Buffer> {
  configureCloudinary();
  const dataUri = `data:image/png;base64,${image.toString("base64")}`;
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    resource_type: "image",
    folder: `${env.CLOUDINARY_UPLOAD_FOLDER || "devpulse"}/system`,
    public_id: "line-richmenu-custom",
    overwrite: true,
    invalidate: true,
  });
  const variants: Record<string, unknown>[] = [
    { format: "png", quality: "auto:good" },
    { format: "jpg", quality: "auto:good" },
    { format: "jpg", quality: 72 },
    { format: "jpg", quality: 58 },
  ];
  for (const v of variants) {
    const url = cloudinary.url(uploaded.public_id, {
      resource_type: "image",
      width: RICHMENU_WIDTH,
      height: RICHMENU_HEIGHT,
      crop: "fill",
      secure: true,
      version: uploaded.version,
      ...v,
    });
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength <= 1_000_000) return buf;
  }
  throw new Error("could not compress the image under LINE's 1MB limit");
}

/** Rasterize the generated SVG via Cloudinary and return the delivered PNG URL. */
export async function generateRichMenuPngUrl(): Promise<string> {
  configureCloudinary();
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
