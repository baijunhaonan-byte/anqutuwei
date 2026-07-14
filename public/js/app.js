// ======================== 全局变量 ========================
var categories = [];
var currentCategoryId = null;
var orders = [];
var pageHistory = [];

// ======================== 初始化 ========================
(async function init() {
  categories = await apiGet("/api/categories");
  renderCategories();
  renderHeroCategories();
  connectSSE();
  loadSiteSettings();

  // SSE 回调
  sseCallbacks.onMessage = function(data) {
    var el = document.getElementById("chat-msgs");
    if (el && data && data.sender === "admin") {
      var p = document.createElement("p");
      var b = document.createElement("b");
      b.textContent = "客服:";
      p.appendChild(b);
      if (data.image) {
        p.appendChild(document.createElement("br"));
        var img = document.createElement("img");
        img.src = data.image;
        img.style.cssText = "max-width:200px;max-height:200px;border-radius:8px;margin-top:4px;cursor:pointer;";
        img.onclick = function(){ window.open(this.src); };
        p.appendChild(img);
      } else {
        p.appendChild(document.createTextNode(" " + escapeHtml(data.message)));
      }
      el.appendChild(p);
      el.scrollTop = el.scrollHeight;
    }
  };

  sseCallbacks.onOrderUpdate = function() {
    if (document.getElementById("page-cart").classList.contains("active")) {
      showCart();
    }
  };
})();

// ======================== 页面导航 ========================
function showPage(id) {
  var pages = document.querySelectorAll(".page");
  for (var i = 0; i < pages.length; i++) {
    pages[i].classList.remove("active");
  }
  var el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function showHome() {
  pageHistory = [];
  showPage("page-home");
  var items = document.querySelectorAll(".cat-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("active");
  }
}

function goBack() {
  var prev = pageHistory.pop();
  if (prev) {
    showPage(prev);
  } else {
    showHome();
  }
}

// ======================== 分类渲染 ========================
function renderCategories() {
  var nav = document.getElementById("category-nav");
  nav.innerHTML = "";
  for (var i = 0; i < categories.length; i++) {
    var c = categories[i];
    var d = document.createElement("div");
    d.className = "cat-item";
    d.setAttribute("data-id", c.id);
    d.onclick = (function(id) { return function() { showCategory(id); }; })(c.id);
    // Sidebar item: show image if available, else icon
    if (c.image) {
      var img = document.createElement("img");
      img.src = c.image;
      img.style.cssText = "width:28px;height:28px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:8px;";
      img.onerror = function() { this.style.display = "none"; };
      d.appendChild(img);
      var txt = document.createTextNode(c.name);
      d.appendChild(txt);
    } else {
      d.textContent = (c.icon || "") + " " + c.name;
    }
    nav.appendChild(d);
  }
}

function renderHeroCategories() {
  var el = document.getElementById("hero-categories");
  el.innerHTML = "";
  for (var i = 0; i < categories.length; i++) {
    var c = categories[i];
    var d = document.createElement("div");
    d.className = "hero-cat-card";
    d.onclick = (function(id) { return function() { showCategory(id); }; })(c.id);
    if (c.image) {
      var img = document.createElement("img");
      img.src = c.image;
      img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:16px;";
      d.style.position = "relative";
      d.style.overflow = "hidden";
      img.onerror = function() { this.style.display = "none"; };
      d.appendChild(img);
    } else {
      var iconSpan = document.createElement("span");
      iconSpan.style.fontSize = "40px";
      iconSpan.textContent = c.icon || "";
      d.appendChild(iconSpan);
    }
    var nameSpan = document.createElement("span");
    nameSpan.textContent = c.name;
    nameSpan.style.cssText = "position:absolute;bottom:0;left:0;font-size:15px;color:#fff;display:block;padding:10px 0;text-align:center;width:100%;background:linear-gradient(transparent,rgba(0,0,0,0.7));z-index:2;";
    d.appendChild(nameSpan);
    el.appendChild(d);
  }
}

// ======================== 分类浏览 ========================
async function showCategory(catId) {
  currentCategoryId = catId;
  pageHistory.push("page-home");

  var cat = null;
  for (var i = 0; i < categories.length; i++) {
    if (categories[i].id === catId) { cat = categories[i]; break; }
  }

  document.getElementById("category-title").textContent = (cat ? (cat.image ? "📁 " : (cat.icon || "") + " ") + cat.name : "分类");

  // 高亮侧边栏
  var items = document.querySelectorAll(".cat-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", parseInt(items[i].getAttribute("data-id")) === catId);
  }

  var menuItems = await apiGet("/api/menu-items?category_id=" + catId);
  renderMenuGrid(menuItems);
  showPage("page-category");
}

function renderMenuGrid(items) {
  var grid = document.getElementById("menu-grid");
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    grid.innerHTML = "<div style='text-align:center;padding:40px;color:#999;'>该分类暂无菜品</div>";
    return;
  }

  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var card = document.createElement("div");
    card.className = "menu-card";
    card.onclick = (function(id) { return function() { showDetail(id); }; })(it.id);

    var img = document.createElement("img");
    img.src = it.image || "/uploads/default1.svg";
    img.alt = it.name;
    img.onerror = function() { this.src = "/uploads/default1.svg"; };
    card.appendChild(img);

    var body = document.createElement("div");
    body.className = "menu-card-body";

    var h3 = document.createElement("h3");
    h3.textContent = it.name;
    body.appendChild(h3);

    var price = document.createElement("div");
    price.className = "price";
    price.textContent = "点数" + it.price;
    body.appendChild(price);

    var desc = document.createElement("div");
    desc.textContent = it.description || "";
    body.appendChild(desc);

    card.appendChild(body);
    grid.appendChild(card);
  }
}

// ======================== 菜品详情 ========================
async function showDetail(itemId) {
  pageHistory.push("page-category");
  var it = await apiGet("/api/menu-items/" + itemId);
  var el = document.getElementById("detail-content");
  el.innerHTML = "";

  var img = document.createElement("img");
  img.src = it.image || "/uploads/default1.svg";
  img.style.maxWidth = "100%";
  img.onerror = function() { this.src = "/uploads/default1.svg"; };
  el.appendChild(img);

  var h2 = document.createElement("h2");
  h2.textContent = it.name;
  el.appendChild(h2);

  var price = document.createElement("div");
  price.className = "price";
  price.textContent = "点数" + it.price;
  el.appendChild(price);

  var desc = document.createElement("p");
  desc.textContent = it.description || "";
  el.appendChild(desc);

  var hr = document.createElement("hr");
  el.appendChild(hr);

  // 提交表单
  var form = document.createElement("div");

  // 数量
  var qtyLabel = document.createElement("label");
  var qtySpan = document.createElement("span");
  qtySpan.textContent = "数量:";
  qtyLabel.appendChild(qtySpan);
  var qtyInput = document.createElement("input");
  qtyInput.id = "order-qty";
  qtyInput.type = "number";
  qtyInput.value = "1";
  qtyInput.min = "1";
  qtyInput.style.width = "80px";
  qtyLabel.appendChild(qtyInput);
  form.appendChild(qtyLabel);

  // 姓名
  var nameLabel = document.createElement("label");
  var nameSpan = document.createElement("span");
  nameSpan.textContent = "姓名:";
  nameLabel.appendChild(nameSpan);
  var nameInput = document.createElement("input");
  nameInput.id = "order-name";
  nameInput.placeholder = "你的昵称";
  nameLabel.appendChild(nameInput);
  form.appendChild(nameLabel);

  // 联系方式
  var contactLabel = document.createElement("label");
  var contactSpan = document.createElement("span");
  contactSpan.textContent = "联系:";
  contactLabel.appendChild(contactSpan);
  var contactInput = document.createElement("input");
  contactInput.id = "order-contact";
  contactInput.placeholder = "微信 / QQ / 手机";
  contactLabel.appendChild(contactInput);
  form.appendChild(contactLabel);

  // 备注
  var remarkLabel = document.createElement("label");
  var remarkSpan = document.createElement("span");
  remarkSpan.textContent = "备注:";
  remarkLabel.appendChild(remarkSpan);
  var remarkTA = document.createElement("textarea");
  remarkTA.id = "order-remark";
  remarkTA.placeholder = "有什么特殊要求？";
  remarkLabel.appendChild(remarkTA);
  form.appendChild(remarkLabel);

  // 提交按钮
  var orderBtn = document.createElement("button");
  orderBtn.textContent = "立即提交";
  orderBtn.onclick = function() { submitOrder(itemId, it.price); };
  form.appendChild(orderBtn);

  el.appendChild(form);
  showPage("page-detail");
}

// ======================== 提交订单 ========================
async function submitOrder(itemId, price) {
  try {
    var name = document.getElementById("order-name").value || "游客";
    var contact = document.getElementById("order-contact").value || "";
    var qty = parseInt(document.getElementById("order-qty").value) || 1;
    var remark = document.getElementById("order-remark").value || "";

    var order = await apiPost("/api/orders", {
      menu_item_id: itemId,
      customer_name: name,
      customer_contact: contact,
      quantity: qty,
      remark: remark
    });

    notify("提交成功！咨询 #" + order.id + "，数量" + (price * qty));

    // 不再自动发送消息
    // 已移除自动消息

    setTimeout(function() { showHome(); }, 1500);
  } catch (e) {
    notify("提交失败: " + e.message);
  }
}

// ======================== 订单列表 ========================
async function showCart() {
  pageHistory.push("page-home");
  orders = await apiGet("/api/orders");
  var el = document.getElementById("order-list");
  el.innerHTML = "";

  if (!orders || orders.length === 0) {
    el.innerHTML = "<div style='text-align:center;padding:40px;color:#999;'>暂无咨询</div>";
    showPage("page-cart");
    return;
  }

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    var card = document.createElement("div");
    card.className = "order-card";

    var h4 = document.createElement("h4");
    h4.textContent = (o.menu_name || "菜品") + " × " + o.quantity;
    card.appendChild(h4);

    var p1 = document.createElement("p");
    p1.textContent = "订单 #" + o.id + " | 点数" + o.total_price + " | " + o.customer_name;
    card.appendChild(p1);

    var statusSpan = document.createElement("span");
    statusSpan.className = "status status-" + o.status;
    statusSpan.textContent = statusLabel(o.status);
    card.appendChild(statusSpan);

    // 聊天按钮
    if (o.status === "pending" || o.status === "confirmed") {
      var chatBtn = document.createElement("button");
      chatBtn.textContent = "💬 联系客服";
      chatBtn.style.cssText = "margin-top:8px;padding:6px 14px;background:#3498db;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;";
      chatBtn.onclick = (function(id) { return function() { showChat(id); }; })(o.id);
      card.appendChild(document.createElement("br"));
      card.appendChild(chatBtn);
    }

    el.appendChild(card);
  }

  showPage("page-cart");
}

// ======================== 聊天功能 ========================
async function showChat(orderId) {
  pageHistory.push("page-cart");
  var msgs = await loadChatMessages(orderId);

  // 找订单信息
  var orderInfo = null;
  for (var i = 0; i < orders.length; i++) {
    if (orders[i].id === orderId) { orderInfo = orders[i]; break; }
  }

  var el = document.getElementById("chat-content");
  el.innerHTML = "";

  // 标题
  var title = document.createElement("h3");
  title.textContent = "💬 订单 #" + orderId + (orderInfo ? " - " + orderInfo.menu_name : "") + " 客服";
  el.appendChild(title);

  // 消息区域
  var msgBox = document.createElement("div");
  msgBox.id = "chat-msgs";
  el.appendChild(msgBox);

  // 加载历史消息
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var p = document.createElement("p");
    var b = document.createElement("b");
    b.textContent = m.sender === "customer" ? "我:" : (m.sender === "admin" ? "客服:" : m.sender + ":");
    p.appendChild(b);
    if (m.image) {
      p.appendChild(document.createElement("br"));
      var img = document.createElement("img");
      img.src = m.image;
      img.style.cssText = "max-width:200px;max-height:200px;border-radius:8px;margin-top:4px;cursor:pointer;";
      img.onclick = function(){ window.open(this.src); };
      p.appendChild(img);
    } else {
      p.appendChild(document.createTextNode(" " + escapeHtml(m.message)));
    }
    msgBox.appendChild(p);
  }
  msgBox.scrollTop = msgBox.scrollHeight;

  // 输入区
  var inputArea = document.createElement("div");
  inputArea.className = "chat-input-area";

  var input = document.createElement("input");
  input.id = "chat-input";
  input.placeholder = "输入消息...";
  inputArea.appendChild(input);

  var imgBtn = document.createElement("button");
  imgBtn.textContent = "🖼";
  imgBtn.style.cssText = "padding:6px 10px;background:#eee;border:none;border-radius:6px;cursor:pointer;font-size:16px;";
  imgBtn.title = "发送图片";
  imgBtn.onclick = function() { var fi = document.createElement("input"); fi.type = "file"; fi.accept = "image/*"; fi.onchange = function() { var f = fi.files[0]; if(!f) return; uploadChatImage(orderId, f); }; fi.click(); };
  inputArea.appendChild(imgBtn);

  var sendBtn = document.createElement("button");
  sendBtn.className = "chat-send-btn";
  sendBtn.textContent = "发送";
  sendBtn.onclick = function() { sendCustomerMessage(orderId); };
  inputArea.appendChild(sendBtn);

  // 回车发送
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      sendCustomerMessage(orderId);
    }
  });

  el.appendChild(inputArea);
  showPage("page-chat");
}

async function uploadChatImage(orderId, file) {
  try {
    var r = await sendChatMessage(orderId, "customer", "", file);
    var msgBox = document.getElementById("chat-msgs");
    var p = document.createElement("p");
    var imgUrl = r && r.image ? r.image : URL.createObjectURL(file);
    p.innerHTML = "<b>我:</b><br><img src='" + imgUrl + "' style='max-width:200px;max-height:200px;border-radius:8px;margin-top:4px;cursor:pointer;' onclick='window.open(\"" + imgUrl + "\")'>";
    msgBox.appendChild(p);
    msgBox.scrollTop = msgBox.scrollHeight;
  } catch(e) { notify("发送失败"); }
}

async function sendCustomerMessage(orderId) {
  var input = document.getElementById("chat-input");
  var text = input.value.trim();
  if (!text) return;
  input.value = "";

  await sendChatMessage(orderId, "customer", text);

  var msgBox = document.getElementById("chat-msgs");
  if (msgBox) {
    var p = document.createElement("p");
    var b = document.createElement("b");
    b.textContent = "我:";
    p.appendChild(b);
    p.appendChild(document.createTextNode(" " + escapeHtml(text)));
    msgBox.appendChild(p);
    msgBox.scrollTop = msgBox.scrollHeight;
  }
}

// ======================== 工具函数 ========================
function statusLabel(s) {
  var map = { pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消" };
  return map[s] || s;
}

function escapeHtml(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function notify(msg) {
  var container = document.getElementById("notification-container");
  var d = document.createElement("div");
  d.className = "notification";
  d.textContent = msg;
  container.appendChild(d);
  setTimeout(function() { d.remove(); }, 3000);
}

// ======================== 登录系统 ========================
var currentUser = null;
var currentToken = localStorage.getItem("peiwang_token") || null;

(async function checkLogin() {
  if (currentToken) {
    try {
      var r = await fetch("/api/auth/me", {
        headers: { "Authorization": "Bearer " + currentToken }
      });
      if (r.ok) {
        currentUser = await r.json();
        updateUserUI();
      } else {
        localStorage.removeItem("peiwang_token");
        currentToken = null;
      }
    } catch(e) {
      console.warn("Login check failed:", e);
    }
  }
})();

function updateUserUI() {
  var out = document.getElementById("user-logged-out");
  var in_el = document.getElementById("user-logged-in");
  if (currentUser) {
    out.classList.add("hidden");
    in_el.classList.remove("hidden");
    document.getElementById("user-name-display").textContent = currentUser.username;
  } else {
    out.classList.remove("hidden");
    in_el.classList.add("hidden");
  }
}

function showLogin() {
    // 加载登录背景图
  fetch('/api/settings').then(function(r){return r.json();}).then(function(s){
    var modal=document.querySelector('#login-modal .modal-box');
    if(modal&&s.site_login_bg){
      modal.style.background='url('+s.site_login_bg+') center/cover no-repeat';modal.classList.add('has-bg');
    }
  }).catch(function(){});
  document.getElementById("login-modal").classList.remove("hidden");
  document.getElementById("login-error").classList.add("hidden");
  document.getElementById("login-username").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-username").focus();
}

function closeLoginModal() {
  document.getElementById("login-modal").classList.add("hidden");
}

async function doLogin() {
  
  var username = document.getElementById("login-username").value.trim();
  var password = document.getElementById("login-password").value;
  var errEl = document.getElementById("login-error");
  if (!username || !password) {
    errEl.textContent = "请输入用户名和密码";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    var r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    var data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || "登录失败";
      errEl.classList.remove("hidden");
      return;
    }
    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem("peiwang_token", currentToken);
    updateUserUI();
    closeLoginModal();
    notify("登录成功，欢迎 " + currentUser.username);
  } catch(e) {
    errEl.textContent = "网络错误";
    errEl.classList.remove("hidden");
  }
}

function showRegister() {
  document.getElementById("register-modal").classList.remove("hidden");
  document.getElementById("register-error").classList.add("hidden");
  document.getElementById("reg-username").value = "";
  document.getElementById("reg-password").value = "";
  document.getElementById("reg-email").value = "";
  document.getElementById("reg-captcha").value = "";
  refreshCaptcha();
}

function closeRegisterModal() {
  document.getElementById("register-modal").classList.add("hidden");
}

var currentCaptchaId = null;

async function refreshCaptcha() {
  try {
    var r = await fetch("/api/auth/captcha");
    var data = await r.json();
    currentCaptchaId = data.id;
    document.getElementById("captcha-display").textContent = data.code;
  } catch(e) {
    document.getElementById("captcha-display").textContent = "加载失败";
  }
}

async function doRegister() {
  
  var username = document.getElementById("reg-username").value.trim();
  var password = document.getElementById("reg-password").value;
  var email = document.getElementById("reg-email").value.trim();
  var captcha = document.getElementById("reg-captcha").value.trim();
  var errEl = document.getElementById("register-error");
  if (!username || !password) {
    errEl.textContent = "请输入用户名和密码";
    errEl.classList.remove("hidden");
    return;
  }
  if (username.length < 2) {
    errEl.textContent = "用户名至少2个字符";
    errEl.classList.remove("hidden");
    return;
  }
  if (password.length < 4) {
    errEl.textContent = "密码至少4个字符";
    errEl.classList.remove("hidden");
    return;
  }
  if (!captcha || captcha.length !== 4) {
    errEl.textContent = "请输入4位验证码";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    var r = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username,
        password: password,
        email: email,
        captcha_id: currentCaptchaId,
        captcha: captcha
      })
    });
    var data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || "注册失败";
      errEl.classList.remove("hidden");
      if (data.error && data.error.indexOf("验证码") >= 0) refreshCaptcha();
      return;
    }
    currentToken = data.token;
    currentUser = data.user;
    localStorage.setItem("peiwang_token", currentToken);
    updateUserUI();
    closeRegisterModal();
    notify("注册成功，欢迎 " + currentUser.username);
  } catch(e) {
    errEl.textContent = "网络错误";
    errEl.classList.remove("hidden");
  }
}

async function logoutUser() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Authorization": currentToken || "" }
    });
  } catch(e) {}
  
  localStorage.removeItem("peiwang_token");
  currentToken = null;
  currentUser = null;
  updateUserUI();
  notify("已退出登录");
}

// ======================== 用户管理（后台跳转） ========================
if (currentUser && currentUser.role === "admin") {
  var adminLink = document.createElement("div");
  adminLink.style.cssText = "margin-top:8px;font-size:12px;";
  var a = document.createElement("a");
  a.href = "/admin";
  a.target = "_blank";
  a.textContent = "🔧 进入管理后台";
  a.style.cssText = "color:#3498db;text-decoration:none;";
  adminLink.appendChild(a);
  document.getElementById("user-section").appendChild(adminLink);
}

// ======================== 网站设置 ========================
async function loadSiteSettings() {
  try {
    var s = await apiGet('/api/settings');
    var logoEl = document.querySelector('.logo-icon');
    var textEl = document.querySelector('.logo-text');
    var heroTitle = document.querySelector('.hero h1');
    var heroDesc = document.querySelector('.hero p');
    // 如果有图片logo则显示图片
    if (s.site_logo_url && logoEl) {
      logoEl.innerHTML = '<img src="' + s.site_logo_url + '" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">';
    } else if (s.site_logo && logoEl) {
      logoEl.textContent = s.site_logo;
    }
    if (s.site_name && textEl) textEl.textContent = s.site_name;
    if (s.site_name && heroTitle) heroTitle.textContent = '欢迎来到 ' + s.site_name;
    if (s.site_description && heroDesc) heroDesc.textContent = s.site_description;
    // 背景视频
    var bgVideo = document.getElementById('bg-video');
    if (s.site_video_url && bgVideo) {
      bgVideo.src = s.site_video_url;
      bgVideo.load();
    }
    // 背景音乐
    var bgmAudio = document.getElementById('bgm-audio');
    if (s.site_music_url && bgmAudio) {
      bgmAudio.src = s.site_music_url;
      bgmAudio.load();
    }
    // 侧边栏背景图
    var sidebar = document.getElementById('sidebar');
    if (s.site_sidebar_bg && sidebar) {
      sidebar.style.backgroundImage = 'url(' + s.site_sidebar_bg + ')';
      sidebar.classList.add('has-sidebar-bg');
    } else if (sidebar) {
      sidebar.style.backgroundImage = '';
      sidebar.classList.remove('has-sidebar-bg');
    }
    // 登录背景图片 - 应用到注册模态框
    var regModal = document.getElementById('register-modal');
    var regBox = regModal ? regModal.querySelector('.modal-box') : null;
    if (s.site_login_bg) {
      var bgStyle = 'url(' + s.site_login_bg + ')';
      if (regBox) { regBox.style.backgroundImage = bgStyle; regBox.classList.add('has-bg'); }
    } else {
      if (regBox) { regBox.style.backgroundImage = ''; regBox.style.background = 'transparent'; regBox.classList.remove('has-bg'); }
    }
  } catch(e) { console.warn('设置加载失败:', e); }
}

// ======================== 背景音乐 ========================

// ======================== 背景音乐 ========================
var isMusicPlaying = false;
function toggleMusic() {
  var a = document.getElementById('bgm-audio');
  var b = document.getElementById('music-toggle');
  if (!a) return;
  if (isMusicPlaying) {
    a.pause();
    b.textContent = '🎵';
  } else {
    a.volume = 0.3;
    a.currentTime = 0;
    var p = a.play();
    if (p && p.then) {
      p.then(function(){ b.textContent = '🎶'; }).catch(function(e){ console.log(e); b.textContent = '❌'; });
    } else {
      b.textContent = '🎶';
    }
  }
  isMusicPlaying = !isMusicPlaying;
}

// ======================== 锁屏 ========================
(function initLockScreen() {
  // 从设置加载锁屏视频
  fetch('/api/settings').then(function(r){return r.json();}).then(function(s){
    var v=document.getElementById('lockscreen-video');
    if(v&&s.site_video_url){v.src=s.site_video_url;v.load();}
  }).catch(function(){});

  // 强制锁屏覆盖
  var ls = document.getElementById("lockscreen");
  if (ls) {
    ls.style.setProperty("background", "#000", "important");
    ls.style.setProperty("z-index", "99999", "important");
  }
  var video = document.getElementById("lockscreen-video");
  var screen = document.getElementById("lockscreen");
  var hint = document.getElementById("lock-hint");
  var lockIcon = document.getElementById("lock-icon");
  var timeEl = document.getElementById("lock-time");
  var dateEl = document.getElementById("lock-date");
  var bgVideo = document.getElementById("bg-video");
  var bgmAudio = document.getElementById("bgm-audio");
  if (!video || !screen) return;

  // 更新时间显示
  function updateDateTime() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    if (timeEl) timeEl.textContent = h + ":" + m;
    if (dateEl) {
      var week = ["日","一","二","三","四","五","六"];
      dateEl.textContent = now.getFullYear() + "年" + (now.getMonth()+1) + "月" + now.getDate() + "日 星期" + week[now.getDay()];
    }
  }
  updateDateTime();
  setInterval(updateDateTime, 10000);

  // 显示视频第一帧作为封面，不播放
  video.removeAttribute("loop");
  video.currentTime = 0;
  video.pause();

  // 视频加载后显示第一帧
  video.addEventListener("loadeddata", function() {
    hint.style.opacity = "1";
  });
  // 如果视频加载慢，直接显示提示
  setTimeout(function() {
    hint.style.opacity = "1";
  }, 2000);

  // 用户交互触发解锁
  function doUnlock(e) {
    if (e) e.preventDefault();
    if (screen.classList.contains("unlocking") || screen.classList.contains("unlocked")) return;

    // 锁开启动画
    if (lockIcon) {
      lockIcon.textContent = "🔓";
      lockIcon.classList.add("unlocked-icon");
    }

    // 开始解锁滑动动画
    screen.classList.add("unlocking");

    // 启动背景视频和音乐
    if (bgVideo) {
      bgVideo.muted = false;
      bgVideo.volume = 0.25;
      bgVideo.loop = true;
      var p = bgVideo.play();
      if (p && p.catch) p.catch(function(){});
    }


    // 动画结束后隐藏锁屏
    setTimeout(function() {
      screen.classList.add("unlocked");
      document.body.style.overflow = "auto";
      // 自动弹出登录界面
      if (typeof showLogin === "function") showLogin();
    }, 600);
  }

  // 点击解锁
  screen.addEventListener("click", doUnlock);

  // 触摸上滑解锁
  var touchStartY = 0;
  screen.addEventListener("touchstart", function(e) {
    touchStartY = e.touches[0].clientY;
  });
  screen.addEventListener("touchend", function(e) {
    var dy = touchStartY - e.changedTouches[0].clientY;
    if (dy > 50) doUnlock(e);
  });

  // 阻止锁屏时body滚动
  document.body.style.overflow = "hidden";
})();

// ======================== 视图切换 ========================
function toggleView() {
  var app = document.getElementById("app");
  var btn = document.getElementById("view-toggle");
  if (!app || !btn) return;
  if (app.classList.contains("mobile-view")) {
    app.classList.remove("mobile-view");
    btn.textContent = "📱 手机模式";
    localStorage.setItem("peiwang_view", "desktop");
  } else {
    app.classList.add("mobile-view");
    btn.textContent = "💻 电脑模式";
    localStorage.setItem("peiwang_view", "mobile");
  }
}
// 恢复上次选择的模式
(function() {
  var saved = localStorage.getItem("peiwang_view");
  if (saved === "mobile") {
    var app = document.getElementById("app");
    if (app) app.classList.add("mobile-view");
    var btn = document.getElementById("view-toggle");
    if (btn) btn.textContent = "💻 电脑模式";
  }
})();
