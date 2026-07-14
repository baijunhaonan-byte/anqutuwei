// ======================== 分类管理 ========================
async function loadCategories() {
  var container = document.getElementById('category-table-container');
  try {
    var cats = await apiGet('/api/categories');
    var html = '<div class="table-container"><table><thead><tr><th>ID</th><th>图片/图标</th><th>名称</th><th>操作</th></tr></thead><tbody>';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var name = escapeHtml(c.name);
      var imgHtml = '';
      if (c.image) {
        imgHtml = '<img src="' + c.image + '" style="width:50px;height:50px;object-fit:cover;border-radius:6px;" onerror="this.style.display=\'none\'">';
      } else {
        imgHtml = '<span style="font-size:28px;">' + (c.icon || '') + '</span>';
      }
      html += '<tr><td>' + c.id + '</td><td>' + imgHtml + '</td><td>' + name + '</td>';
      html += '<td><button class="btn btn-primary btn-sm" onclick="showEditCategory(' + c.id + ',\'' + name + '\',\'' + escapeHtml(c.icon || '') + '\',\'' + escapeHtml(c.image || '') + '\')">编辑</button></td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="empty-state">加载失败: ' + e.message + '</div>';
  }
}

var editingCategoryId = null;

function showEditCategory(id, name, icon, image) {
  editingCategoryId = id;
  document.getElementById('modal-title').textContent = '编辑分类 - ' + name;
  var body = '';
  body += '<label><span>名称</span><input id="edit-cat-name" value="' + escapeHtml(name) + '"></label>';
  body += '<div style="margin-bottom:14px;">';
  body += '<label style="font-size:13px;color:#666;display:block;margin-bottom:4px;">分类图片</label>';
  body += '<div style="display:flex;align-items:center;gap:10px;">';
  body += '<div id="cat-img-preview" style="width:60px;height:60px;border-radius:8px;overflow:hidden;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:28px;background:#f9f9f9;">';
  if (image) body += '<img src="' + image + '" style="width:100%;height:100%;object-fit:cover;">';
  else if (icon) body += '<span>' + icon + '</span>';
  else body += '?';
  body += '</div>';
  body += '<div>';
  body += '<input type="file" id="cat-img-input" accept="image/*" style="display:none;" onchange="uploadCatImage()">';
  body += '<button class="btn btn-sm btn-primary" onclick="document.getElementById(\'cat-img-input\').click()">上传图片</button>';
  body += '<button class="btn btn-sm btn-default" onclick="clearCatImage()" style="margin-left:4px;">清除</button>';
  body += '</div></div></div>';
  body += '<input type="hidden" id="edit-cat-image" value="' + escapeHtml(image || '') + '">';
  body += '<input type="hidden" id="edit-cat-icon" value="' + escapeHtml(icon || '') + '">';
  body += '<div class="modal-box-actions">';
  body += '<button class="btn btn-primary" onclick="saveEditCategory()">保存</button>';
  body += '<button class="btn btn-default" onclick="closeModal()">取消</button>';
  body += '</div>';
  body += '<div id="cat-edit-error" class="form-error hidden"></div>';
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function uploadCatImage() {
  var input = document.getElementById('cat-img-input');
  var file = input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('image', file);
  try {
    var r = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (window.adminToken || '') }, body: fd });
    if (r.ok) {
      var d = await r.json();
      document.getElementById('edit-cat-image').value = d.url;
      document.getElementById('cat-img-preview').innerHTML = '<img src="' + d.url + '" style="width:100%;height:100%;object-fit:cover;">';
      notify('图片已上传');
    } else { notify('上传失败'); }
  } catch(e) { notify('网络错误'); }
  input.value = '';
}

function clearCatImage() {
  document.getElementById('edit-cat-image').value = '';
  var icon = document.getElementById('edit-cat-icon').value;
  document.getElementById('cat-img-preview').innerHTML = icon ? '<span>' + icon + '</span>' : '?';
}

async function saveEditCategory() {
  var name = document.getElementById('edit-cat-name').value.trim();
  var image = document.getElementById('edit-cat-image').value.trim();
  var errEl = document.getElementById('cat-edit-error');
  if (!name) { errEl.textContent = '名称不能为空'; errEl.classList.remove('hidden'); return; }
  errEl.classList.add('hidden');
  try {
    var r = await fetch('/api/categories/' + editingCategoryId, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window.adminToken || '') },
      method: 'PUT',
      body: JSON.stringify({ name: name, image: image })
    });
    if (r.ok) {
      closeModal();
      notify('分类已更新');
      loadCategories();
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
