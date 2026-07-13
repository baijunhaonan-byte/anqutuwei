var adminToken = localStorage.getItem("peiwang_admin_token") || null;

(async function checkAdminLogin() {
  if (adminToken) {
    try {
      var r = await fetch("/api/auth/me", {
        headers: { "Authorization": "Bearer " + adminToken }
      });
      if (r.ok) {
        var user = await r.json();
        if (user.role === "admin" || user.role === "super_admin") {
          showAdminApp();
  localStorage.setItem("peiwang_token", adminToken);
          return;
        }
      }
    } catch(e) {}
    localStorage.removeItem("peiwang_admin_token");
    adminToken = null;
  }
  showAdminLogin();
})();

function showAdminLogin() {
  document.getElementById("admin-login-screen").classList.remove("hidden");
  document.getElementById("admin-login-screen").style.display = "flex";
  document.getElementById("admin-app").classList.add("hidden");
}

function showAdminApp() {
  document.getElementById("admin-login-screen").classList.add("hidden");
  document.getElementById("admin-login-screen").style.display = "none";
  document.getElementById("admin-app").classList.remove("hidden");
  loadOrders();
}

var adminLoginKeyToken = null;

async function adminLogin() {
  var username = document.getElementById("admin-login-user").value.trim();
  var password = document.getElementById("admin-login-pass").value;
  var errEl = document.getElementById("admin-login-error");
  if (!username || !password) {
    errEl.textContent = "请输入用户名和密码";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    var body = { username: username, password: password };
    var keyInput = document.getElementById("admin-static-key");
    var keyFields = document.getElementById("admin-key-fields");
    if (keyInput && keyFields && !keyFields.classList.contains("hidden")) {
      if (!keyInput.value) { errEl.textContent = "请输入静态密钥"; errEl.classList.remove("hidden"); return; }
      body.static_key = keyInput.value.trim();
    }
    var r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    var data = await r.json();
    if (data.need_static_key) {
      document.getElementById("admin-login-fields").classList.add("hidden");
      document.getElementById("admin-key-fields").classList.remove("hidden");
      document.getElementById("admin-login-btn").textContent = "验证密钥";
      document.getElementById("admin-static-key").focus();
      errEl.classList.add("hidden");
      return;
    }
    if (!r.ok || (data.user.role !== "admin" && data.user.role !== "super_admin")) {
      errEl.textContent = data.error || "非管理员账号";
      errEl.classList.remove("hidden");
      return;
    }
    adminToken = data.token;
    adminRole = data.user.role;
    adminUserId = data.user.id;
    localStorage.setItem("peiwang_admin_token", adminToken);
    showAdminApp();
  } catch(e) {
    errEl.textContent = "网络错误";
    errEl.classList.remove("hidden");
  }
}

function adminLogout() {
  if (adminToken) {
    fetch("/api/auth/logout", { method: "POST", headers: { "Authorization": adminToken } }).catch(function(){});
  }
  localStorage.removeItem("peiwang_admin_token");
  adminToken = null;
  showAdminLogin();
}

// ======================== 管理功能 ========================
// ======================== 全局变量 ========================
var currentOrders = [];
// ======================== 分页状态 ========================
var PAGE_SIZE = 8;
var ordersPage = 1;
var menuPage = 1;
var consumptionPage = 1;

function renderPagination(total, page, pageSize, onPage) {
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return '';
  var html = '<div class="pagination" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:12px 0;">';
  html += '<button class="btn btn-sm btn-default" onclick="' + onPage + '(' + (page-1) + ')"' + (page<=1?' disabled':'') + '>上一页</button>';
  html += '<span style="font-size:13px;color:#666;">第 ' + page + ' / ' + totalPages + ' 页</span>';
  html += '<button class="btn btn-sm btn-default" onclick="' + onPage + '(' + (page+1) + ')"' + (page>=totalPages?' disabled':'') + '>下一页</button>';
  html += '</div>';
  return html;
}
var currentMenuItems = [];
var currentConsumption = [];
var currentChatOrders = [];

// ======================== 标签切换 ========================
function switchTab(tabName) {
  var tabs = document.querySelectorAll(".admin-tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.remove("active");
  }
  var tabEl = document.getElementById("tab-" + tabName);
  if (tabEl) tabEl.classList.add("active");

  var navs = document.querySelectorAll(".nav-item");
  for (var i = 0; i < navs.length; i++) {
    navs[i].classList.toggle("active", navs[i].getAttribute("data-tab") === tabName);
  }

  // 加载相应数据
  if (tabName === "users") loadUsers();
  else if (tabName === "settings") loadSettings();
  else if (tabName === "admin-users") loadAdminUsers();
    else if (tabName === "categories") loadCategories();
    else if (tabName === "orders") loadOrders();
  else if (tabName === "menu") loadMenuItems();
  else if (tabName === "chat") loadChatList();
  else if (tabName === "consumption") loadConsumption();
}

// ======================== API 工具 ========================
async function apiGet(url) {
  var r = await fetch(url, { headers: { "Authorization": "Bearer " + adminToken } });
  if (!r.ok) throw new Error("请求失败");
  return r.json();
}

async function apiPost(url, data) {
  var r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + adminToken },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error("请求失败");
  return r.json();
}

async function apiPut(url, data) {
  var r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + adminToken },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error("请求失败");
  return r.json();
}

async function apiDelete(url) {
  var r = await fetch(url, { method: "DELETE", headers: { "Authorization": "Bearer " + adminToken } });
  if (!r.ok) throw new Error("请求失败");
  return r.json();
}

// ======================== 弹窗 ========================
function showModal(title, bodyHtml) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

// ======================== 订单管理 ========================
async function loadOrders() {
  var filter = document.getElementById("order-filter").value;
  var url = "/api/orders";
  if (filter) url += "?status=" + filter;
  currentOrders = await apiGet(url);
  renderOrders();
}

function renderOrders() {
  var container = document.getElementById("order-table-container");
  if (!currentOrders || currentOrders.length === 0) {
    container.innerHTML = "<div class='empty-state'>" + "暂无订单" + "</div>";
    return;
  }
  var total = currentOrders.length;
  var start = (ordersPage - 1) * PAGE_SIZE;
  var end = Math.min(start + PAGE_SIZE, total);
  var pageData = currentOrders.slice(start, end);
  var html = "<div class='table-container'><table><thead><tr>";
  html += "<th>#</th><th>菜品</th><th>客户</th><th>联系</th><th>数量</th><th>金额</th><th>状态</th><th>备注</th><th>操作</th>";
  html += "</tr></thead><tbody>";
  for (var i = 0; i < pageData.length; i++) {
    var o = pageData[i];
    html += "<tr>";
    html += "<td>" + o.id + "</td>";
    html += "<td>" + escapeHtml(o.menu_name || "未知") + "</td>";
    html += "<td>" + escapeHtml(o.customer_name) + "</td>";
    html += "<td>" + escapeHtml(o.customer_contact) + "</td>";
    html += "<td>" + o.quantity + "</td>";
    html += "<td>¥" + o.total_price + "</td>";
    html += "<td><span class='status-badge status-" + o.status + "'>" + statusLabel(o.status) + "</span></td>";
    html += "<td>" + escapeHtml(o.remark || "-") + "</td>";
    html += "<td class='action-btns'>";
    if (o.status === "pending") {
      html += "<button class='btn btn-success btn-sm' onclick='confirmOrder(" + o.id + ")'>" + "确认" + "</button>";
      html += "<button class='btn btn-warning btn-sm' onclick='cancelOrder(" + o.id + ")'>" + "取消" + "</button>";
    }
    if (o.status === "confirmed") {
      html += "<button class='btn btn-primary btn-sm' onclick='completeOrder(" + o.id + ")'>" + "完成" + "</button>";
    }
    html += "<button class='btn btn-danger btn-sm' onclick='deleteOrder(" + o.id + ")'>" + "删除" + "</button>";
    html += "</td></tr>";
  }
  html += "</tbody></table></div>";
  html += "<div style='text-align:center;padding:8px 0;'><span style='font-size:13px;color:#999;'>共 " + total + " 条，显示 " + (start+1) + "-" + end + "</span></div>";
  html += renderPagination(total, ordersPage, PAGE_SIZE, "goOrdersPage");
  container.innerHTML = html;
}

function goOrdersPage(p) { ordersPage = p; renderOrders(); }function goOrdersPage(p) { ordersPage = p; renderOrders(); }

// 状态标签
function statusLabel(s) {
  var map = { pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消" };
  return map[s] || s;
}

async function confirmOrder(id) {
  if (!confirm("确认此订单？")) return;
  var o = await apiPut("/api/orders/" + id + "/status", { status: "confirmed" });
  notify("订单 #" + id + " 已确认，已添加到消费记录");
  loadOrders();
}

async function cancelOrder(id) {
  if (!confirm("取消此订单？")) return;
  await apiPut("/api/orders/" + id + "/status", { status: "cancelled" });
  notify("订单 #" + id + " 已取消");
  loadOrders();
}

async function completeOrder(id) {
  await apiPut("/api/orders/" + id + "/status", { status: "completed" });
  notify("订单 #" + id + " 已完成");
  loadOrders();
}

async function deleteOrder(id) {
  if (!confirm("确定删除订单 #" + id + "？")) return;
  await apiDelete("/api/orders/" + id);
  notify("订单 #" + id + " 已删除");
  loadOrders();
}

// ======================== 菜品管理 ========================
async function loadMenuItems() {
  var items = await apiGet("/api/menu-items");
  // 需要包含分类信息
  var cats = await apiGet("/api/categories");
  currentMenuItems = items;
  renderMenuItems(cats);
}

function renderMenuItems(cats) {
  var container = document.getElementById("menu-table-container");
  if (!currentMenuItems || currentMenuItems.length === 0) {
    container.innerHTML = "<div class='empty-state'>" + "暂无菜品" + "，点击右上角新增</div>";
    return;
  }
  var catMap = {};
  for (var i = 0; i < cats.length; i++) catMap[cats[i].id] = cats[i].name;
  var total = currentMenuItems.length;
  var start = (menuPage - 1) * PAGE_SIZE;
  var end = Math.min(start + PAGE_SIZE, total);
  var pageData = currentMenuItems.slice(start, end);
  var html = "<div class='table-container'><table><thead><tr>";
  html += "<th>#</th><th>图片</th><th>名称</th><th>分类</th><th>价格</th><th>描述</th><th>状态</th><th>操作</th>";
  html += "</tr></thead><tbody>";
  for (var i = 0; i < pageData.length; i++) {
    var it = pageData[i];
    html += "<tr>";
    html += "<td>" + it.id + "</td>";
    var imgSrc = it.image || "/uploads/default1.svg";
    html += '<td><img src=\u0022' + imgSrc + '\u0022 style=\u0022width:50px;height:50px;object-fit:cover;border-radius:4px;\u0022></td>';
    html += "<td>" + escapeHtml(it.name) + "</td>";
    html += "<td>" + (catMap[it.category_id] || "未知") + "</td>";
    html += "<td>¥" + it.price + "</td>";
    html += "<td>" + escapeHtml(it.description || "") + "</td>";
    html += "<td>" + (it.is_available ? "上架" : "下架") + "</td>";
    html += "<td class='action-btns'>";
    html += "<button class='btn btn-primary btn-sm' onclick='editMenuItem(" + it.id + ")'>编辑</button>";
    html += "<button class='btn btn-danger btn-sm' onclick='deleteMenuItem(" + it.id + ")'>删除</button>";
    html += "</td></tr>";
  }
  html += "</tbody></table></div>";
  html += "<div style='text-align:center;padding:8px 0;'><span style='font-size:13px;color:#999;'>共 " + total + " 条，显示 " + (start+1) + "-" + end + "</span></div>";
  html += renderPagination(total, menuPage, PAGE_SIZE, "goMenuPage");
  container.innerHTML = html;
}

function goMenuPage(p) { menuPage = p; loadMenuItems(); }function goMenuPage(p) { menuPage = p; loadMenuItems(); }

function showAddMenuItem() {
  showAddEditForm(null);
}

function editMenuItem(id) {
  showAddEditForm(id);
}

async function showAddEditForm(id) {
  var cats = await apiGet("/api/categories");
  var item = null;
  if (id) {
    var items = await apiGet("/api/menu-items");
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) { item = items[i]; break; }
    }
  }

  var catOptions = "";
  for (var i = 0; i < cats.length; i++) {
    var sel = (item && item.category_id === cats[i].id) ? "selected" : "";
    catOptions += "<option value='" + cats[i].id + "' " + sel + ">" + cats[i].icon + " " + cats[i].name + "</option>";
  }

  var title = item ? "编辑项目" : "新增项目";
  var body = "";
  body += "<label><span>分类</span><select id='mi-category'>" + catOptions + "</select></label>";
  body += "<label><span>名称</span><input id='mi-name' value='" + (item ? escapeHtml(item.name) : "") + "'></label>";
  body += "<label><span>价格</span><input id='mi-price' type='number' step='0.01' value='" + (item ? item.price : "") + "'></label>";
  body += "<label><span>描述</span><textarea id='mi-desc'>" + (item ? escapeHtml(item.description || "") : "") + "</textarea></label>";
  body += "<div style='margin-bottom:14px;'><label style='display:block;font-size:13px;color:#666;margin-bottom:4px;'>项目图片</label>" +
    "<div style='display:flex;align-items:center;gap:10px;'>" +
    "<div id='mi-img-preview' style='width:60px;height:60px;border-radius:8px;overflow:hidden;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999;background:#f9f9f9;'>" + (item && item.image ? "<img src='" + item.image + "' style='width:100%;height:100%;object-fit:cover;'>" : "无图片") + "</div>" +
    "<div><input type='file' id='mi-img-input' accept='image/*' style='display:none;' onchange='uploadMenuItemImage()'>" +
    "<button class='btn btn-sm btn-primary' onclick=\"document.getElementById('mi-img-input').click()\">上传图片</button>" +
    "<button class='btn btn-sm btn-default' onclick='clearMenuItemImage()' style='margin-left:4px;'>清除</button></div></div></div>" +
    "<input type='hidden' id='mi-image' value='" + (item ? escapeHtml(item.image || "") : "") + "'>";
  body += "<button class='btn btn-primary' onclick='saveMenuItem(" + (id || "null") + ")'>保存</button>";
  body += "<button class='btn btn-default' onclick='closeModal()'>取消</button>";

  showModal(title, body);
}

async function uploadMenuItemImage() {
  var input = document.getElementById('mi-img-input');
  var file = input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', body: fd });
    if (r.ok) {
      var d = await r.json();
      document.getElementById('mi-image').value = d.url;
      document.getElementById('mi-img-preview').innerHTML = '<img src="' + d.url + '" style="width:100%;height:100%;object-fit:cover;">';
      notify('图片已上传');
    } else { notify('上传失败'); }
  } catch(e) { notify('网络错误'); }
  input.value = '';
}

function clearMenuItemImage() {
  document.getElementById('mi-image').value = '';
  document.getElementById('mi-img-preview').innerHTML = '无图片';
}

async function saveMenuItem(id) {
  var data = {
    category_id: parseInt(document.getElementById("mi-category").value),
    name: document.getElementById("mi-name").value,
    price: parseFloat(document.getElementById("mi-price").value) || 0,
    description: document.getElementById("mi-desc").value,
    image: document.getElementById("mi-image").value
  };

  if (!data.name || !data.price) {
    notify("请填写完整信息");
    return;
  }

  if (id) {
    await apiPut("/api/menu-items/" + id, data);
    notify("项目已更新");
  } else {
    await apiPost("/api/menu-items", data);
    notify("项目已添加");
  }

  closeModal();
  loadMenuItems();
}

async function deleteMenuItem(id) {
  if (!confirm("确定删除此菜品？")) return;
  await apiDelete("/api/menu-items/" + id);
  notify("项目已删除");
  loadMenuItems();
}

// ======================== 客服聊天 ========================
async function loadChatList() {
  var orders = await apiGet("/api/orders");
  currentChatOrders = orders;

  // 只显示待确认和已确认的订单（有聊天的必要）
  var chatOrders = orders.filter(function(o) {
    return o.status === "pending" || o.status === "confirmed";
  });

  var container = document.getElementById("chat-list-container");
  if (!chatOrders || chatOrders.length === 0) {
    container.innerHTML = "<div class='empty-state'>暂无待处理的聊天</div>";
    return;
  }

  var html = "<div class='order-chat-list'>";
  for (var i = 0; i < chatOrders.length; i++) {
    var o = chatOrders[i];
    html += "<div class='chat-order-card' onclick='showAdminChat(" + o.id + ")'>";
    html += "<h4>订单 #" + o.id + " - " + escapeHtml(o.menu_name || "未知") + "</h4>";
    html += "<p>客户: " + escapeHtml(o.customer_name) + " | " + escapeHtml(o.customer_contact || "无联系方式") + "</p>";
    html += "<p>金额: ¥" + o.total_price + " | 状态: <span class='status-badge status-" + o.status + "'>" + statusLabel(o.status) + "</span></p>";
    html += "</div>";
  }
  html += "</div>";

  container.innerHTML = html;
}

var adminChatOrderId = null;

async function showAdminChat(orderId) {
  adminChatOrderId = orderId;
  var msgs = await apiGet("/api/chat/" + orderId);

  var orderInfo = null;
  for (var i = 0; i < currentChatOrders.length; i++) {
    if (currentChatOrders[i].id === orderId) { orderInfo = currentChatOrders[i]; break; }
  }

  // 如果不在当前列表中，从全部订单找
  if (!orderInfo) {
    for (var i = 0; i < currentOrders.length; i++) {
      if (currentOrders[i].id === orderId) { orderInfo = currentOrders[i]; break; }
    }
  }

  var title = "客服聊天 - 订单 #" + orderId;
  if (orderInfo) title += " " + orderInfo.menu_name;

  var body = "<div class='chat-box'>";
  body += "<div class='chat-msgs' id='admin-chat-msgs'>";

  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    var senderName = m.sender === "customer" ? "客户" : (m.sender === "admin" ? "客服" : m.sender);
    if (m.image) {
      body += "<p><b>" + senderName + ":</b><br><img src='" + m.image + "' style='max-width:200px;max-height:200px;border-radius:8px;margin-top:4px;cursor:pointer;' onclick='window.open(\"" + m.image + "\")'></p>";
    } else {
      body += "<p><b>" + senderName + ":</b> " + escapeHtml(m.message) + "</p>";
    }
  }

  body += "</div>";
  body += "<div class='chat-input-area'>";
  body += "<div style='display:flex;gap:6px;'>";
  body += "<input id='admin-chat-input' placeholder='输入回复...' onkeydown='if(event.key===\"Enter\")adminSendChat()' style='flex:1;'>";
  body += "<button class='btn btn-sm btn-default' onclick='adminSelectImage()' title='发送图片' style='font-size:18px;padding:6px 10px;'>🖼</button>";
  body += "<button class='btn btn-primary' onclick='adminSendChat()'>发送</button>";
  body += "</div>";
  body += "<input type='file' id='admin-chat-img-input' accept='image/*' style='display:none;' onchange='adminSendImage()'>";
  showModal(title, body);

  // 滚动到底部
  setTimeout(function() {
    var el = document.getElementById("admin-chat-msgs");
    if (el) el.scrollTop = el.scrollHeight;
  }, 100);
}

function adminSelectImage() {
  document.getElementById('admin-chat-img-input').click();
}

async function adminSendImage() {
  var input = document.getElementById('admin-chat-img-input');
  var file = input.files[0];
  if (!file || !adminChatOrderId) return;
  input.value = '';
  var fd = new FormData();
  fd.append('sender', 'admin');
  fd.append('message', '');
  fd.append('image', file);
  try {
    var r = await fetch('/api/chat/' + adminChatOrderId, { method: 'POST', body: fd });
    if (!r.ok) { notify('发送失败'); return; }
    var msgBox = document.getElementById('admin-chat-msgs');
    if (msgBox) {
      var p = document.createElement('p');
      p.innerHTML = "<b>客服:</b><br><img src='" + URL.createObjectURL(file) + "' style='max-width:200px;max-height:200px;border-radius:8px;margin-top:4px;cursor:pointer;' onclick='window.open(this.src)'>";
      msgBox.appendChild(p);
      msgBox.scrollTop = msgBox.scrollHeight;
    }
    loadChatList();
  } catch(e) { notify('网络错误'); }
}

async function adminSendChat() {
  var input = document.getElementById("admin-chat-input");
  var text = input.value.trim();
  if (!text || !adminChatOrderId) return;
  input.value = "";

  await apiPost("/api/chat/" + adminChatOrderId, {
    sender: "admin",
    message: text
  });

  var msgBox = document.getElementById("admin-chat-msgs");
  if (msgBox) {
    var p = document.createElement("p");
    p.innerHTML = "<b>客服:</b> " + escapeHtml(text);
    msgBox.appendChild(p);
    msgBox.scrollTop = msgBox.scrollHeight;
  }
}

// ======================== 消费记录 ========================
async function loadConsumption() {
  currentConsumption = await apiGet("/api/consumption");
  renderConsumption();
}

function renderConsumption() {
  var container = document.getElementById("consumption-table-container");
  if (!currentConsumption || currentConsumption.length === 0) {
    container.innerHTML = "<div class='empty-state'>" + "暂无消费记录" + "</div>";
    return;
  }
  var total = currentConsumption.length;
  var start = (consumptionPage - 1) * PAGE_SIZE;
  var end = Math.min(start + PAGE_SIZE, total);
  var pageData = currentConsumption.slice(start, end);
  var html = "<div class='table-container'><table><thead><tr>";
  html += "<th>#</th><th>订单号</th><th>客户</th><th>服务</th><th>数量</th><th>金额</th><th>确认时间</th><th>操作</th>";
  html += "</tr></thead><tbody>";
  for (var i = 0; i < pageData.length; i++) {
    var r = pageData[i];
    var time = r.confirmed_at ? new Date(r.confirmed_at).toLocaleString("zh-CN") : "-";
    html += "<tr>";
    html += "<td>" + r.id + "</td>";
    html += "<td>#" + r.order_id + "</td>";
    html += "<td>" + escapeHtml(r.customer_name) + "</td>";
    html += "<td>" + escapeHtml(r.menu_item_name) + "</td>";
    html += "<td>" + r.quantity + "</td>";
    html += "<td>¥" + r.total_price + "</td>";
    html += "<td>" + time + "</td>";
    html += "<td><button class='btn btn-primary btn-sm' onclick='editConsumption(" + r.id + ")'>编辑</button> <button class='btn btn-danger btn-sm' onclick='deleteConsumption(" + r.id + ")'>删除</button></td>";
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  html += "<div style='text-align:center;padding:8px 0;'><span style='font-size:13px;color:#999;'>共 " + total + " 条，显示 " + (start+1) + "-" + end + "</span></div>";
  html += renderPagination(total, consumptionPage, PAGE_SIZE, "goConsumptionPage");
  container.innerHTML = html;
}

function goConsumptionPage(p) { consumptionPage = p; renderConsumption(); }function goConsumptionPage(p) { consumptionPage = p; renderConsumption(); }


// ======================== 消费记录增删改 ========================
var editingConsumptionId = null;

function showAddConsumption() {
  editingConsumptionId = null;
  var body = "";
  body += "<label><span>客户名称</span><input id='cr-customer' value=''></label>";
  body += "<label><span>服务项目</span><input id='cr-service' value=''></label>";
  body += "<label><span>数量</span><input id='cr-qty' type='number' value='1'></label>";
  body += "<label><span>金额</span><input id='cr-price' type='number' step='0.01' value='0'></label>";
  body += "<button class='btn btn-primary' onclick='saveConsumption()'>保存</button>";
  body += "<button class='btn btn-default' onclick='closeModal()'>取消</button>";
  showModal("新增消费记录", body);
}

function editConsumption(id) {
  var r = null;
  for (var i = 0; i < currentConsumption.length; i++) {
    if (currentConsumption[i].id === id) { r = currentConsumption[i]; break; }
  }
  if (!r) { notify("未找到记录"); return; }
  editingConsumptionId = id;
  var body = "";
  body += "<label><span>客户名称</span><input id='cr-customer' value='" + escapeHtml(r.customer_name) + "'></label>";
  body += "<label><span>服务项目</span><input id='cr-service' value='" + escapeHtml(r.menu_item_name) + "'></label>";
  body += "<label><span>数量</span><input id='cr-qty' type='number' value='" + r.quantity + "'></label>";
  body += "<label><span>金额</span><input id='cr-price' type='number' step='0.01' value='" + r.total_price + "'></label>";
  body += "<button class='btn btn-primary' onclick='saveConsumption()'>保存</button>";
  body += "<button class='btn btn-default' onclick='closeModal()'>取消</button>";
  showModal("编辑消费记录 #" + id, body);
}

async function saveConsumption() {
  var data = {
    customer_name: document.getElementById("cr-customer").value.trim(),
    menu_item_name: document.getElementById("cr-service").value.trim(),
    quantity: parseInt(document.getElementById("cr-qty").value) || 1,
    total_price: parseFloat(document.getElementById("cr-price").value) || 0
  };
  if (!data.customer_name || !data.menu_item_name) { notify("请填写完整"); return; }
  try {
    if (editingConsumptionId) {
      await apiPut("/api/consumption/" + editingConsumptionId, data);
      notify("已更新");
    } else {
      await apiPost("/api/consumption", data);
      notify("已添加");
    }
    closeModal();
    loadConsumption();
  } catch(e) { notify("操作失败"); }
}

async function deleteConsumption(id) {
  if (!confirm("确定删除此记录 #" + id + "？")) return;
  await apiDelete("/api/consumption/" + id);
  notify("已删除");
  loadConsumption();
}

// ======================== 通用工具 ========================
function escapeHtml(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function notify(msg) {
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:20px;right:20px;background:#001529;color:#fff;padding:12px 20px;border-radius:8px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:fadeIn 0.3s ease;";
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(function() { d.remove(); }, 3000);
}

// ======================== SSE 实时连接 ========================
(function connectSSE() {
  var evtSource = new EventSource("/api/events");
  evtSource.addEventListener("new_order", function(e) {
    var data = JSON.parse(e.data);
    notify("新订单 #" + data.id + " 来自 " + (data.customer_name || "游客"));
    if (document.getElementById("tab-orders").classList.contains("active")) loadOrders();
    if (document.getElementById("tab-chat").classList.contains("active")) loadChatList();
  });
  evtSource.addEventListener("order_update", function() {
    if (document.getElementById("tab-orders").classList.contains("active")) loadOrders();
  });
  evtSource.addEventListener("chat_message", function() {
    if (document.getElementById("tab-chat").classList.contains("active")) loadChatList();
  });
  evtSource.addEventListener("menu_update", function() {
    if (document.getElementById("tab-menu").classList.contains("active")) loadMenuItems();
  });
  evtSource.onerror = function() {
    console.warn("SSE 断开，5秒后重连");
    setTimeout(connectSSE, 5000);
  };
})();



// ======================== 网站设置 ========================
async function loadSettings() {
  var container = document.getElementById('settings-container');
  try {
    var s = await apiGet('/api/settings');
    var body = '<div style="max-width:500px;">';

    // 小店图片
    body += '<div style="margin-bottom:16px;">';
    body += '<label style="font-size:13px;color:#666;display:block;margin-bottom:4px;">小店图片</label>';
    body += '<div style="display:flex;align-items:center;gap:12px;">';
    body += '<div id="logo-preview" style="width:60px;height:60px;border-radius:8px;overflow:hidden;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:30px;background:#f9f9f9;">';
    if (s.site_logo_url) body += '<img src="' + escapeHtml(s.site_logo_url) + '" style="width:100%;height:100%;object-fit:cover;">';
    else body += escapeHtml(s.site_logo || '🐾');
    body += '</div><div>';
    body += '<input type="file" id="logo-file-input" accept="image/*" style="display:none;" onchange="uploadLogo()">';
    body += '<button class="btn btn-sm btn-primary" onclick="document.getElementById(\'logo-file-input\').click()">上传图片</button>';
    body += '<button class="btn btn-sm btn-default" onclick="clearLogo()" style="margin-left:4px;">清除</button>';
    body += '<div style="margin-top:4px;font-size:12px;color:#999;">支持 JPG/PNG</div>';
    body += '</div></div></div>';
    body += '<input type="hidden" id="set-logo-url" value="' + escapeHtml(s.site_logo_url || '') + '">';

    // 网站名称
    body += '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">网站名称</label>';
    body += '<input id="set-name" value="' + escapeHtml(s.site_name || '') + '" style="width:100%;max-width:400px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;"></div>';

    // 描述语
    body += '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">描述语</label>';
    body += '<input id="set-desc" value="' + escapeHtml(s.site_description || '') + '" style="width:100%;max-width:400px;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;"></div>';

    // 背景视频
    body += '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">背景视频</label>';
    body += '<div style="display:flex;align-items:center;gap:10px;">';
    body += '<div id="video-preview" style="width:80px;height:50px;border-radius:6px;overflow:hidden;border:1px solid #ddd;background:#f9f9f9;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;">';
    body += (s.site_video_url ? '✓' : '未设置') + '</div>';
    body += '<div><input type="file" id="video-file-input" accept="video/*" style="display:none;" onchange="uploadSiteVideo()">';
    body += '<button class="btn btn-sm btn-primary" onclick="document.getElementById(\'video-file-input\').click()">上传视频</button>';
    body += '<button class="btn btn-sm btn-default" onclick="clearSiteVideo()" style="margin-left:4px;">清除</button>';
    body += '</div></div></div>';
    body += '<input type="hidden" id="set-video-url" value="' + escapeHtml(s.site_video_url || '') + '">';

    // 侧边栏背景图
    body += '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">侧边栏背景图</label>';
    body += '<div style="display:flex;align-items:center;gap:10px;">';
    body += '<div id="sidebar-bg-preview" style="width:60px;height:60px;border-radius:8px;overflow:hidden;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;background:#f9f9f9;">';
    if (s.site_sidebar_bg) body += '<img src="' + escapeHtml(s.site_sidebar_bg) + '" style="width:100%;height:100%;object-fit:cover;">';
    else body += '未设置';
    body += '</div><div>';
    body += '<input type="file" id="sidebar-bg-file-input" accept="image/*" style="display:none;" onchange="uploadSidebarBg()">';
    body += '<button class="btn btn-sm btn-primary" onclick="document.getElementById(\'sidebar-bg-file-input\').click()">上传图片</button>';
    body += '<button class="btn btn-sm btn-default" onclick="clearSidebarBg()" style="margin-left:4px;">清除</button>';
    body += '</div></div></div>';
    body += '<input type="hidden" id="set-sidebar-bg" value="' + escapeHtml(s.site_sidebar_bg || '') + '">';

    // 登录背景图
    body += '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;color:#666;margin-bottom:4px;">登录背景图</label>';
    body += '<div style="display:flex;align-items:center;gap:10px;">';
    body += '<div id="login-bg-preview" style="width:80px;height:50px;border-radius:6px;overflow:hidden;border:1px solid #ddd;background:#f9f9f9;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;">';
    if (s.site_login_bg) body += '<img src="' + escapeHtml(s.site_login_bg) + '" style="width:100%;height:100%;object-fit:cover;">';
    else body += '未设置';
    body += '</div><div>';
    body += '<input type="file" id="login-bg-file-input" accept="image/*" style="display:none;" onchange="uploadLoginBg()">';
    body += '<button class="btn btn-sm btn-primary" onclick="document.getElementById(\'login-bg-file-input\').click()">上传图片</button>';
    body += '<button class="btn btn-sm btn-default" onclick="clearLoginBg()" style="margin-left:4px;">清除</button>';
    body += '</div></div></div>';
    body += '<input type="hidden" id="set-login-bg" value="' + escapeHtml(s.site_login_bg || '') + '">';

    // 静态密钥
    body += '<div style="margin-bottom:16px;"><label style="font-size:13px;color:#666;display:block;margin-bottom:4px;">静态密钥（超级管理员异地登录验证）</label>';
    body += '<input id="set-static-key" value="' + escapeHtml(s.static_key || "133900923@") + '" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;"></div>';

    // 保存按钮
    body += '<div style="margin-top:16px;">';
    body += '<button class="btn btn-primary" onclick="saveSettings()">保存设置</button>';
    body += ' <span id="settings-status" style="color:#52c41a;margin-left:10px;font-size:13px;"></span>';
    body += '</div></div>';
    
    container.innerHTML = body;
  } catch(e) {
    container.innerHTML = '<div class="empty-state">加载失败: ' + e.message + '</div>';
  }
}



async function uploadLogo() {
  var fileInput = document.getElementById('logo-file-input');
  var file = fileInput.files[0];
  if (!file) return;
  var formData = new FormData();
  formData.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: formData });
    if (r.ok) {
      var data = await r.json();
      document.getElementById('set-logo-url').value = data.url;
      document.getElementById('logo-preview').innerHTML = '<img src="' + data.url + '" style="width:100%;height:100%;object-fit:cover;">';
      notify('图片已上传');
    } else {
      notify('上传失败');
    }
  } catch(e) { notify('网络错误'); }
  fileInput.value = '';
}

async function uploadSiteVideo() {
  var input = document.getElementById('video-file-input');
  var file = input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: fd });
    if (r.ok) {
      var d = await r.json();
      document.getElementById('set-video-url').value = d.url;
      document.getElementById('video-preview').innerHTML = '✓';
      notify('视频已上传');
    } else { notify('上传失败'); }
  } catch(e) { notify('网络错误'); }
  input.value = '';
}

function clearSiteVideo() {
  document.getElementById('set-video-url').value = '';
  document.getElementById('video-preview').innerHTML = '未设置';
}

function clearLogo() {
  document.getElementById('set-logo-url').value = '';
  document.getElementById('logo-preview').innerHTML = '🐾';
}

function clearLogo() {
  document.getElementById('set-logo-url').value = '';
  document.getElementById('logo-preview').innerHTML = '🐾';
}

async function saveSettings() {
  var data = {
    site_logo_url: document.getElementById('set-logo-url').value,
    site_name: document.getElementById('set-name').value.trim(),
    site_description: document.getElementById('set-desc').value.trim(),
    site_video_url: document.getElementById('set-video-url').value,
    site_sidebar_bg: document.getElementById('set-sidebar-bg').value,
    site_login_bg: document.getElementById('set-login-bg').value,
    static_key: document.getElementById('set-static-key').value.trim()
  };
  try {
    var r = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify(data)
    });
    if (r.ok) {
      document.getElementById('settings-status').textContent = '✅ 已保存';
      setTimeout(function(){ document.getElementById('settings-status').textContent = ''; }, 3000);
      notify('网站设置已更新');
    } else {
      var errData = await r.json().catch(function(){ return {error: '未知错误'}; });
      document.getElementById('settings-status').textContent = '❌ 保存失败: ' + (errData.error || r.status);
    }
  } catch(e) {
    document.getElementById('settings-status').textContent = '❌ 网络错误';
  }
}

async function uploadLoginBg() {
  var fileInput = document.getElementById('login-bg-file-input');
  var file = fileInput.files[0];
  if (!file) return;
  var formData = new FormData();
  formData.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: formData });
    if (r.ok) {
      var data = await r.json();
      document.getElementById('set-login-bg').value = data.url;
      document.getElementById('login-bg-preview').innerHTML = '<img src="' + data.url + '" style="width:100%;height:100%;object-fit:cover;">';
      notify('图片已上传');
    } else { notify('上传失败'); }
  } catch(e) { notify('网络错误'); }
  fileInput.value = '';
}

function clearLoginBg() {
  document.getElementById('set-login-bg').value = '';
  document.getElementById('login-bg-preview').innerHTML = '未设置';
}

async function uploadSidebarBg() {
  var fileInput = document.getElementById('sidebar-bg-file-input');
  var file = fileInput.files[0];
  if (!file) return;
  var formData = new FormData();
  formData.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: formData });
    if (r.ok) {
      var data = await r.json();
      document.getElementById('set-sidebar-bg').value = data.url;
      document.getElementById('sidebar-bg-preview').innerHTML = '<img src="' + data.url + '" style="width:100%;height:100%;object-fit:cover;">';
      notify('图片已上传');
    } else { notify('上传失败'); }
  } catch(e) { notify('网络错误'); }
  fileInput.value = '';
}

function clearSidebarBg() {
  document.getElementById('set-sidebar-bg').value = '';
  document.getElementById('sidebar-bg-preview').innerHTML = '未设置';
}

function closeForm(id){var el=document.getElementById(id);if(el)el.remove();}