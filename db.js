const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR || DIR;
const DATA_FILE = path.join(DATA_DIR, "data.json");

try { require.resolve("better-sqlite3"); var SQLite = true; } catch { SQLite = false; }

let db;
if (SQLite) {
  const Database = require("better-sqlite3");
  db = new Database(path.join(DATA_DIR, "peiwang.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSQLite();
} else {
  initJSON();
}

function initSQLite() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '',
      image TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      image TEXT DEFAULT '/uploads/default1.svg',
      is_available INTEGER DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL,
      user_id INTEGER DEFAULT 0,
      customer_name TEXT DEFAULT 'Guest',
      customer_contact TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      total_price REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      message TEXT DEFAULT '',
      image TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
    CREATE TABLE IF NOT EXISTS consumption_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      customer_name TEXT DEFAULT '',
      menu_item_name TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      total_price REAL DEFAULT 0,
      confirmed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);
  if (db.prepare("SELECT COUNT(*) as c FROM categories").get().c === 0) {
    seedData();
  }
}

function seedData() {
  const insertCat = db.prepare("INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)");
  insertCat.run("游戏攻略", "🛡️", 1);
  insertCat.run("玩家社区", "🎃", 2);
  insertCat.run("趣味单", "🎆", 3);
  insertCat.run("效率工具", "💎", 4);

  const insertItem = db.prepare("INSERT INTO menu_items (category_id, name, price, description, image) VALUES (?, ?, ?, ?, ?)");
  insertItem.run(1, "王者上分", 50, "专业王者上分服务，安全稳定不掉星", "/uploads/default1.svg");
  insertItem.run(2, "吃鸡组队", 30, "绝地求生吃鸡组队，高效配合", "/uploads/default2.svg");
  insertItem.run(3, "娱乐模式", 20, "各种趣味娱乐模式，开心就好", "/uploads/default3.svg");
  insertItem.run(4, "原神攻略", 40, "原神日常委托攻略，全面讲解", "/uploads/default4.svg");
}


function initJSON() {
  // If DATA_DIR differs from project dir, copy seed data on first run
  var projectData = path.join(DIR, "data.json");
  if (DATA_DIR !== DIR && !fs.existsSync(DATA_FILE) && fs.existsSync(projectData)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(projectData, DATA_FILE);
      var projUp = path.join(DIR, "uploads");
      if (fs.existsSync(projUp)) {
        var tgtUp = path.join(DATA_DIR, "uploads");
        if (!fs.existsSync(tgtUp)) {
          function cpDir(s, d) {
            fs.mkdirSync(d, { recursive: true });
            fs.readdirSync(s).forEach(function(f) {
              var sp = path.join(s, f), dp = path.join(d, f);
              if (fs.statSync(sp).isDirectory()) cpDir(sp, dp);
              else fs.copyFileSync(sp, dp);
            });
          }
          cpDir(projUp, tgtUp);
        }
      }
      console.log("已从项目目录复制种子数据到持久化目录");
    } catch(e) {
      console.error("复制种子数据失败:", e.message);
    }
  }

  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      categories: [
        { id: 1, name: "游戏攻略", icon: "🛡️", sort_order: 1 },
        { id: 2, name: "玩家社区", icon: "🎃", sort_order: 2 },
        { id: 3, name: "趣味单", icon: "🎆", sort_order: 3 },
        { id: 4, name: "效率工具", icon: "💎", sort_order: 4 }
      ],
      menu_items: [
        { id: 1, category_id: 1, name: "王者上分", price: 50, description: "专业王者上分服务，安全稳定不掉星", image: "/uploads/default1.svg", is_available: 1 },
        { id: 2, category_id: 2, name: "吃鸡组队", price: 30, description: "绝地求生吃鸡组队，高效配合", image: "/uploads/default2.svg", is_available: 1 },
        { id: 3, category_id: 3, name: "娱乐模式", price: 20, description: "各种趣味娱乐模式，开心就好", image: "/uploads/default3.svg", is_available: 1 },
        { id: 4, category_id: 4, name: "原神攻略", price: 40, description: "原神日常委托攻略，全面讲解", image: "/uploads/default4.svg", is_available: 1 }
      ],
      orders: [],
      chat_messages: [],
      consumption_records: [],
      _nextId: { category: 5, menu: 5, order: 1, chat: 1, consumption: 1 }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), "utf8");
  }
}

let jsonData = null;
function getJSON() {
  if (!jsonData) jsonData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  return jsonData;
}
function saveJSON() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(jsonData, null, 2), "utf8");
}

function nextId(key) {
  const d = getJSON();
  const id = d._nextId[key] || 1;
  d._nextId[key] = id + 1;
  saveJSON();
  return id;
}

// ====================== Exports ======================

const engine = SQLite ? "sqlite" : "json";

function getCategories() {
  if (SQLite) return db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  return getJSON().categories;
}

function getMenuItems(categoryId) {
  if (SQLite) {
    if (categoryId) return db.prepare("SELECT * FROM menu_items WHERE category_id = ? AND is_available = 1").all(parseInt(categoryId));
    return db.prepare("SELECT * FROM menu_items WHERE is_available = 1").all();
  }
  const d = getJSON();
  if (categoryId) return d.menu_items.filter(m => m.category_id === parseInt(categoryId) && m.is_available);
  return d.menu_items.filter(m => m.is_available);
}

function getMenuItem(id) {
  if (SQLite) return db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id);
  return getJSON().menu_items.find(m => m.id === id);
}

function createMenuItem(categoryId, name, price, description, image) {
  if (SQLite) {
    const r = db.prepare("INSERT INTO menu_items (category_id, name, price, description, image) VALUES (?, ?, ?, ?, ?)").run(categoryId, name, price, description || "", image || "/uploads/default1.svg");
    return db.prepare("SELECT * FROM menu_items WHERE id = ?").get(r.lastInsertRowid);
  }
  const d = getJSON();
  const item = { id: nextId("menu"), category_id: parseInt(categoryId), name, price, description: description || "", image: image || "/uploads/default1.svg", is_available: 1 };
  d.menu_items.push(item); saveJSON();
  return item;
}

function updateMenuItem(id, fields) {
  if (SQLite) {
    const sets = Object.keys(fields).map(k => k + " = ?").join(", ");
    const vals = Object.values(fields);
    vals.push(id);
    db.prepare("UPDATE menu_items SET " + sets + " WHERE id = ?").run(...vals);
    return db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id);
  }
  const d = getJSON();
  const idx = d.menu_items.findIndex(m => m.id === id);
  if (idx < 0) return null;
  Object.assign(d.menu_items[idx], fields);
  saveJSON();
  return d.menu_items[idx];
}

function deleteMenuItem(id) {
  if (SQLite) { db.prepare("DELETE FROM menu_items WHERE id = ?").run(id); return; }
  const d = getJSON();
  d.menu_items = d.menu_items.filter(m => m.id !== id);
  saveJSON();
}

function createOrder(menuItemId, customerName, customerContact, quantity, remark, userId) {
  if (SQLite) {
    const item = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(menuItemId);
    if (!item) return null;
    const total = item.price * (quantity || 1);
    const r = db.prepare("INSERT INTO orders (menu_item_id, customer_name, customer_contact, quantity, total_price, status, remark) VALUES (?, ?, ?, ?, ?, 'pending', ?)").run(menuItemId, customerName || "Guest", customerContact || "", quantity || 1, total, remark || "");
    const order = db.prepare("SELECT o.*, m.name as menu_name FROM orders o LEFT JOIN menu_items m ON o.menu_item_id = m.id WHERE o.id = ?").get(r.lastInsertRowid);
    return order;
  }
  const d = getJSON();
  const item = d.menu_items.find(m => m.id === menuItemId);
  if (!item) return null;
  const order = {
    id: nextId("order"), menu_item_id: menuItemId, user_id: userId || 0, customer_name: customerName || "Guest",
    customer_contact: customerContact || "", quantity: quantity || 1,
    total_price: item.price * (quantity || 1), status: "pending",
    remark: remark || "", created_at: new Date().toISOString()
  };
  d.orders.push(order); saveJSON();
  return { ...order, menu_name: item.name };
}

function getOrders(statusFilter, userId) {
  if (SQLite) {
    var query = 'SELECT o.*, m.name as menu_name, m.price FROM orders o LEFT JOIN menu_items m ON o.menu_item_id = m.id';
    var params = [];
    var wheres = [];
    if (statusFilter) { wheres.push('o.status = ?'); params.push(statusFilter); }
    if (userId) { wheres.push('o.user_id = ?'); params.push(userId); }
    if (wheres.length) query += ' WHERE ' + wheres.join(' AND ');
    query += ' ORDER BY o.id DESC';
    return db.prepare(query).all.apply(db, params);
  }
  var d = getJSON();
  var orders = (d.orders || []).slice().reverse();
  if (statusFilter) orders = orders.filter(function(o) { return o.status === statusFilter; });
  if (userId) orders = orders.filter(function(o) { return o.user_id === userId; });
  return orders.map(function(o) { return Object.assign({}, o, { menu_name: (d.menu_items.find(function(m) { return m.id === o.menu_item_id; }) || {}).name }); });
}


function updateOrderStatus(id, status) {
  if (SQLite) {
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    if (status === "confirmed") {
      const order = db.prepare("SELECT o.*, m.name as menu_name FROM orders o LEFT JOIN menu_items m ON o.menu_item_id = m.id WHERE o.id = ?").get(id);
      if (order) db.prepare("INSERT INTO consumption_records (order_id, customer_name, menu_item_name, quantity, total_price) VALUES (?, ?, ?, ?, ?)").run(id, order.customer_name, order.menu_name, order.quantity, order.total_price);
    }
    return db.prepare("SELECT o.*, m.name as menu_name FROM orders o LEFT JOIN menu_items m ON o.menu_item_id = m.id WHERE o.id = ?").get(id);
  }
  const d = getJSON();
  const order = d.orders.find(o => o.id === id);
  if (!order) return null;
  order.status = status;
  if (status === "confirmed") {
    const item = d.menu_items.find(m => m.id === order.menu_item_id) || {};
    const rec = { id: nextId("consumption"), order_id: id, customer_name: order.customer_name, menu_item_name: item.name || "", quantity: order.quantity, total_price: order.total_price, confirmed_at: new Date().toISOString() };
    d.consumption_records.push(rec);
  }
  saveJSON();
  return { ...order, menu_name: (d.menu_items.find(m => m.id === order.menu_item_id) || {}).name };
}

function deleteOrder(id) {
  if (SQLite) { db.prepare("DELETE FROM orders WHERE id = ?").run(id); return; }
  const d = getJSON();
  d.orders = d.orders.filter(o => o.id !== id);
  saveJSON();
}

function getChatMessages(orderId) {
  if (SQLite) return db.prepare("SELECT * FROM chat_messages WHERE order_id = ? ORDER BY created_at ASC").all(orderId);
  return (getJSON().chat_messages || []).filter(m => m.order_id === orderId);
}

function addChatMessage(orderId, sender, message, image) {
  if (SQLite) {
    const r = db.prepare("INSERT INTO chat_messages (order_id, sender, message, image) VALUES (?, ?, ?, ?)").run(orderId, sender, message || "", image || "");
    return db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(r.lastInsertRowid);
  }
  const d = getJSON();
  const msg = { id: nextId("chat"), order_id: orderId, sender, message: message || "", image: image || "", is_read: 0, created_at: new Date().toISOString() };
  d.chat_messages.push(msg); saveJSON();
  return msg;
}

function getConsumptionRecords() {
  if (SQLite) return db.prepare("SELECT * FROM consumption_records ORDER BY confirmed_at DESC").all();
  return [...(getJSON().consumption_records || [])].reverse();
}


// ====================== 用户系统 ======================

function createUser(username, password, email, role) {
  var hash = crypto.scryptSync(password, 'peiwang-salt-2024', 32).toString('hex');
  if (SQLite) {
    try {
      var r = db.prepare('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)').run(username, hash, email || '', role || 'customer');
      var u = db.prepare('SELECT id, username, email, role, created_at, last_login_ip FROM users WHERE id = ?').get(r.lastInsertRowid);
      return u;
    } catch(e) {
      if (e.message.indexOf('UNIQUE') >= 0) return null;
      throw e;
    }
  }
  var d = getJSON();
  if (d.users.find(function(u) { return u.username === username; })) return null;
  var user = { id: nextId('user'), username: username, password: hash, email: email || '', role: role || 'customer', created_at: new Date().toISOString(), last_login_ip: '' };
  d.users.push(user); saveJSON();
  return { id: user.id, username: user.username, email: user.email, role: user.role, created_at: user.created_at };
}

function getUserByUsername(username) {
  if (SQLite) return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return getJSON().users.find(function(u) { return u.username === username; }) || null;
}

function getUserById(id) {
  if (SQLite) return db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(id);
  var u = getJSON().users.find(function(u2) { return u2.id === id; });
  if (!u) return null;
  return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at, last_login_ip: u.last_login_ip || null };
}

function verifyPassword(plain, hashed) {
  try { return crypto.scryptSync(plain, 'peiwang-salt-2024', 32).toString('hex') === hashed; } catch(e) { return false; }
}

function initUsers() {
  if (SQLite) {
    var count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    if (count === 0) {
      createUser('admin', 'admin123', 'admin@peiwang.com', 'admin');
      createUser('demo', '123456', 'demo@test.com', 'customer');
    }
  } else {
    var d = getJSON();
    if (!d.users || d.users.length === 0) {
      if (!d.users) d.users = [];
      createUser('admin', 'admin123', 'admin@peiwang.com', 'admin');
      createUser('demo', '123456', 'demo@test.com', 'customer');
    }
  }
}

if (SQLite) {
  db.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, email TEXT DEFAULT "", role TEXT DEFAULT "customer", created_at TEXT DEFAULT (datetime("now")), last_login_ip TEXT DEFAULT "")');
  initUsers();
} else {
  (function ensureNextId() {
    var d = getJSON();
    if (!d._nextId.user) { d._nextId.user = 1; saveJSON(); }
  })();
  initUsers();
}



function updateUser(id, fields) {
  if (SQLite) {
    var sets = []; var vals = [];
    if (fields.username) { sets.push('username = ?'); vals.push(fields.username); }
    if (fields.email !== undefined) { sets.push('email = ?'); vals.push(fields.email); }
    if (fields.role !== undefined) { sets.push('role = ?'); vals.push(fields.role); }
    if (fields.password) { var h = crypto.scryptSync(fields.password, 'peiwang-salt-2024', 32).toString('hex'); sets.push('password = ?'); vals.push(h); }
    if (sets.length === 0) return null;
    vals.push(id);
    db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').run.apply(db, vals);
    return db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(id);
  }
  var d = getJSON();
  var idx = d.users.findIndex(function(u) { return u.id === id; });
  if (idx < 0) return null;
  if (fields.username) d.users[idx].username = fields.username;
  if (fields.email !== undefined) d.users[idx].email = fields.email;
  if (fields.role !== undefined) d.users[idx].role = fields.role;
  if (fields.password) d.users[idx].password = crypto.scryptSync(fields.password, 'peiwang-salt-2024', 32).toString('hex');
  saveJSON();
  return { id: d.users[idx].id, username: d.users[idx].username, email: d.users[idx].email, role: d.users[idx].role, created_at: d.users[idx].created_at };
}

function deleteUser(id) {
  if (SQLite) { db.prepare('DELETE FROM users WHERE id = ?').run(id); return; }
  var d = getJSON();
  d.users = d.users.filter(function(u) { return u.id !== id; });
  saveJSON();
}

function getAllUsers() {
  if (SQLite) return db.prepare('SELECT id, username, email, role, created_at, last_login_ip FROM users ORDER BY id').all();
  return (getJSON().users || []).map(function(u) { return { id: u.id, username: u.username, email: u.email, role: u.role, created_at: u.created_at }; });
}


function updateCategory(id, fields) {
  if (SQLite) {
    var sets = []; var vals = [];
    if (fields.name) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.icon !== undefined) { sets.push('icon = ?'); vals.push(fields.icon); }
    if (fields.image !== undefined) { sets.push('image = ?'); vals.push(fields.image); }
    if (sets.length === 0) return null;
    vals.push(id);
    db.prepare('UPDATE categories SET ' + sets.join(', ') + ' WHERE id = ?').run.apply(db, vals);
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  }
  var d = getJSON();
  var idx = d.categories.findIndex(function(c) { return c.id === id; });
  if (idx < 0) return null;
  if (fields.name) d.categories[idx].name = fields.name;
  if (fields.icon !== undefined) d.categories[idx].icon = fields.icon;
  if (fields.image !== undefined) d.categories[idx].image = fields.image;
  saveJSON();
  return d.categories[idx];
}


function updateCategoryImage(id, imageUrl) {
  if (SQLite) {
    db.prepare('UPDATE categories SET image = ? WHERE id = ?').run(imageUrl, id);
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  }
  var d = getJSON();
  var idx = d.categories.findIndex(function(c) { return c.id === id; });
  if (idx < 0) return null;
  d.categories[idx].image = imageUrl;
  saveJSON();
  return d.categories[idx];
}


function createConsumptionRecord(data) {
  if (SQLite) {
    var r = db.prepare("INSERT INTO consumption_records (customer_name, menu_item_name, quantity, total_price) VALUES (?, ?, ?, ?)").run(data.customer_name || "", data.menu_item_name || "", data.quantity || 1, data.total_price || 0);
    return db.prepare("SELECT * FROM consumption_records WHERE id = ?").get(r.lastInsertRowid);
  }
  var d = getJSON(); if (!d.consumption_records) d.consumption_records = [];
  var rec = { id: nextId("consumption"), customer_name: data.customer_name || "", menu_item_name: data.menu_item_name || "", quantity: data.quantity || 1, total_price: data.total_price || 0, confirmed_at: new Date().toISOString() };
  d.consumption_records.push(rec); saveJSON();
  return rec;
}

function updateConsumptionRecord(id, data) {
  if (SQLite) {
    var sets = []; var vals = [];
    if (data.customer_name !== undefined) { sets.push("customer_name = ?"); vals.push(data.customer_name); }
    if (data.menu_item_name !== undefined) { sets.push("menu_item_name = ?"); vals.push(data.menu_item_name); }
    if (data.quantity !== undefined) { sets.push("quantity = ?"); vals.push(parseInt(data.quantity)); }
    if (data.total_price !== undefined) { sets.push("total_price = ?"); vals.push(parseFloat(data.total_price)); }
    if (sets.length === 0) return null;
    vals.push(id);
    db.prepare("UPDATE consumption_records SET " + sets.join(", ") + " WHERE id = ?").run.apply(db, vals);
    return db.prepare("SELECT * FROM consumption_records WHERE id = ?").get(id);
  }
  var d = getJSON(); var idx = (d.consumption_records || []).findIndex(function(r) { return r.id === id; });
  if (idx < 0) return null;
  if (data.customer_name !== undefined) d.consumption_records[idx].customer_name = data.customer_name;
  if (data.menu_item_name !== undefined) d.consumption_records[idx].menu_item_name = data.menu_item_name;
  if (data.quantity !== undefined) d.consumption_records[idx].quantity = parseInt(data.quantity);
  if (data.total_price !== undefined) d.consumption_records[idx].total_price = parseFloat(data.total_price);
  saveJSON();
  return d.consumption_records[idx];
}

function deleteConsumptionRecord(id) {
  if (SQLite) { db.prepare("DELETE FROM consumption_records WHERE id = ?").run(id); return; }
  var d = getJSON();
  d.consumption_records = (d.consumption_records || []).filter(function(r) { return r.id !== id; });
  saveJSON();
}

function clearJSONCache() { jsonData = null; }

function getUserLastIP(id) {
  if (SQLite) {
    try { var r = db.prepare("SELECT last_login_ip FROM users WHERE id = ?").get(id); return r ? r.last_login_ip : null; } catch(e) { return null; }
  }
  var d = getJSON();
  var u = d.users.find(function(u2) { return u2.id === id; });
  return u ? (u.last_login_ip || null) : null;
}

function updateUserLastIP(id, ip) {
  if (SQLite) {
    try { db.prepare("UPDATE users SET last_login_ip = ? WHERE id = ?").run(ip, id); } catch(e) {}
  } else {
    try {
      var d = JSON.parse(require("fs").readFileSync(path.join(DATA_DIR, "data.json"), "utf8"));
      var users = d.users || [];
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === id) { users[i].last_login_ip = ip; break; }
      }
      d.users = users;
      require("fs").writeFileSync(path.join(DATA_DIR, "data.json"), JSON.stringify(d, null, 2), "utf8");
    } catch(e) {}
  }
}

module.exports = { engine, getCategories, getMenuItems, getMenuItem, createMenuItem, updateMenuItem, deleteMenuItem, createOrder, getOrders, updateOrderStatus, deleteOrder, getChatMessages, addChatMessage, getConsumptionRecords, createConsumptionRecord, updateConsumptionRecord, deleteConsumptionRecord, createUser, getUserByUsername, getUserById, verifyPassword, updateUser, deleteUser, getAllUsers, updateCategory, updateCategoryImage, clearJSONCache, getUserLastIP, updateUserLastIP };