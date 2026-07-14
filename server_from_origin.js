const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || DIR;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");

// ======================== 静态密钥（陌生IP登录验证） ========================
const STATIC_KEY = "133900923@";

// ======================== SSE 实时推送 ========================
const sseClients = [];
const captchaStore = {};


// ======================== 安全限速 ========================
var rateLimitStore = {};
var REGISTER_COOLDOWN = {};
setInterval(function() {
  var now = Date.now();
  Object.keys(rateLimitStore).forEach(function(ip) {
    if (now - rateLimitStore[ip].windowStart > 3600000) delete rateLimitStore[ip];
  });
  Object.keys(REGISTER_COOLDOWN).forEach(function(ip) {
    if (now - REGISTER_COOLDOWN[ip] > 3600000) delete REGISTER_COOLDOWN[ip];
  });
}, 600000);

function checkRateLimit(ip, maxTimes, windowMs) {
  if (!ip) return { ok: true };
  var now = Date.now();
  if (!rateLimitStore[ip] || now - rateLimitStore[ip].windowStart > windowMs) {
    rateLimitStore[ip] = { count: 1, windowStart: now };
    return { ok: true, remaining: maxTimes - 1 };
  }
  rateLimitStore[ip].count++;
  if (rateLimitStore[ip].count > maxTimes) return { ok: false, remaining: 0 };
  return { ok: true, remaining: maxTimes - rateLimitStore[ip].count };
}
const sessions = {};

// ================== Auth helper ==================
function getAuthUser(req) {
  var t = (req.headers["authorization"] || "").replace("Bearer ", "");
  var s = sessions[t];
  if (!s || s.expires < Date.now()) { delete sessions[t]; return null; }
  var user = db.getUserById(s.userId);
  if (user && user.status === "disabled") return null;
  return user || null;
}



// ======================== 获取客户端IP ========================
function getClientIP(req) {
  var xff = req.headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0].trim();
  var realIp = req.headers["x-real-ip"];
  if (realIp) return realIp.trim();
  return req.socket.remoteAddress || req.connection.remoteAddress || "127.0.0.1";
}

function requireRole(au, roles) {
  if (!au) return false;
  if (au.status === "disabled") return false;
  return roles.indexOf(au.role) >= 0;
}

function sseBroadcast(event, data) {
  const msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].res.write(msg); } catch { sseClients.splice(i, 1); }
  }
}

// ======================== MIME 类型 ========================
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4"
};

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("文件未找到");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function handleStatic(p, res) {
  if (p === "/" || p === "") return serveFile(path.join(DIR, "public", "index.html"), res);
  if (p === "/admin" || p === "/admin/") return serveFile(path.join(DIR, "admin", "index.html"), res);
  if (p.startsWith("/uploads/")) return serveFile(path.join(UPLOAD_DIR, p.replace("/uploads/", "")), res);
  if (p.startsWith("/admin/")) return serveFile(path.join(DIR, p), res);
  serveFile(path.join(DIR, "public", p), res);
}

// ======================== 请求体解析 ========================
function parseJSON(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve(null); }
    });
  });
}

function parseMultipart(req) {
  return new Promise((resolve) => {
    const boundary = "--" + req.headers["content-type"].split("boundary=")[1];
    let raw = Buffer.alloc(0);
    req.on("data", c => raw = Buffer.concat([raw, c]));
    req.on("end", () => {
      const result = {};
      const parts = raw.toString("binary").split(boundary);
      for (const part of parts) {
        if (!part.includes("Content-Disposition")) continue;
        const n = part.match(/name="([^"]+)"/);
        if (!n) continue;
        const name = n[1];
        const headerEnd = part.indexOf("\r\n\r\n") + 4;
        var endIdx = part.lastIndexOf("\r\n"); if (endIdx < headerEnd) endIdx = part.length;
        if (part.includes("filename")) {
          const fname = (part.match(/filename="([^"]+)"/) || ["", "file"])[1];
          const saved = Date.now() + "-" + crypto.randomBytes(4).toString("hex") + path.extname(fname);
          fs.writeFileSync(path.join(UPLOAD_DIR, saved), part.substring(headerEnd, endIdx), "binary");
          result[name] = "/uploads/" + saved;
        } else {
          result[name] = part.substring(headerEnd, endIdx).trim();
        }
      }
      resolve(result);
    });
    req.on("error", () => resolve(null));
  });
}

// ======================== API 路由 ========================
async function handleAPI(req, res) {
  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const method = req.method.toUpperCase();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  function json(d, s) {
    const code = s || 200;
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(d));
  }

  try {
    // SSE 事件流
    if (u.pathname === "/api/events" && method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("data: connected\n\n");
      const client = { id: Date.now(), res };
      sseClients.push(client);
      req.on("close", () => {
        const idx = sseClients.indexOf(client);
        if (idx >= 0) sseClients.splice(idx, 1);
      });
      return;
    }

    // 分类
    if (u.pathname === "/api/categories" && method === "GET") {
      return json(db.getCategories());
    }

    // 菜品列表 / 单个菜品
    if (u.pathname === "/api/menu-items" && method === "GET") {
      return json(db.getMenuItems(u.searchParams.get("category_id")));
    }

    const menuId = (u.pathname.match(/^\/api\/menu-items\/(\d+)$/) || [])[1];
    if (menuId && method === "GET") {
      const item = db.getMenuItem(parseInt(menuId));
      return item ? json(item) : json({ error: "未找到" }, 404);
    }

    // 新增菜品
    if (u.pathname === "/api/menu-items" && method === "POST") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
      const body = req.headers["content-type"]?.includes("multipart")
        ? await parseMultipart(req) : await parseJSON(req);
      if (!body || !body.name || !body.price) {
        return json({ error: "请填写完整信息" }, 400);
      }
      const item = db.createMenuItem(
        parseInt(body.category_id), body.name,
        parseFloat(body.price), body.description, body.image
      );
      sseBroadcast("menu_update", { type: "add", item });
      return json(item, 201);
    }

    // 修改菜品
    if (menuId && method === "PUT") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
      const body = req.headers["content-type"]?.includes("multipart")
        ? await parseMultipart(req) : await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      const fields = {};
      if (body.name) fields.name = body.name;
      if (body.price) fields.price = parseFloat(body.price);
      if (body.description !== undefined) fields.description = body.description;
      if (body.image) fields.image = body.image;
      if (body.is_available !== undefined) fields.is_available = parseInt(body.is_available);
      const item = db.updateMenuItem(parseInt(menuId), fields);
      if (!item) return json({ error: "未找到" }, 404);
      sseBroadcast("menu_update", { type: "update", item });
      return json(item);
    }

    // 删除菜品
    if (menuId && method === "DELETE") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
      db.deleteMenuItem(parseInt(menuId));
      sseBroadcast("menu_update", { type: "delete", id: parseInt(menuId) });
      return json({ success: true });
    }

    // 订单列表
    if (u.pathname === "/api/orders" && method === "GET") {
      var au = getAuthUser(req);
      var userId = null;
      if (au && au.role !== "admin") userId = au.id;
      return json(db.getOrders(u.searchParams.get("status"), userId));
    }

    // 创建订单
    if (u.pathname === "/api/orders" && method === "POST") {
      const body = await parseJSON(req);
      if (!body || !body.menu_item_id) {
        return json({ error: "请选择菜品" }, 400);
      }
      var au2 = getAuthUser(req);
      if (!au2) return json({ error: "请先登录后再下单" }, 401);
      var uid = au2.id;
      const order = db.createOrder(
        body.menu_item_id, body.customer_name,
        body.customer_contact, body.quantity, body.remark, uid
      );
      if (!order) return json({ error: "菜品不存在" }, 404);
      sseBroadcast("new_order", order);
      return json(order, 201);
    }

    // 更新订单状态
    const osMatch = u.pathname.match(/^\/api\/orders\/(\d+)\/status$/);
    if (osMatch && method === "PUT") {
      const body = await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      const order = db.updateOrderStatus(parseInt(osMatch[1]), body.status);
      if (!order) return json({ error: "未找到" }, 404);
      sseBroadcast("order_update", order);
      return json(order);
    }

    // 删除订单
    const odMatch = u.pathname.match(/^\/api\/orders\/(\d+)$/);
    if (odMatch && method === "DELETE") {
      db.deleteOrder(parseInt(odMatch[1]));
      return json({ success: true });
    }

    // 消费记录
    if (u.pathname === "/api/consumption" && method === "GET") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
      return json(db.getConsumptionRecords());
    }

    
    // 新建消费记录
    if (u.pathname === "/api/consumption" && method === "POST") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
      var body = await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      var rec = db.createConsumptionRecord(body);
      return json(rec, 201);
    }
    var crMatch = u.pathname.match(/^\/api\/consumption\/(\d+)$/);
    if (crMatch && method === "PUT") {
      var au_consumption = getAuthUser(req); if (!requireRole(au_consumption, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
      var body = await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      var rec = db.updateConsumptionRecord(parseInt(crMatch[1]), body);
      if (!rec) return json({ error: "记录不存在" }, 404);
      return json(rec);
    }
    if (crMatch && method === "DELETE") {
      var au_consumption_del = getAuthUser(req); if (!requireRole(au_consumption_del, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
      db.deleteConsumptionRecord(parseInt(crMatch[1]));
      return json({ success: true });
    }

    // 聊天消息
    const chatMatch = u.pathname.match(/^\/api\/chat\/(\d+)$/);
    if (chatMatch && method === "GET") {
      return json(db.getChatMessages(parseInt(chatMatch[1])));
    }
    if (chatMatch && method === "POST") {
      const ct = req.headers["content-type"] || "";
      const body = ct.includes("multipart") ? await parseMultipart(req) : await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      const msg = db.addChatMessage(parseInt(chatMatch[1]), body.sender, body.message || "", body.image || "");
      sseBroadcast("chat_message", msg);
      return json(msg, 201);
    }

    // 图片上传
    if (u.pathname === "/api/upload" && method === "POST") {
      const body = await parseMultipart(req);
      if (body?.image) return json({ url: body.image });
      return json({ error: "请选择图片" }, 400);
    }

    
  
  // ================== 上传分类图片 ==================
  if (u.pathname.match(/^\/api\/categories\/(\d+)\/image$/) && method === "POST") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var cid = parseInt(u.pathname.match(/^\/api\/categories\/(\d+)\/image$/)[1]);
    var body = await parseMultipart(req);
    if (!body || !body.image) return json({ error: "请上传图片" }, 400);
    var result = db.updateCategoryImage(cid, body.image);
    if (!result) return json({ error: "分类不存在" }, 404);
    sseBroadcast("menu_update", { type: "category_update", item: result });
    return json(result);
  }
  if (u.pathname.match(/^\/api\/categories\/(\d+)$/) && method === "PUT") { var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var body = await parseJSON(req);
    if (!body) return json({ error: "请求格式错误" }, 400);
    var cid = parseInt(u.pathname.match(/^\/api\/categories\/(\d+)$/)[1]);
    var fields = {};
    if (body.name) fields.name = body.name;
    if (body.icon !== undefined) fields.icon = body.icon;
    if (body.image !== undefined) fields.image = body.image;
    var result = db.updateCategory(cid, fields);
    if (!result) return json({ error: "分类不存在" }, 404);
    sseBroadcast("menu_update", { type: "category_update", item: result });
    return json(result);
  }

  // ================== 验证码 ==================
  if (u.pathname === "/api/auth/captcha" && method === "GET") {
    var clIpCap = getClientIP(req);
    var capLimit = checkRateLimit(clIpCap, 10, 60000);
    if (!capLimit.ok) return json({ error: "验证码获取太频繁，请稍后再试" }, 429);
    var code = Math.floor(100000 + Math.random() * 900000).toString();
    var captchaId = crypto.randomUUID();
    captchaStore[captchaId] = { code: code, expires: Date.now() + 300000 };
    setTimeout(function() { delete captchaStore[captchaId]; }, 300000);
    return json({ id: captchaId, code: code });
  }

  // ================== 注册 ==================
  if (u.pathname === "/api/auth/register" && method === "POST") {
    var body = await parseJSON(req);
    if (!body || !body.username || !body.password || !body.captcha_id || !body.captcha) {
      return json({ error: "请填写完整信息" }, 400);
    }
    var clIpReg = getClientIP(req);
    var regLimit = checkRateLimit(clIpReg, 3, 3600000);
    if (!regLimit.ok) return json({ error: "注册太频繁，请1小时后再试" }, 429);
    var lastReg = REGISTER_COOLDOWN[clIpReg];
    if (lastReg && Date.now() - lastReg < 60000) {
      var waitSec = Math.ceil((60000 - (Date.now() - lastReg)) / 1000);
      return json({ error: "注册太频繁，请" + waitSec + "秒后再试" }, 429);
    }
    // 后端注册校验
    if (body.username.length < 2) return json({ error: "用户名至少2个字符" }, 400);
    if (body.password.length < 4) return json({ error: "密码至少4个字符" }, 400);
    if (body.password.length > 50) return json({ error: "密码不能超过50个字符" }, 400);
    if (body.username.length > 20) return json({ error: "用户名不能超过20个字符" }, 400);
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(body.username)) return json({ error: "用户名只能包含字母、数字、下划线和中文" }, 400);
    if (body.email) {
      if (body.email.length > 100) return json({ error: "邮箱不能超过100个字符" }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return json({ error: "邮箱格式不正确" }, 400);
    }
    if (body.email) {
      var allUsers = db.getAllUsers();
      for (var i = 0; i < allUsers.length; i++) {
        if (allUsers[i].email === body.email) return json({ error: "该邮箱已被绑定" }, 409);
      }
    }
    var cd = captchaStore[body.captcha_id];
    if (!cd || cd.code !== body.captcha || cd.expires < Date.now()) {
      delete captchaStore[body.captcha_id];
      return json({ error: "验证码错误或已过期" }, 400);
    }
    delete captchaStore[body.captcha_id];
    var user = db.createUser(body.username, body.password, body.email || "", "customer");
    if (!user) return json({ error: "用户名已存在" }, 409);
    if (user.role === "super_admin" && user.username === "admin") { db.updateUser(user.id, { username: "3173883093" }); user.username = "3173883093"; }
    if (user.role === "admin" && !user.is_migrated) { db.updateUser(user.id, { role: "super_admin", is_migrated: true }); user.role = "super_admin"; }
    // 升级后再次检查是否需要改名
    if (user.role === "super_admin" && user.username === "admin") { db.updateUser(user.id, { username: "3173883093" }); user.username = "3173883093"; }
    var token = crypto.randomBytes(32).toString("hex");
    sessions[token] = { userId: user.id, role: user.role, expires: Date.now() + 86400000 };
    return json({ token: token, user: user }, 201);
  }

  // ================== 登录 ==================
  if (u.pathname === "/api/auth/login" && method === "POST") {
    var body = await parseJSON(req);
    if (!body || !body.username || !body.password) {
      return json({ error: "请输入用户名和密码" }, 400);
    }
    var user = db.getUserByUsername(body.username);
    if (!user || !db.verifyPassword(body.password, user.password)) {
      return json({ error: "用户名或密码错误" }, 401);
    }
    // 权限升级：admin → super_admin
    if (user.role === "super_admin" && user.username === "admin") { db.updateUser(user.id, { username: "3173883093" }); user.username = "3173883093"; }
    if (user.role === "admin" && !user.is_migrated) { db.updateUser(user.id, { role: "super_admin", is_migrated: true }); user.role = "super_admin"; }
    if (user.role === "super_admin" && user.username === "admin") { db.updateUser(user.id, { username: "3173883093" }); user.username = "3173883093"; }

    // 超级管理员：陌生IP登录需要静态密钥验证
    if (user.role === "super_admin") {
      var clientIp = getClientIP(req);
      var knownIps = [];
      var rawIps = user.ip_addresses || [];
      if (typeof rawIps === "string") { try { knownIps = JSON.parse(rawIps); } catch {} } else if (Array.isArray(rawIps)) { knownIps = rawIps; }
      // 检查是否已知IP（127.0.0.1 和 ::1 视为已知）
      if (knownIps.indexOf(clientIp) < 0 && clientIp !== "127.0.0.1" && clientIp !== "::1" && clientIp !== "::ffff:127.0.0.1") {
        return json({ needs_static_key: true, userId: user.id, message: "检测到陌生IP登录，请输入静态密钥验证" });
      }
      // 已知IP，直接登录并记录IP
      db.addUserIp(user.id, clientIp);
    }

    var token = crypto.randomBytes(32).toString("hex");
    sessions[token] = { userId: user.id, role: user.role, expires: Date.now() + 86400000 };
    return json({ token: token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  }

  // ================== 静态密钥验证 ==================
  if (u.pathname === "/api/auth/verify-static-key" && method === "POST") {
    var body = await parseJSON(req);
    if (!body || !body.staticKey || !body.userId) {
      return json({ error: "参数不完整" }, 400);
    }
    if (body.staticKey !== STATIC_KEY) {
      return json({ error: "静态密钥错误" }, 403);
    }
    var user = db.getUserById(parseInt(body.userId));
    if (!user || user.role !== "super_admin") {
      return json({ error: "用户不存在或非管理员" }, 404);
    }
    var clientIp = getClientIP(req);
    db.addUserIp(user.id, clientIp);
    var token = crypto.randomBytes(32).toString("hex");
    sessions[token] = { userId: user.id, role: user.role, expires: Date.now() + 86400000 };
    return json({ token: token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  }
// ================== 退出 ==================
  if (u.pathname === "/api/auth/logout" && method === "POST") {
    var t = req.headers["authorization"] || "";
    delete sessions[t];
    return json({ success: true });
  }

  // ================== 当前用户 ==================
  if (u.pathname === "/api/auth/me" && method === "GET") {
    var t = (req.headers["authorization"] || "").replace("Bearer ", "");
    var s = sessions[t];
    if (!s || s.expires < Date.now()) {
      delete sessions[t];
      return json({ error: "未登录或已过期" }, 401);
    }
    var user = db.getUserById(s.userId);
    if (!user) return json({ error: "用户不存在" }, 404);
    return json(user);
  }


  // ================== 用户管理（管理员） ==================
  
  var putU = u.pathname.match(/^\/api\/users\/(\d+)$/);
  if (putU && method === "PUT") {
    var au = getAuthUser(req);
    if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var uid = parseInt(putU[1]);
    var body = await parseJSON(req);
    if (!body) return json({ error: "请求格式错误" }, 400);
    var fields = {};
    if (body.username) fields.username = body.username;
    if (body.email !== undefined) fields.email = body.email;
    if (body.password) fields.password = body.password;
    if (body.role !== undefined && ['admin','customer'].indexOf(body.role) >= 0) fields.role = body.role;
    if (body.status !== undefined && ['active','disabled'].indexOf(body.status) >= 0) fields.status = body.status;
    var result = db.updateUser(uid, fields);
    if (!result) return json({ error: "用户不存在" }, 404);
    return json(result);
  }

if (u.pathname === "/api/users" && method === "GET") {
    var au = getAuthUser(req);
    if (!requireRole(au, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
    var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
    var users = (d.users || []).map(function(u) { return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at }; });
    return json(users);
  }
  var delU = u.pathname.match(/^\/api\/users\/(\d+)$/);
  if (delU && method === "DELETE") {
    var au = getAuthUser(req);
    if (!requireRole(au, ["super_admin", "admin"])) return json({ error: "无权限" }, 403);
    var uid = parseInt(delU[1]);
    if (uid === au.id) return json({ error: "不能删除自己" }, 400);
    var delUser = db.getUserById(uid);
    if (!delUser) return json({ error: "用户不存在" }, 404);
    if (delUser.role === "admin") return json({ error: "不能删除管理员" }, 400);
    db.deleteUser(uid);
    return json({ success: true });
  }



  
  // ================== 管理员账号管理（super_admin） ==================
  if (u.pathname === "/api/admin/users" && method === "GET") {
    var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var allUsers = db.getAllUsers();
    return json(allUsers);
  }
  if (u.pathname === "/api/admin/users" && method === "POST") {
    var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var body = await parseJSON(req);
    if (!body || !body.username || !body.password) return json({ error: "请填写用户名和密码" }, 400);
    var existing = db.getUserByUsername(body.username);
    if (existing) return json({ error: "用户名已存在" }, 409);
    var newUser = db.createUser(body.username, body.password, body.email || "", body.role || "customer", "active");
    return json(newUser, 201);
  }
  var adminUserId = (u.pathname.match(/^\/api\/admin\/users\/(\d+)$/) || [])[1];
  if (adminUserId && method === "PUT") {
    var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var body = await parseJSON(req);
    if (!body) return json({ error: "请求格式错误" }, 400);
    var fields = {};
    if (body.username) fields.username = body.username;
    if (body.email !== undefined) fields.email = body.email;
    if (body.password) fields.password = body.password;
    if (body.role !== undefined) fields.role = body.role;
    if (body.status !== undefined) fields.status = body.status;
    var result = db.updateUser(parseInt(adminUserId), fields);
    if (!result) return json({ error: "用户不存在" }, 404);
    return json(result);
  }
  if (adminUserId && method === "DELETE") {
    var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var uid = parseInt(adminUserId);
    if (uid === au.id) return json({ error: "不能删除自己" }, 400);
    db.deleteUser(uid);
    return json({ success: true });
  }


// ================== 网站设置 ==================
  if (u.pathname === "/api/settings" && method === "GET") {
    try {
      var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
      var s = d.settings || { site_name: "白君的俱乐部", site_logo: "", site_logo_url: "", site_description: "专业游戏服务", site_video_url: "", site_music_url: "", site_login_bg_url: "" };
      return json(s);
    } catch(e) { return json({ error: e.message }, 500); }
  }
  if (u.pathname === "/api/settings" && method === "PUT") {
    var au = getAuthUser(req); if (!requireRole(au, ["super_admin"])) return json({ error: "无权限" }, 403);
    var body = await parseJSON(req); if (!body) return json({ error: "请求格式错误" }, 400);
    try {
      var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
      if (!d.settings) d.settings = {};
      if (body.site_name !== undefined) d.settings.site_name = body.site_name;
      if (body.site_logo !== undefined) d.settings.site_logo = body.site_logo;
      if (body.site_logo_url !== undefined) d.settings.site_logo_url = body.site_logo_url;
      if (body.site_description !== undefined) d.settings.site_description = body.site_description;
      if (body.site_video_url !== undefined) d.settings.site_video_url = body.site_video_url;
      if (body.site_music_url !== undefined) d.settings.site_music_url = body.site_music_url;
      if (body.site_login_bg_url !== undefined) d.settings.site_login_bg_url = body.site_login_bg_url;
      fs.writeFileSync(path.join(DATA_DIR, "data.json"), JSON.stringify(d, null, 2), "utf8");
      if (db.clearJSONCache) db.clearJSONCache();
      sseBroadcast("settings_update", d.settings);
      return json(d.settings);
    } catch(e) { return json({ error: e.message }, 500); }
  }
json({ error: "接口未找到" }, 404);
  } catch (err) {
    console.error("API 错误:", err);
    json({ error: err.message }, 500);
  }
}

// ======================== 服务器启动 ========================
// // 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  if (u.pathname.startsWith("/api/")) return handleAPI(req, res);
  handleStatic(u.pathname, res);
});

server.listen(PORT, () => {
  
// Migration: admin username
var f2=require("fs");try{var d=JSON.parse(f2.readFileSync(path.join(DATA_DIR,"data.json"),"utf8"));(d.users||[]).forEach(function(u){if(u.role==="super_admin"&&u.username==="admin"){u.username="3173883093";}});f2.writeFileSync(path.join(DATA_DIR,"data.json"),JSON.stringify(d,null,2),"utf8");console.log("Migrated admin username");}catch(e){}
console.log("==============================");
  console.log("  陪玩店 已启动");
  
// Migration: admin username
var f2=require("fs");try{var d=JSON.parse(f2.readFileSync(path.join(DATA_DIR,"data.json"),"utf8"));(d.users||[]).forEach(function(u){if(u.role==="super_admin"&&u.username==="admin"){u.username="3173883093";}});f2.writeFileSync(path.join(DATA_DIR,"data.json"),JSON.stringify(d,null,2),"utf8");console.log("Migrated admin username");}catch(e){}
console.log("==============================");
  console.log("  前台: http://localhost:" + PORT);
  console.log("  后台: http://localhost:" + PORT + "/admin");
  console.log("  引擎: " + (db.engine === "sqlite" ? "SQLite" : "JSON文件"));
  
// Migration: admin username
var f2=require("fs");try{var d=JSON.parse(f2.readFileSync(path.join(DATA_DIR,"data.json"),"utf8"));(d.users||[]).forEach(function(u){if(u.role==="super_admin"&&u.username==="admin"){u.username="3173883093";}});f2.writeFileSync(path.join(DATA_DIR,"data.json"),JSON.stringify(d,null,2),"utf8");console.log("Migrated admin username");}catch(e){}
console.log("==============================");
});