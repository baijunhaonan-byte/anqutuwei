// ======================== 用户管理 ========================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function loadUsers() {
  var container = document.getElementById('user-table-container');
  try {
    var r = await fetch('/api/users', {
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    if (!r.ok) { container.innerHTML = '<div class="empty-state">加载失败</div>'; return; }
    var users = await r.json();
    var html = '<div class="table-container"><table><thead><tr><th>ID</th><th>用户名</th><th>邮箱</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var time = u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '-';
      var name = escapeHtml(u.username);
      var email = escapeHtml(u.email || '-');
      var roleLabel = u.role === 'super_admin' ? '超级管理员' : (u.role === 'admin' ? '管理员' : '客户');
      html += '<tr><td>' + u.id + '</td><td>' + name + '</td><td>' + email + '</td><td>' + roleLabel + '</td><td>' + time + '</td>';
      html += '<td>';
      html += '<button class="btn btn-primary btn-sm" onclick="showEditUser(' + u.id + ')">编辑</button>';
      // 不能删除自己
      if (u.id !== adminUserId) {
        html += ' <button class="btn btn-danger btn-sm" onclick="confirmDeleteUser(' + u.id + ')">删除</button>';
      }
      html += '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="empty-state">加载失败: ' + escapeHtml(e.message) + '</div>';
  }
}

function confirmDeleteUser(id) {
  if (!confirm('确定删除该用户？此操作不可恢复！')) return;
  doDeleteUser(id);
}

async function doDeleteUser(id) {
  try {
    var r = await fetch('/api/users/' + id, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    if (r.ok) {
      notify('用户已删除');
      loadUsers();
    } else {
      var d = await r.json();
      notify(d.error || '删除失败');
    }
  } catch(e) {
    notify('网络错误');
  }
}

// ======================== 编辑用户（含角色选择）=======================
var editingUserId = null;

// 通过 API 获取用户数据，避免 onclick 转义问题
async function showEditUser(id) {
  editingUserId = id;
  try {
    var r = await fetch('/api/users', {
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    if (!r.ok) { notify('获取用户数据失败'); return; }
    var users = await r.json();
    var u = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) { u = users[i]; break; }
    }
    if (!u) { notify('用户不存在'); return; }

    document.getElementById('modal-title').textContent = '编辑用户 - ' + escapeHtml(u.username);
    var body = '';
    body += '<label><span>用户名</span><input id="edit-username" value="' + escapeHtml(u.username) + '"></label>';
    body += '<label><span>邮箱</span><input id="edit-email" value="' + escapeHtml(u.email || '') + '"></label>';
    body += '<label><span>新密码</span><input id="edit-password" type="password" placeholder="留空不修改密码"></label>';
    // 角色选择（仅超级管理员可修改角色）
    if (adminRole === 'super_admin') {
      body += '<label><span>角色</span><select id="edit-role">';
      var roles = [
        { v: 'customer', l: '客户' },
        { v: 'admin', l: '管理员' },
        { v: 'super_admin', l: '超级管理员' }
      ];
      for (var ri = 0; ri < roles.length; ri++) {
        var sel = roles[ri].v === u.role ? ' selected' : '';
        body += '<option value="' + roles[ri].v + '"' + sel + '>' + roles[ri].l + '</option>';
      }
      body += '</select></label>';
    }
    body += '<div class="modal-box-actions">';
    body += '<button class="btn btn-primary" onclick="saveEditUser()">保存</button>';
    body += '<button class="btn btn-default" onclick="closeModal()">取消</button>';
    body += '</div>';
    body += '<div id="edit-error" class="form-error hidden"></div>';
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-overlay').classList.remove('hidden');
  } catch(e) {
    notify('获取用户信息失败: ' + e.message);
  }
}

async function saveEditUser() {
  var username = document.getElementById('edit-username').value.trim();
  var email = document.getElementById('edit-email').value.trim();
  var password = document.getElementById('edit-password').value;
  var errEl = document.getElementById('edit-error');
  if (!username) { errEl.textContent = '用户名不能为空'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  var data = { username: username, email: email };
  if (password) data.password = password;
  // 如果有角色选择，带上
  var roleEl = document.getElementById('edit-role');
  if (roleEl) data.role = roleEl.value;
  try {
    var r = await fetch('/api/users/' + editingUserId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify(data)
    });
    if (r.ok) {
      closeModal();
      notify('用户信息已更新');
      loadUsers();
    } else {
      var d = await r.json();
      errEl.textContent = d.error || '更新失败';
      errEl.classList.remove('hidden');
    }
  } catch(e) {
    errEl.textContent = '网络错误';
    errEl.classList.remove('hidden');
  }
}
