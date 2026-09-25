/**
 * 合影名单采集系统 · Group Photo Namer
 * 通用模板：一个部署可承载多个合影项目，每个项目独立照片 / 人脸框 / 名单 / 日志。
 *
 * 零依赖后端：Node.js >= 22（内置 node:sqlite + http）
 * 启动：node --experimental-sqlite server.js
 * 环境变量：PORT（默认 8360）、ADMIN_CODE（首次启动的管理员码，不设则随机生成并打印）
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = parseInt(process.env.PORT || "8360", 10);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const COVER = path.join(PUBLIC, "cover.png");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

/* ================= 数据库 ================= */
const db = new DatabaseSync(path.join(DATA, "app.db"));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon BLOB, icon_mime TEXT,
  descr TEXT DEFAULT '',
  version INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  project_id INTEGER PRIMARY KEY, data BLOB, mime TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  x REAL, y REAL, w REAL, h REAL,
  name TEXT DEFAULT '', by TEXT DEFAULT '', at TEXT DEFAULT '', ident TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT, code TEXT, used_by TEXT DEFAULT '', created_at TEXT,
  UNIQUE(project_id, code)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, project_id INTEGER, name TEXT, role TEXT, created_at TEXT, ident TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER, time TEXT, operator TEXT, role TEXT, action TEXT, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_boxes_project ON boxes(project_id);
CREATE INDEX IF NOT EXISTS idx_codes_project ON codes(project_id);
`);
/* 老库平滑升级：补上 identity 字段（用于区分同名成员） */
for (const [t, col] of [["boxes", "ident"], ["sessions", "ident"]]) {
  const cols = db.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
  if (!cols.includes(col)) db.exec("ALTER TABLE " + t + " ADD COLUMN " + col + " TEXT DEFAULT ''");
}

function genCode(n) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(n || 6);
  let s = "";
  for (let i = 0; i < (n || 6); i++) s += chars[bytes[i] % chars.length];
  return s;
}
if (!db.prepare("SELECT value FROM config WHERE key='admin_code'").get()) {
  const init = String(process.env.ADMIN_CODE || genCode(8)).trim() || genCode(8);
  db.prepare("INSERT INTO config VALUES ('admin_code',?)").run(init);
}

const now = () => new Date().toLocaleString("zh-CN", { hour12: false });
function bump(pid) {
  db.prepare("UPDATE projects SET version = version + 1, updated_at = ? WHERE id = ?").run(now(), pid);
}
function version(pid) {
  const r = db.prepare("SELECT version FROM projects WHERE id=?").get(pid);
  return r ? r.version : 0;
}
function addLog(pid, operator, role, action, detail) {
  db.prepare("INSERT INTO logs (project_id,time,operator,role,action,detail) VALUES (?,?,?,?,?,?)")
    .run(pid, now(), operator, role, action, detail || "");
}
function newCode(pid) {
  let c;
  do { c = genCode(6); } while (db.prepare("SELECT id FROM codes WHERE project_id=? AND code=?").get(pid, c));
  return c;
}

/* ================= 工具 ================= */
function readBody(req, limitMb) {
  const max = (limitMb || 60) * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(new Error("请求体过大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function json(res, obj, code) {
  res.writeHead(code || 200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function getSession(req) {
  const token = req.headers["x-token"];
  if (!token) return null;
  return db.prepare("SELECT * FROM sessions WHERE token=?").get(token) || null;
}
/* 登录限流：同一 IP 每分钟最多 15 次尝试 */
const loginHits = new Map();
function limited(ip) {
  const t = Date.now();
  const rec = loginHits.get(ip) || { n: 0, ts: t };
  if (t - rec.ts > 60000) { rec.n = 0; rec.ts = t; }
  rec.n++;
  loginHits.set(ip, rec);
  if (loginHits.size > 5000) loginHits.clear();
  return rec.n > 15;
}
function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.socket.remoteAddress || "-";
}
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function baseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return proto + "://" + (req.headers.host || "localhost");
}
function safeName(s) {
  return String(s || "项目").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

/* 位置排序：先按行（y 中心聚类），行内按 x */
function sortedBoxes(boxes) {
  const arr = boxes.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  if (!arr.length) return [];
  const hs = arr.map((b) => b.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)];
  const rows = [];
  for (const b of arr) {
    const cy = b.y + b.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) < medH * 0.6);
    if (row) { row.items.push(b); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; }
    else rows.push({ cy, items: [b] });
  }
  const out = [];
  rows.forEach((r, ri) => {
    r.items.sort((a, b) => a.x - b.x);
    r.items.forEach((b, bi) => out.push({ box: b, row: ri + 1, col: bi + 1 }));
  });
  return out;
}
function csvCell(v) {
  v = String(v == null ? "" : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function sendCsv(res, filename, header, rows) {
  const body = "﻿" + [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
  });
  res.end(body);
}
function publicProject(p) {
  return { id: p.id, name: p.name, descr: p.descr || "", hasIcon: !!p.icon, updated_at: p.updated_at };
}

/* ================= 路由 ================= */
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const isGet = req.method === "GET" || req.method === "HEAD";

    /* ---- 微信 / 社交分享落地页（服务端渲染 OG 信息） ---- */
    const mShare = p.match(/^\/p\/(\d+)\/?$/);
    if (mShare && isGet) {
      const proj = db.prepare("SELECT * FROM projects WHERE id=?").get(parseInt(mShare[1], 10));
      if (!proj) { res.writeHead(404); res.end("项目不存在"); return; }
      const base = baseUrl(req);
      const img = proj.icon ? (base + "/api/project/" + proj.id + "/icon") : (base + "/cover.png");
      const desc = (proj.descr || "").trim() || ("打开填写你在合影中的位置与姓名 · " + proj.name);
      const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(proj.name)} · 合影名单采集</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="合影名单采集">
<meta property="og:title" content="${esc(proj.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(base + "/p/" + proj.id)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(proj.name)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc("/?p=" + proj.id)}">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f6f8f7;color:#333">
<div style="text-align:center">
  <div style="font-size:18px;font-weight:600;margin-bottom:8px">${esc(proj.name)}</div>
  <div style="font-size:14px;color:#666">正在打开合影名单采集…</div>
  <div style="margin-top:14px"><a href="${esc("/?p=" + proj.id)}" style="color:#0b5c3f">如果没有自动跳转，点这里</a></div>
</div>
</body></html>`;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(html);
      return;
    }

    /* ---- 静态文件 ---- */
    if (isGet && !p.startsWith("/api/")) {
      let fp = p === "/" ? "/index.html" : p;
      const full = path.join(PUBLIC, path.normalize(fp));
      if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404); res.end("Not Found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(full).pipe(res);
      return;
    }

    /* ---- 项目图标（公开，用于分享预览图） ---- */
    const mIcon = p.match(/^\/api\/project\/(\d+)\/icon$/);
    if (mIcon && isGet) {
      const proj = db.prepare("SELECT icon, icon_mime, name FROM projects WHERE id=?").get(parseInt(mIcon[1], 10));
      if (proj && proj.icon) {
        res.writeHead(200, { "Content-Type": proj.icon_mime || "image/png", "Cache-Control": "public, max-age=3600" });
        res.end(proj.icon);
      } else if (fs.existsSync(COVER)) {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" });
        fs.createReadStream(COVER).pipe(res);
      } else {
        res.writeHead(404); res.end();
      }
      return;
    }

    /* ---- 公开项目列表（登录页选择项目用） ---- */
    if (p === "/api/projects/public" && isGet) {
      const list = db.prepare("SELECT * FROM projects ORDER BY id DESC").all();
      json(res, { projects: list.map(publicProject) });
      return;
    }

    /* ---- 导入模板（公开下载） ---- */
    if (p === "/api/template" && isGet) {
      const body = "﻿姓名,验证码\n张三,\n李四,\n王五,\n";
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent("名单导入模板.csv"),
      });
      res.end(body);
      return;
    }

    /* ---- 登录（无需 token） ---- */
    if (p === "/api/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (limited(ip)) { json(res, { error: "尝试过于频繁，请 1 分钟后再试" }, 429); return; }
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const name = String(body.name || "").trim();
      const code = String(body.code || "").trim();
      const pid = parseInt(body.projectId || "0", 10);
      if (!name || !code) { json(res, { error: "请输入姓名和验证码" }, 400); return; }
      const adminCode = db.prepare("SELECT value FROM config WHERE key='admin_code'").get().value;
      let role = null, projectId = null, ident = "";
      if (code === adminCode) {
        role = "admin";
        ident = "a:" + name;
        if (pid) {
          const pr = db.prepare("SELECT id FROM projects WHERE id=?").get(pid);
          if (pr) projectId = pr.id;
        }
      } else {
        if (!pid) { json(res, { error: "请先选择项目" }, 400); return; }
        const proj = db.prepare("SELECT id FROM projects WHERE id=?").get(pid);
        if (!proj) { json(res, { error: "项目不存在" }, 404); return; }
        const row = db.prepare("SELECT * FROM codes WHERE project_id=? AND code=?").get(pid, code);
        if (!row) { json(res, { error: "验证码无效，请与管理员核对" }, 403); return; }
        if (row.name && row.name !== name) {
          json(res, { error: "姓名与验证码不匹配（该验证码分配给：" + row.name + "）" }, 403); return;
        }
        role = "member";
        projectId = pid;
        ident = "c" + row.id;      // 以验证码记录为身份，重名也能区分
        if (!row.used_by) {
          db.prepare("UPDATE codes SET used_by=? WHERE id=?").run(name, row.id);
          addLog(pid, name, role, "成员首次验证", "使用分配给「" + (row.name || "未指定") + "」的验证码");
        }
      }
      const token = crypto.randomBytes(24).toString("hex");
      db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?)").run(token, projectId, name, role, now(), ident);
      if (projectId) addLog(projectId, name, role, role === "admin" ? "管理员登录" : "成员登录", "");
      const proj = projectId ? db.prepare("SELECT * FROM projects WHERE id=?").get(projectId) : null;
      json(res, {
        token, role, name, projectId,
        project: proj ? publicProject(proj) : null,
        needProject: role === "admin" && !projectId,
      });
      return;
    }

    /* ---- 以下全部需要登录 ---- */
    const sess = getSession(req);
    if (!sess) { json(res, { error: "未登录或会话已过期" }, 401); return; }
    const isAdmin = sess.role === "admin";

    /* 管理员：项目列表 / 新建 */
    if (p === "/api/projects" && isGet) {
      if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }
      const list = db.prepare("SELECT * FROM projects ORDER BY id DESC").all();
      const out = list.map((pr) => {
        const boxes = db.prepare("SELECT COUNT(*) n FROM boxes WHERE project_id=?").get(pr.id).n;
        const named = db.prepare("SELECT COUNT(*) n FROM boxes WHERE project_id=? AND name<>''").get(pr.id).n;
        const members = db.prepare("SELECT COUNT(*) n FROM codes WHERE project_id=?").get(pr.id).n;
        const photo = db.prepare("SELECT 1 FROM photos WHERE project_id=?").get(pr.id);
        return Object.assign(publicProject(pr), { boxes, named, members, hasPhoto: !!photo });
      });
      json(res, { projects: out });
      return;
    }
    if (p === "/api/projects" && req.method === "POST") {
      if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const name = String(body.name || "").trim();
      if (!name) { json(res, { error: "请填写项目名称" }, 400); return; }
      let icon = null, iconMime = null;
      const m = String(body.iconDataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
      if (m) { icon = Buffer.from(m[2], "base64"); iconMime = m[1]; }
      const r = db.prepare("INSERT INTO projects (name,icon,icon_mime,descr,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run(name, icon, iconMime, String(body.descr || "").trim(), now(), now());
      const id = Number(r.lastInsertRowid);
      addLog(id, sess.name, "admin", "新建项目", name);
      json(res, { ok: true, id, project: publicProject(db.prepare("SELECT * FROM projects WHERE id=?").get(id)) });
      return;
    }
    const mProj = p.match(/^\/api\/projects\/(\d+)$/);
    if (mProj && req.method === "PUT") {
      if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }
      const id = parseInt(mProj[1], 10);
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const pr = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!pr) { json(res, { error: "项目不存在" }, 404); return; }
      const name = body.name == null ? pr.name : String(body.name).trim();
      const descr = body.descr == null ? pr.descr : String(body.descr).trim();
      let icon = pr.icon, iconMime = pr.icon_mime;
      if (body.iconDataUrl === "") { icon = null; iconMime = null; }
      else if (body.iconDataUrl) {
        const m = String(body.iconDataUrl).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
        if (m) { icon = Buffer.from(m[2], "base64"); iconMime = m[1]; }
      }
      if (!name) { json(res, { error: "项目名称不能为空" }, 400); return; }
      db.prepare("UPDATE projects SET name=?, descr=?, icon=?, icon_mime=?, updated_at=? WHERE id=?")
        .run(name, descr, icon, iconMime, now(), id);
      addLog(id, sess.name, "admin", "修改项目", name);
      json(res, { ok: true, project: publicProject(db.prepare("SELECT * FROM projects WHERE id=?").get(id)) });
      return;
    }
    if (mProj && req.method === "DELETE") {
      if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }
      const id = parseInt(mProj[1], 10);
      db.prepare("DELETE FROM projects WHERE id=?").run(id);
      db.prepare("DELETE FROM photos WHERE project_id=?").run(id);
      db.prepare("DELETE FROM boxes WHERE project_id=?").run(id);
      db.prepare("DELETE FROM codes WHERE project_id=?").run(id);
      db.prepare("DELETE FROM logs WHERE project_id=?").run(id);
      db.prepare("UPDATE sessions SET project_id=NULL WHERE project_id=?").run(id);
      json(res, { ok: true });
      return;
    }
    /* 管理员切换当前项目 */
    if (p === "/api/session/project" && req.method === "POST") {
      if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const id = parseInt(body.projectId || "0", 10);
      const pr = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
      if (!pr) { json(res, { error: "项目不存在" }, 404); return; }
      db.prepare("UPDATE sessions SET project_id=? WHERE token=?").run(id, sess.token);
      json(res, { ok: true, project: publicProject(pr) });
      return;
    }

    /* ---- 当前项目上下文 ---- */
    let pid = sess.project_id;
    if (!pid) {
      if (p === "/api/state" && isGet) { json(res, { noProject: true, role: sess.role, name: sess.name }); return; }
      json(res, { error: "请先选择或新建一个项目", needProject: true }, 400);
      return;
    }
    const proj = db.prepare("SELECT * FROM projects WHERE id=?").get(pid);
    if (!proj) { json(res, { error: "项目不存在" }, 404); return; }

    /* 当前项目信息 */
    if (p === "/api/project" && isGet) {
      json(res, { project: publicProject(proj) });
      return;
    }

    /* 状态（含轻量轮询） */
    if (p === "/api/state" && isGet) {
      const v = version(pid);
      const since = parseInt(u.searchParams.get("v") || "-1", 10);
      if (since === v) { json(res, { same: true, version: v }); return; }
      const boxes = db.prepare("SELECT id,project_id,x,y,w,h,name,by,at FROM boxes WHERE project_id=? ORDER BY id").all(pid);
      const photo = db.prepare("SELECT mime, updated_at FROM photos WHERE project_id=?").get(pid);
      const total = boxes.length;
      const named = boxes.filter((b) => (b.name || "").trim()).length;
      const memberCount = db.prepare("SELECT COUNT(*) n FROM codes WHERE project_id=?").get(pid).n;
      const filledNames = new Set(boxes.filter((b) => (b.name || "").trim()).map((b) => String(b.name).trim()));
      const pending = db.prepare("SELECT name FROM codes WHERE project_id=?").all(pid)
        .filter((c) => !filledNames.has(String(c.name || "").trim())).length;
      json(res, {
        same: false, version: v, boxes,
        hasPhoto: !!photo, photoAt: photo ? photo.updated_at : null,
        role: sess.role, name: sess.name,
        project: publicProject(proj),
        stats: { total, named, todo: total - named, members: memberCount, pending },
      });
      return;
    }

    /* 照片（本项目已登录用户可查看） */
    if (p === "/api/photo" && isGet) {
      const photo = db.prepare("SELECT data, mime FROM photos WHERE project_id=?").get(pid);
      if (!photo) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": photo.mime, "Cache-Control": "no-cache" });
      res.end(photo.data);
      return;
    }

    /* 填写姓名（member 与 admin 均可；member 只能填空框或自己填的） */
    const mName = p.match(/^\/api\/box\/(\d+)\/name$/);
    if (mName && req.method === "PUT") {
      const id = parseInt(mName[1], 10);
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const val = String(body.name || "").trim();
      const box = db.prepare("SELECT * FROM boxes WHERE id=? AND project_id=?").get(id, pid);
      if (!box) { json(res, { error: "人脸框不存在" }, 404); return; }
      if (!isAdmin && box.name) {
        /* 只能改自己填过的位置：优先按身份判定（区分同名成员），老数据回退到姓名比对 */
        const mine = box.ident ? box.ident === (sess.ident || "") : box.by === sess.name;
        if (!mine) { json(res, { error: "该位置已由「" + box.by + "」填写，如需修改请联系管理员" }, 403); return; }
      }
      db.prepare("UPDATE boxes SET name=?, by=?, at=?, ident=? WHERE id=?")
        .run(val, val ? sess.name : "", val ? now() : "", val ? (sess.ident || "") : "", id);
      bump(pid);
      addLog(pid, sess.name, sess.role, val ? "填写姓名" : "清除姓名", "#" + id + " → " + (val || "（清除）"));
      json(res, { ok: true });
      return;
    }

    /* ================= 管理员专属 ================= */
    if (!isAdmin) { json(res, { error: "仅管理员可操作" }, 403); return; }

    if (p === "/api/photo" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 80)).toString() || "{}");
      const m = String(body.dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
      if (!m) { json(res, { error: "图片格式不支持" }, 400); return; }
      const buf = Buffer.from(m[2], "base64");
      db.prepare("INSERT INTO photos (project_id,data,mime,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data, mime=excluded.mime, updated_at=excluded.updated_at")
        .run(pid, buf, m[1], now());
      db.prepare("DELETE FROM boxes WHERE project_id=?").run(pid);
      bump(pid);
      addLog(pid, sess.name, sess.role, "上传合影", (buf.length / 1024 / 1024).toFixed(2) + " MB，已清空旧标注");
      json(res, { ok: true });
      return;
    }
    if (p === "/api/photo" && req.method === "DELETE") {
      db.prepare("DELETE FROM photos WHERE project_id=?").run(pid);
      db.prepare("DELETE FROM boxes WHERE project_id=?").run(pid);
      bump(pid);
      addLog(pid, sess.name, sess.role, "删除合影", "");
      json(res, { ok: true });
      return;
    }

    if (p === "/api/boxes/bulk" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const list = Array.isArray(body.boxes) ? body.boxes : [];
      const ins = db.prepare("INSERT INTO boxes (project_id,x,y,w,h) VALUES (?,?,?,?,?)");
      const exist = db.prepare("SELECT * FROM boxes WHERE project_id=?").all(pid);
      let added = 0;
      for (const b of list) {
        const dup = exist.some((e) => {
          const x1 = Math.max(e.x, b.x), y1 = Math.max(e.y, b.y);
          const x2 = Math.min(e.x + e.w, b.x + b.w), y2 = Math.min(e.y + e.h, b.y + b.h);
          if (x2 <= x1 || y2 <= y1) return false;
          const inter = (x2 - x1) * (y2 - y1);
          return inter / (e.w * e.h + b.w * b.h - inter) > 0.4;
        });
        if (!dup) {
          ins.run(pid, b.x, b.y, b.w, b.h);
          exist.push({ x: b.x, y: b.y, w: b.w, h: b.h });   // 同一批内的重叠也要去重
          added++;
        }
      }
      bump(pid);
      addLog(pid, sess.name, sess.role, "自动识别", "提交 " + list.length + " 框，新增 " + added);
      json(res, { ok: true, added });
      return;
    }
    if (p === "/api/box" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const r = db.prepare("INSERT INTO boxes (project_id,x,y,w,h) VALUES (?,?,?,?,?)")
        .run(pid, body.x, body.y, body.w, body.h);
      bump(pid);
      addLog(pid, sess.name, sess.role, "手动添加框", "#" + r.lastInsertRowid);
      json(res, { ok: true, id: Number(r.lastInsertRowid) });
      return;
    }
    const mBox = p.match(/^\/api\/box\/(\d+)$/);
    if (mBox && req.method === "PUT") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      db.prepare("UPDATE boxes SET x=?, y=?, w=?, h=? WHERE id=? AND project_id=?")
        .run(body.x, body.y, body.w, body.h, parseInt(mBox[1], 10), pid);
      bump(pid);
      json(res, { ok: true });
      return;
    }
    if (mBox && req.method === "DELETE") {
      db.prepare("DELETE FROM boxes WHERE id=? AND project_id=?").run(parseInt(mBox[1], 10), pid);
      bump(pid);
      addLog(pid, sess.name, sess.role, "删除人脸框", "#" + mBox[1]);
      json(res, { ok: true });
      return;
    }

    /* ---------- 名单与验证码（允许重名，验证码项目内唯一） ---------- */
    if (p === "/api/codes" && isGet) {
      json(res, { codes: db.prepare("SELECT * FROM codes WHERE project_id=? ORDER BY id").all(pid) });
      return;
    }
    if (p === "/api/codes" && req.method === "POST") {
      /* 批量粘贴姓名生成验证码 */
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const names = String(body.names || "").split(/[\n,，;；]+/).map((s) => s.trim()).filter(Boolean);
      const ins = db.prepare("INSERT INTO codes (project_id,name,code,created_at) VALUES (?,?,?,?)");
      const out = [];
      for (const n of names) {           // 不做姓名查重：同名不同码也要各占一条
        const c = newCode(pid);
        ins.run(pid, n, c, now());
        out.push({ name: n, code: c });
      }
      bump(pid);
      addLog(pid, sess.name, sess.role, "批量生成验证码", out.length + " 条");
      json(res, { ok: true, created: out });
      return;
    }
    if (p === "/api/codes/add" && req.method === "POST") {
      /* 手动新增一人 */
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const nm = String(body.name || "").trim();
      if (!nm) { json(res, { error: "请填写姓名" }, 400); return; }
      let c = String(body.code || "").trim();
      if (c && db.prepare("SELECT id FROM codes WHERE project_id=? AND code=?").get(pid, c)) {
        c = newCode(pid);   // 验证码冲突 → 自动换一个
      }
      if (!c) c = newCode(pid);
      const r = db.prepare("INSERT INTO codes (project_id,name,code,created_at) VALUES (?,?,?,?)").run(pid, nm, c, now());
      bump(pid);
      addLog(pid, sess.name, sess.role, "新增名单成员", nm + " / " + c);
      json(res, { ok: true, id: Number(r.lastInsertRowid), code: c });
      return;
    }
    if (p === "/api/codes/import" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const ins = db.prepare("INSERT INTO codes (project_id,name,code,created_at) VALUES (?,?,?,?)");
      let created = 0;
      const skipped = [];
      for (const r of rows) {
        const nm = String(r.name || "").trim();
        if (!nm) continue;
        let c = String(r.code || "").trim();
        if (c && db.prepare("SELECT id FROM codes WHERE project_id=? AND code=?").get(pid, c)) {
          skipped.push(nm + "（验证码 " + c + " 已存在，已自动更换）");
          c = "";
        }
        if (!c) c = newCode(pid);
        ins.run(pid, nm, c, now());
        created++;
      }
      bump(pid);
      addLog(pid, sess.name, sess.role, "导入名单", "新增 " + created + " 条，跳过 " + skipped.length);
      json(res, { ok: true, created, skipped });
      return;
    }
    const mCode = p.match(/^\/api\/codes\/(\d+)$/);
    if (mCode && req.method === "PUT") {
      /* 修改姓名 / 验证码 */
      const id = parseInt(mCode[1], 10);
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const row = db.prepare("SELECT * FROM codes WHERE id=? AND project_id=?").get(id, pid);
      if (!row) { json(res, { error: "记录不存在" }, 404); return; }
      const nm = body.name == null ? row.name : String(body.name).trim();
      let c = body.code == null ? row.code : String(body.code).trim();
      if (!nm) { json(res, { error: "姓名不能为空" }, 400); return; }
      if (!c) c = newCode(pid);
      if (c !== row.code && db.prepare("SELECT id FROM codes WHERE project_id=? AND code=?").get(pid, c)) {
        json(res, { error: "验证码 " + c + " 已被占用" }, 400); return;
      }
      db.prepare("UPDATE codes SET name=?, code=? WHERE id=?").run(nm, c, id);
      bump(pid);
      addLog(pid, sess.name, sess.role, "修改名单成员", row.name + " → " + nm + " / " + c);
      json(res, { ok: true, code: c });
      return;
    }
    if (mCode && req.method === "DELETE") {
      db.prepare("DELETE FROM codes WHERE id=? AND project_id=?").run(parseInt(mCode[1], 10), pid);
      bump(pid);
      addLog(pid, sess.name, sess.role, "删除名单成员", "#" + mCode[1]);
      json(res, { ok: true });
      return;
    }

    /* 修改管理员码 */
    if (p === "/api/admin/password" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const cur = db.prepare("SELECT value FROM config WHERE key='admin_code'").get().value;
      if (body.oldCode !== cur) { json(res, { error: "当前管理员码不正确" }, 403); return; }
      const nc = String(body.newCode || "").trim();
      if (nc.length < 4) { json(res, { error: "新管理员码至少 4 位" }, 400); return; }
      db.prepare("UPDATE config SET value=? WHERE key='admin_code'").run(nc);
      json(res, { ok: true });
      return;
    }

    /* ---------- 导出 ---------- */
    const fileTag = safeName(proj.name);
    if (p === "/api/export/names" && isGet) {
      const boxes = db.prepare("SELECT * FROM boxes WHERE project_id=? ORDER BY id").all(pid);
      const sorted = sortedBoxes(boxes);
      sendCsv(res, fileTag + "_合影名单.csv",
        ["排", "位次", "姓名", "填写人", "填写时间"],
        sorted.map((it) => [it.row, it.col, it.box.name || "（未填写）", it.box.by || "-", it.box.at || "-"]));
      addLog(pid, sess.name, sess.role, "导出名单", sorted.length + " 条");
      return;
    }
    if (p === "/api/export/pending" && isGet) {
      /* 尚未填写的人员名单（名单里有、但照片上还没出现该姓名） */
      const codes = db.prepare("SELECT * FROM codes WHERE project_id=? ORDER BY id").all(pid);
      const filled = new Set(db.prepare("SELECT name FROM boxes WHERE project_id=? AND name<>''").all(pid)
        .map((b) => String(b.name).trim()));
      sendCsv(res, fileTag + "_未填写人员.csv",
        ["姓名", "验证码", "是否已登录", "状态"],
        codes.filter((c) => !filled.has(String(c.name || "").trim()))
          .map((c) => [c.name, c.code, c.used_by ? "已登录" : "未登录", "尚未填写"]));
      addLog(pid, sess.name, sess.role, "导出未填写人员", "");
      return;
    }
    if (p === "/api/export/unnamed" && isGet) {
      /* 照片上还没填姓名的位置 */
      const boxes = db.prepare("SELECT * FROM boxes WHERE project_id=? ORDER BY id").all(pid);
      const sorted = sortedBoxes(boxes).filter((it) => !(it.box.name || "").trim());
      sendCsv(res, fileTag + "_待填写位置.csv",
        ["排", "位次", "状态"], sorted.map((it) => [it.row, it.col, "尚未填写"]));
      addLog(pid, sess.name, sess.role, "导出待填写位置", sorted.length + " 个");
      return;
    }
    if (p === "/api/export/codes" && isGet) {
      const codes = db.prepare("SELECT * FROM codes WHERE project_id=? ORDER BY id").all(pid);
      sendCsv(res, fileTag + "_验证码清单.csv", ["姓名", "验证码", "是否已使用", "使用人"],
        codes.map((c) => [c.name, c.code, c.used_by ? "已使用" : "未使用", c.used_by || "-"]));
      return;
    }
    if (p === "/api/export/logs" && isGet) {
      const logs = db.prepare("SELECT * FROM logs WHERE project_id=? ORDER BY id").all(pid);
      sendCsv(res, fileTag + "_操作日志.csv", ["时间", "操作人", "角色", "动作", "详情"],
        logs.map((l) => [l.time, l.operator, l.role, l.action, l.detail]));
      return;
    }

    json(res, { error: "接口不存在" }, 404);
  } catch (err) {
    json(res, { error: "服务器错误：" + err.message }, 500);
  }
});

server.listen(PORT, () => {
  const code = db.prepare("SELECT value FROM config WHERE key='admin_code'").get().value;
  console.log("合影名单采集系统已启动: http://localhost:" + PORT);
  console.log("管理员码: " + code + "（可在网页右上角「管理员码」里修改，或用环境变量 ADMIN_CODE 预设）");
});
