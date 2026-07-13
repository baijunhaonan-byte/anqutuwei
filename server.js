const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const PORT = process.env.PORT || 3001;
const DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || DIR;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, "uploads");

// ======================== SSE 实时推送 ========================
const sseClients = [];
const captchaStore = {};
const sessions = {};

// ================== Auth helper ==================
function getAuthUser(req) {
  var t = (req.headers["authorization"] || "").replace("Bearer ", "");
  var s = sessions[t];
  if (!s || s.expires < Date.now()) { delete sessions[t]; return null; }
  var user = db.getUserById(s.userId);
  return user || null;
}

function requireAdmin(au) {
  return au && (au.role === "admin" || au.role === "super_admin");
}
function requireSuperAdmin(au) {
  return au && au.role === "super_admin";
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
  if (p.startsWith("/tupian/")) return serveFile(path.join(DIR, p), res);
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
// ================== 安全限制 ==================
const regAttempts = {}; // IP -> [timestamps]
const STATIC_KEY = "133900923@";

function getClientIP(req) {
  var fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(ip, limit, windowMs) {
  var now = Date.now();
  if (!regAttempts[ip]) regAttempts[ip] = [];
  regAttempts[ip] = regAttempts[ip].filter(function(t) { return now - t < windowMs; });
  if (regAttempts[ip].length >= limit) return false;
  regAttempts[ip].push(now);
  return true;
}

async function handleAPI(req, res) {
  const u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const method = req.method.toUpperCase();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  // CSRF: ???????
  var origin = req.headers["origin"] || req.headers["referer"] || "";
  if (method !== "GET" && method !== "OPTIONS" && origin && !origin.includes("localhost") && !origin.includes("127.0.0.1") && !origin.includes(req.headers.host || "")) {
    return json({ error: "??????" }, 403);
  }

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
    if (u.pathname === "/api/menu-items" && method === "POST") {
      const body = req.headers["content-type"] && req.headers["content-type"].includes("multipart") ? await parseMultipart(req) : await parseJSON(req);
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
    if (menuId && method === "PUT") {
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
    if (menuId && method === "DELETE") {
      db.deleteMenuItem(parseInt(menuId));
      sseBroadcast("menu_update", { type: "delete", id: parseInt(menuId) });
      return json({ success: true });
    }

    // 订单列表
    if (u.pathname === "/api/orders" && method === "GET") {
      var au = getAuthUser(req);
      var userId = null;
      if (au && au.role == "customer") userId = au.id;
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
    if (u.pathname === "/api/consumption" && method === "GET") {
      return json(db.getConsumptionRecords());
    }

    
    // 新建消费记录
    if (u.pathname === "/api/consumption" && method === "POST") {
      var body = await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      var rec = db.createConsumptionRecord(body);
      return json(rec, 201);
    }
    var crMatch = u.pathname.match(/^\/api\/consumption\/(\d+)$/);
    if (crMatch && method === "PUT") {
      var body = await parseJSON(req);
      if (!body) return json({ error: "请求格式错误" }, 400);
      var rec = db.updateConsumptionRecord(parseInt(crMatch[1]), body);
      if (!rec) return json({ error: "记录不存在" }, 404);
      return json(rec);
    }
    if (crMatch && method === "DELETE") {
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
  if (u.pathname.match(/^\/api\/categories\/(\d+)\/image$/) && method === "POST") {
    var cid = parseInt(u.pathname.match(/^\/api\/categories\/(\d+)\/image$/)[1]);
    var body = await parseMultipart(req);
    if (!body || !body.image) return json({ error: "请上传图片" }, 400);
    var result = db.updateCategoryImage(cid, body.image);
    if (!result) return json({ error: "分类不存在" }, 404);
    sseBroadcast("menu_update", { type: "category_update", item: result });
    return json(result);
  }
  if (u.pathname.match(/^\/api\/categories\/(\d+)$/) && method === "PUT") {
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
    var code = Math.floor(1000 + Math.random() * 9000).toString();
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
    // ?????????????
    if (user.role === "super_admin") {
      var settingsData = { settings: {} };
      try { settingsData = JSON.parse(require("fs").readFileSync(path.join(DATA_DIR, "data.json"), "utf8")); } catch(e) {}
      var expectedKey = settingsData.settings.static_key || STATIC_KEY;
      if (!body.static_key) {
        return json({ need_static_key: true, error: "???????" }, 200);
      }
      if (body.static_key !== expectedKey) {
        return json({ error: "??????" }, 401);
      }
    }
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
    if (!au || !requireSuperAdmin(au)) return json({ error: "无权限" }, 403);
    var uid = parseInt(putU[1]);
    var body = await parseJSON(req);
    if (!body) return json({ error: "请求格式错误" }, 400);
    var fields = {};
    if (body.username) fields.username = body.username;
    if (body.email !== undefined) fields.email = body.email;
    if (body.password) fields.password = body.password;
    if (body.role !== undefined) fields.role = body.role;
    var result = db.updateUser(uid, fields);
    if (!result) return json({ error: "用户不存在" }, 404);
    return json(result);
  }

if (u.pathname === "/api/users" && method === "GET") {
    var au = getAuthUser(req);
    if (!au || !requireSuperAdmin(au)) return json({ error: "无权限" }, 403);
    var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
    var users = (d.users || []).map(function(u) { return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at }; });
    return json(users);
  }
  var delU = u.pathname.match(/^\/api\/users\/(\d+)$/);
  if (delU && method === "DELETE") {
    var au = getAuthUser(req);
    if (!au || !requireSuperAdmin(au)) return json({ error: "无权限" }, 403);
    var uid = parseInt(delU[1]);
    if (uid === au.id) return json({ error: "不能删除自己" }, 400);
    var delUser = db.getUserById(uid);
    if (!delUser) return json({ error: "用户不存在" }, 404);
    // super_admin can delete admin accounts
    db.deleteUser(uid);
    return json({ success: true });
  }



  // ================== 网站设置 ==================
  if (u.pathname === "/api/settings" && method === "GET") {
    try {
      var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
      var s = d.settings || { site_name: "白君的俱乐部", site_logo: "", site_logo_url: "", site_description: "专业游戏服务", site_video_url: "", site_login_bg: "", site_sidebar_bg: "" };
      return json(s);
    } catch(e) { return json({ error: e.message }, 500); }
  }
  if (u.pathname === "/api/settings" && method === "PUT") {
    var au = getAuthUser(req); if (!au || !requireSuperAdmin(au)) return json({ error: "无权限" }, 403);
    var body = await parseJSON(req); if (!body) return json({ error: "请求格式错误" }, 400);
    try {
      var d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
      if (!d.settings) d.settings = {};
      if (body.site_name !== undefined) d.settings.site_name = body.site_name;
      if (body.site_logo !== undefined) d.settings.site_logo = body.site_logo;
      if (body.site_logo_url !== undefined) d.settings.site_logo_url = body.site_logo_url;
      if (body.site_description !== undefined) d.settings.site_description = body.site_description;
      if (body.site_video_url !== undefined) d.settings.site_video_url = body.site_video_url;
      if (body.site_login_bg !== undefined) d.settings.site_login_bg = body.site_login_bg;
      if (body.site_sidebar_bg !== undefined) d.settings.site_sidebar_bg = body.site_sidebar_bg;
      if (body.static_key !== undefined) d.settings.static_key = body.static_key;
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
  console.log("==============================");
  console.log("  陪玩店 已启动");
  console.log("==============================");
  console.log("  前台: http://localhost:" + PORT);
  console.log("  后台: http://localhost:" + PORT + "/admin");
  console.log("  引擎: " + (db.engine === "sqlite" ? "SQLite" : "JSON文件"));
  console.log("==============================");
});
