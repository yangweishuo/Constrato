/* Constrato 仪表盘前端逻辑（原生 JS，无构建依赖） */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  meta: null,
  adminKey: localStorage.getItem('constrato_admin_key') || '',
  apiKey: localStorage.getItem('constrato_api_key') || '',
  selectedId: null,
};

function apiHeaders(extra = {}) {
  const h = { 'content-type': 'application/json', ...extra };
  if (state.adminKey) h['x-admin-key'] = state.adminKey;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...apiHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = `${res.status} ${(await res.json()).message || ''}`; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ----------------------------- 启动门禁 ----------------------------- */
function checkGate() {
  if (state.adminKey) {
    boot();
  } else {
    $('#admin-gate').classList.remove('hidden');
  }
}

$('#admin-key-btn').addEventListener('click', () => {
  const v = $('#admin-key-input').value.trim();
  if (!v) return toast('请输入密钥');
  state.adminKey = v;
  localStorage.setItem('constrato_admin_key', v);
  $('#admin-gate').classList.add('hidden');
  boot();
});

$('#refresh-btn').addEventListener('click', loadMeta);
$('#api-key-input').addEventListener('input', (e) => {
  state.apiKey = e.target.value;
  localStorage.setItem('constrato_api_key', e.target.value);
});

async function boot() {
  $('#app').classList.remove('hidden');
  $('#api-key-input').value = state.apiKey;
  await loadMeta();
}

async function loadMeta() {
  try {
    state.meta = await api('/__meta');
    renderStat();
    renderSidebar();
    renderOverview();
    if (state.selectedId) renderRouteDetail(state.selectedId);
    else showPanel('overview');
  } catch (e) {
    toast('加载失败：' + e.message);
    $('#admin-gate').classList.remove('hidden');
  }
}

function renderStat() {
  const m = state.meta;
  $('#stat').textContent = `${m.counts.routes} 接口 · ${m.counts.publicRoutes} 公开 · ${m.counts.mocked} Mock · ${m.counts.datasources} 数据源`;
}

/* ----------------------------- 侧边栏 ----------------------------- */
function renderSidebar() {
  const routes = state.meta.routes;
  const tags = {};
  for (const r of routes) (tags[r.tags[0]] ||= []).push(r);

  let html = `<div class="route-item" data-special="datasources"><span>🗄️</span><span class="route-path">数据源</span></div>`;
  html += `<div class="route-item" data-special="keys"><span>🔑</span><span class="route-path">API 密钥管理</span></div>`;
  html += `<div class="route-item" data-special="security"><span>🔒</span><span class="route-path">安全态势</span></div>`;
  for (const [tag, list] of Object.entries(tags)) {
    html += `<div class="tag-group"><div class="tag-title">${tag}</div>`;
    for (const r of list) {
      const badges = [];
      if (r.public) badges.push('<span class="badge public">public</span>');
      if (r.config.mock) badges.push('<span class="badge mock">mock</span>');
      if (r.config.enabled === false) badges.push('<span class="badge disabled">停用</span>');
      html += `<div class="route-item" data-route="${r.id}">
        <span class="method m-${r.method}">${r.method}</span>
        <span class="route-path">${r.servedPath}</span>
        ${badges.join('')}
      </div>`;
    }
    html += `</div>`;
  }
  $('#route-list').innerHTML = html;

  $$('.route-item[data-route]').forEach((el) =>
    el.addEventListener('click', () => { state.selectedId = el.dataset.route; renderRouteDetail(el.dataset.route); })
  );
  $('.route-item[data-special="datasources"]').addEventListener('click', () => renderDatasources());
  $('.route-item[data-special="keys"]').addEventListener('click', () => renderKeys());
  $('.route-item[data-special="security"]').addEventListener('click', () => renderSecurity());
}

/* ----------------------------- 概览 ----------------------------- */
function renderOverview() {
  const m = state.meta;
  $('#overview').innerHTML = `
    <h2>概览</h2>
    <div class="cards">
      <div class="card"><div class="n">${m.counts.routes}</div><div class="l">接口总数</div></div>
      <div class="card"><div class="n">${m.counts.publicRoutes}</div><div class="l">公开接口</div></div>
      <div class="card"><div class="n">${m.counts.mocked}</div><div class="l">Mock 中</div></div>
      <div class="card"><div class="n">${m.keys.length}</div><div class="l">API Key</div></div>
      <div class="card"><div class="n">${m.versions.join(', ')}</div><div class="l">版本</div></div>
      <div class="card"><div class="n">${m.counts.security ? '✓ 达标' : '⚠ 待加固'}</div><div class="l">安全防护</div></div>
    </div>
    <div class="section">
      <h3>设计理念</h3>
      <p style="color:var(--muted);line-height:1.7">
        每个接口用一份 TypeScript 契约（<code>defineRoute</code>）描述方法、路径、入参/出参 schema 与权限。
        后端在启动时<strong>自动</strong>把这些契约注册成真实路由（含校验、鉴权、限流、Mock），
        并为它们生成下方的文档与调试面板 —— 你只写契约，其余交给框架。
      </p>
    </div>`;
}

/* ----------------------------- 接口详情 ----------------------------- */
let activeTab = 'doc';

function renderRouteDetail(id) {
  showPanel('route-detail');
  const r = state.meta.routes.find((x) => x.id === id);
  if (!r) return;
  state.selectedId = id;

  $$('.route-item[data-route]').forEach((el) => el.classList.toggle('active', el.dataset.route === id));

  $('#route-detail').innerHTML = `
    <div class="detail-head">
      <span class="method m-${r.method}">${r.method}</span>
      <span class="detail-path">${r.servedPath}</span>
      ${r.public ? '<span class="badge public">public</span>' : ''}
      ${r.config.mock ? '<span class="badge mock">mock</span>' : ''}
      ${r.config.enabled === false ? '<span class="badge disabled">停用</span>' : ''}
    </div>
    <div style="color:var(--muted)">${r.summary}${r.version > 1 ? ' · v' + r.version : ''}</div>

    <div class="tabs">
      <div class="tab ${activeTab === 'doc' ? 'active' : ''}" data-tab="doc">文档</div>
      <div class="tab ${activeTab === 'debug' ? 'active' : ''}" data-tab="debug">在线调试</div>
      <div class="tab ${activeTab === 'config' ? 'active' : ''}" data-tab="config">配置 / 权限 / 限流</div>
    </div>

    <div class="tab-body ${activeTab === 'doc' ? 'active' : ''}" data-body="doc">${renderDoc(r)}</div>
    <div class="tab-body ${activeTab === 'debug' ? 'active' : ''}" data-body="debug">${renderDebug(r)}</div>
    <div class="tab-body ${activeTab === 'config' ? 'active' : ''}" data-body="config">${renderConfig(r)}</div>
  `;

  $$('#route-detail .tab').forEach((t) =>
    t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      $$('#route-detail .tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('#route-detail .tab-body').forEach((x) => x.classList.toggle('active', x.dataset.body === activeTab));
    })
  );

  bindDebug(r);
  bindConfig(r);
}

function renderDoc(r) {
  const inHtml = r.inputParts.length
    ? r.inputParts.map((p) => `<div class="section"><h3>入参 · ${p.part}</h3>${schemaTable(p.schema)}</div>`).join('')
    : '<div class="section"><p style="color:var(--muted)">无入参</p></div>';
  const outHtml = r.outputSchema ? `<div class="section"><h3>出参</h3>${schemaTable(r.outputSchema)}</div>` : '';
  const scopes = (r.config.scopes ?? r.scopes).length
    ? (r.config.scopes ?? r.scopes).map((s) => `<span class="scope-chip">${s}</span>`).join(' ')
    : '<span style="color:var(--muted)">无（或公开）</span>';
  return `${inHtml}${outHtml}<div class="section"><h3>权限需求</h3><div class="kv">${scopes}</div></div>`;
}

function schemaTable(schema) {
  const rows = [];
  const props = schema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    const type = v.type || (v.enum ? 'enum' : '?');
    const req = (schema.required || []).includes(k) ? '' : ' <span style="color:var(--muted)">可选</span>';
    const desc = v.description ? ` · ${v.description}` : '';
    rows.push(`<tr><td><code>${k}</code>${req}</td><td>${type}${desc}</td></tr>`);
  }
  if (!rows.length) return '<p style="color:var(--muted)">（空对象）</p>';
  return `<table><thead><tr><th>字段</th><th>类型</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/* ----------------------------- 在线调试 ----------------------------- */
function renderDebug(r) {
  const forms = r.inputParts.map((p) => `<div class="section"><h3>${p.part}</h3><div data-form="${p.part}">${renderFields(p.schema, p.part, '')}</div></div>`).join('');
  return `${forms || '<p style="color:var(--muted)">该接口无入参</p>'}
    <div class="section"><button id="send-btn">▶ 发送请求</button>
    <span class="resp-meta" id="resp-meta"></span>
    <pre class="response" id="resp-box">// 响应将显示在这里</pre></div>`;
}

function renderFields(schema, part, prefix) {
  const props = schema?.properties || {};
  let html = '';
  for (const [k, v] of Object.entries(props)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const type = v.type;
    const label = `${k} <span class="ftype">${type || (v.enum ? 'enum' : '')}${(schema.required || []).includes(k) ? '' : ' 可选'}</span>`;
    if (type === 'object' && v.properties) {
      html += `<div class="field"><label>${label}</label><div style="padding-left:12px;border-left:2px solid var(--border)">${renderFields(v, part, path)}</div></div>`;
    } else if (type === 'array' || type === 'object') {
      html += `<div class="field"><label>${label}</label><textarea data-part="${part}" data-path="${path}" data-json="1" placeholder="JSON"></textarea></div>`;
    } else if (v.enum) {
      html += `<div class="field"><label>${label}</label><select data-part="${part}" data-path="${path}">${v.enum.map((e) => `<option>${e}</option>`).join('')}</select></div>`;
    } else if (type === 'boolean') {
      html += `<div class="field"><label>${label}</label><input type="checkbox" data-part="${part}" data-path="${path}"></div>`;
    } else {
      const it = type === 'number' || type === 'integer' ? 'number' : 'text';
      const ph = v.example ?? '';
      html += `<div class="field"><label>${label}</label><input type="${it}" data-part="${part}" data-path="${path}" placeholder="${ph}"></div>`;
    }
  }
  return html;
}

function collectForm(part) {
  const obj = {};
  $$(`[data-part="${part}"]`).forEach((el) => {
    const path = el.dataset.path;
    let val;
    if (el.dataset.json) {
      if (!el.value.trim()) return;
      try { val = JSON.parse(el.value); } catch { toast('JSON 解析失败: ' + path); throw new Error('bad json'); }
    } else if (el.type === 'checkbox') {
      if (!el.checked) return;
      val = true;
    } else if (el.type === 'number') {
      val = el.value === '' ? undefined : Number(el.value);
    } else {
      if (el.value === '') return;
      val = el.value;
    }
    setPath(obj, path, val);
  });
  return obj;
}

function setPath(obj, path, val) {
  if (!path) { Object.assign(obj, val); return; }
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]] ||= {};
  cur[keys[keys.length - 1]] = val;
}

function bindDebug(r) {
  const btn = $('#send-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      let url = location.origin + r.servedPath;
      const params = collectForm('params');
      for (const [k, v] of Object.entries(params || {})) url = url.replace(`:${k}`, encodeURIComponent(v));
      const query = collectForm('query') || {};
      const qs = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      if (qs) url += '?' + qs;

      const headers = {};
      if (state.apiKey) headers['x-api-key'] = state.apiKey;

      const hasBody = r.inputParts.some((p) => p.part === 'body');
      const body = hasBody ? collectForm('body') : undefined;
      const method = r.method;

      const t0 = performance.now();
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: hasBody ? JSON.stringify(body || {}) : undefined,
      });
      const ms = (performance.now() - t0).toFixed(0);
      let data;
      try { data = await res.json(); } catch { data = await res.text(); }
      const ok = res.ok ? 'ok' : 'err';
      $('#resp-meta').innerHTML = `<span class="${ok}">${res.status} ${res.statusText}</span> · ${ms}ms`;
      $('#resp-box').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch (e) {
      $('#resp-meta').innerHTML = `<span class="err">错误</span>`;
      $('#resp-box').textContent = e.message;
    }
  });
}

/* ----------------------------- 配置 / 权限 / 限流 ----------------------------- */
function renderConfig(r) {
  const scopes = state.meta.scopes.map((s) => {
    const on = (r.config.scopes ?? r.scopes).includes(s);
    return `<label class="toggle"><input type="checkbox" data-scope="${s}" ${on ? 'checked' : ''}> ${s}</label>`;
  }).join('');
  const rl = r.config.rateLimit || { max: 0, windowMs: 60000 };
  return `
    <div class="section">
      <h3>运行状态</h3>
      <label class="toggle"><input type="checkbox" id="cfg-enabled" ${r.config.enabled !== false ? 'checked' : ''}> 启用该接口</label>
      <label class="toggle" style="margin-left:18px"><input type="checkbox" id="cfg-mock" ${r.config.mock ? 'checked' : ''}> Mock 模式（跳过真实逻辑，返回假数据）</label>
    </div>
    <div class="section">
      <h3>权限（所需 scope）</h3>
      <div class="kv">${scopes || '<span style="color:var(--muted)">无可用 scope</span>'}</div>
    </div>
    <div class="section">
      <h3>限流</h3>
      <div class="grid2">
        <div class="field"><label>时间窗内最大请求数（0=不限）</label><input type="number" id="cfg-rl-max" value="${rl.max}"></div>
        <div class="field"><label>时间窗（毫秒）</label><input type="number" id="cfg-rl-win" value="${rl.windowMs}"></div>
      </div>
    </div>
    <button id="cfg-save">保存配置</button>
  `;
}

function bindConfig(r) {
  $('#cfg-save').addEventListener('click', async () => {
    const scopes = $$('[data-scope]:checked').map((el) => el.dataset.scope);
    const max = Number($('#cfg-rl-max').value) || 0;
    const windowMs = Number($('#cfg-rl-win').value) || 60000;
    const payload = {
      mock: $('#cfg-mock').checked,
      enabled: $('#cfg-enabled').checked,
      scopes,
      rateLimit: max > 0 ? { max, windowMs } : null,
    };
    try {
      await api(`/__meta/routes/${r.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('已保存');
      await loadMeta();
    } catch (e) { toast('保存失败：' + e.message); }
  });
}

/* ----------------------------- API Key 管理 ----------------------------- */
function renderKeys() {
  showPanel('keys-panel');
  const keys = state.meta.keys;
  const scopeOpts = state.meta.scopes.map((s) => `<option>${s}</option>`).join('');
  $('#keys-panel').innerHTML = `
    <h2>API 密钥管理</h2>
    <div class="section">
      <h3>新建 Key</h3>
      <div class="grid2">
        <div class="field"><label>名称</label><input id="key-name" placeholder="例如 前端调试"></div>
        <div class="field"><label>授予 scope（Ctrl/⌘ 多选）</label><select id="key-scopes" multiple size="4">${scopeOpts}</select></div>
      </div>
      <button id="key-create">创建</button>
    </div>
    <div class="section">
      <h3>已签发</h3>
      <table><thead><tr><th>名称</th><th>Key</th><th>Scopes</th><th>创建时间</th><th></th></tr></thead>
      <tbody>${keys.map((k) => `<tr>
        <td>${k.name}</td>
        <td class="key-token">${k.key}</td>
        <td>${(k.scopes || []).join(', ') || '-'}</td>
        <td>${new Date(k.createdAt).toLocaleString()}</td>
        <td><button class="ghost" data-revoke="${k.id}">吊销</button></td>
      </tr>`).join('') || '<tr><td colspan="5" style="color:var(--muted)">暂无</td></tr>'}</tbody></table>
    </div>`;
  $('#key-create').addEventListener('click', async () => {
    const name = $('#key-name').value.trim();
    if (!name) return toast('请填名称');
    const scopes = $$('#key-scopes option:checked').map((o) => o.value);
    try {
      const k = await api('/__meta/keys', { method: 'POST', body: JSON.stringify({ name, scopes }) });
      await navigator.clipboard?.writeText(k.key).catch(() => {});
      toast('已创建并复制 Key');
      await loadMeta();
    } catch (e) { toast('创建失败：' + e.message); }
  });
  $$('[data-revoke]').forEach((b) =>
    b.addEventListener('click', async () => {
      try { await api(`/__meta/keys/${b.dataset.revoke}`, { method: 'DELETE' }); toast('已吊销'); await loadMeta(); }
      catch (e) { toast('失败：' + e.message); }
    })
  );
}

/* ----------------------------- 数据源（数据库连接） ----------------------------- */
async function renderDatasources() {
  showPanel('datasources-panel');
  let data;
  try {
    data = await api('/__meta/databases');
  } catch (e) {
    $('#datasources-panel').innerHTML = `<h2>数据源</h2><p style="color:var(--danger)">加载失败：${e.message}</p>`;
    return;
  }
  const BADGE = {
    ok: '<span class="badge ok">健康</span>',
    down: '<span class="badge err">连接失败</span>',
    disabled: '<span class="badge off">已停用</span>',
  };
  const rows = data.databases.length
    ? data.databases
        .map((d) => {
          const status = d.status || (d.ok ? 'ok' : 'down');
          const lat = d.latencyMs != null ? `${d.latencyMs}ms` : '—';
          const msg = d.message ? `<div class="kv" style="color:var(--muted)">${d.message}</div>` : '';
          return `<div class="card-row${status === 'disabled' ? ' is-off' : ''}">
          <div><code>${d.name}</code> <span class="scope-chip">${d.type}</span> ${BADGE[status]}</div>
          <div style="color:var(--muted)">延迟 ${lat}</div>
          ${msg}
        </div>`;
        })
        .join('')
    : '<p style="color:var(--muted)">尚未配置任何数据源。在 buildServer({ databases: [...] }) 中配置后即可在此查看。</p>';

  const overall = data.ok
    ? '<span class="badge ok">全部正常</span>'
    : '<span class="badge err">存在故障</span>';

  $('#datasources-panel').innerHTML = `
    <h2>数据源 ${overall}</h2>
    <div class="cards" style="margin-bottom:14px">
      <div class="card"><div class="n">${data.count}</div><div class="l">已配置</div></div>
      <div class="card"><div class="n">${data.healthy}</div><div class="l">健康</div></div>
      <div class="card"><div class="n">${data.failed}</div><div class="l">连接失败</div></div>
      <div class="card"><div class="n">${data.disabled}</div><div class="l">已停用</div></div>
    </div>
    <p style="color:var(--muted);margin:-6px 0 12px">整体健康只统计「启用中」的数据源，配置里 <code>enabled: false</code> 的不计入。</p>
    <div class="section"><h3>连接状态</h3>${rows}</div>
    <div class="section">
      <h3>如何在契约里使用</h3>
      <p style="color:var(--muted);line-height:1.7">
        数据源句柄已在启动时注入每个契约的 <code>ctx.services.databases</code>（也按 name 直接暴露，如 <code>ctx.services.main</code>）。
        关系型数据库可用 <code>handle.query(sql, params)</code>，MongoDB 用 <code>handle.raw(db, col, fn)</code>，Redis 用 <code>handle.raw(...)</code>。
      </p>
    </div>`;
}

/* ----------------------------- 面板切换 ----------------------------- */
function showPanel(name) {
  $('#overview').classList.toggle('hidden', name !== 'overview');
  $('#route-detail').classList.toggle('hidden', name !== 'route-detail');
  $('#datasources-panel').classList.toggle('hidden', name !== 'datasources-panel');
  $('#keys-panel').classList.toggle('hidden', name !== 'keys-panel');
  $('#security-panel').classList.toggle('hidden', name !== 'security-panel');
  if (name === 'overview') renderOverview();
}

/* ----------------------------- 安全态势 ----------------------------- */
async function renderSecurity() {
  showPanel('security-panel');
  let p;
  try {
    p = await api('/__meta/security');
  } catch (e) {
    $('#security-panel').innerHTML = `<h2>安全态势</h2><p style="color:var(--danger)">加载失败：${e.message}</p>`;
    return;
  }
  const scoreBadge =
    p.score === 'good'
      ? '<span class="badge ok">达标</span>'
      : '<span class="badge warn">待加固</span>';

  const corsText =
    p.cors.mode === 'allowlist'
      ? `白名单（${p.cors.origins.length} 个来源）`
      : p.cors.mode === 'disabled'
      ? '已关闭'
      : '反射任意源 ⚠';

  const grl = p.globalRateLimit.enabled
    ? `${p.globalRateLimit.max} 次 / ${(p.globalRateLimit.windowMs / 1000).toFixed(0)}s`
    : '未开启 ⚠';
  const timeout = p.requestTimeoutMs ? `${(p.requestTimeoutMs / 1000).toFixed(0)}s` : '未设置 ⚠';

  const headerRows = Object.entries(p.headers.list)
    .map(
      ([k, v]) =>
        `<div class="kv"><code>${k}</code><span style="color:var(--muted)">${v}</span></div>`
    )
    .join('');

  const warnHtml = p.warnings.length
    ? `<div class="section"><h3>⚠ 加固建议</h3>${p.warnings
        .map((w) => `<div class="card-row warn-row">${w}</div>`)
        .join('')}</div>`
    : '<p style="color:var(--muted)">未检测到明显风险项。</p>';

  $('#security-panel').innerHTML = `
    <h2>安全态势 ${scoreBadge}</h2>
    <div class="cards" style="margin-bottom:14px">
      <div class="card"><div class="n">${p.headers.enabled ? '✓' : '✗'}</div><div class="l">安全响应头</div></div>
      <div class="card"><div class="n">${corsText.includes('⚠') ? '⚠' : '✓'}</div><div class="l">CORS</div></div>
      <div class="card"><div class="n">${p.globalRateLimit.enabled ? '✓' : '⚠'}</div><div class="l">全局限流</div></div>
      <div class="card"><div class="n">${p.requestTimeoutMs ? '✓' : '⚠'}</div><div class="l">请求超时</div></div>
    </div>

    <div class="section"><h3>防护配置</h3>
      <div class="kv"><code>CORS</code><span>${corsText}${p.cors.credentials ? '（带凭证）' : ''}</span></div>
      <div class="kv"><code>请求体上限</code><span>${(p.bodyLimit / 1048576).toFixed(2)} MB</span></div>
      <div class="kv"><code>全局限流</code><span>${grl}</span></div>
      <div class="kv"><code>请求超时</code><span>${timeout}</span></div>
      <div class="kv"><code>代理信任</code><span>${p.trustProxy ? '已开启' : '未开启'}</span></div>
    </div>

    <div class="section"><h3>生效的响应头</h3>${headerRows}</div>

    ${warnHtml}
  `;
}

checkGate();
