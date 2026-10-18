(function () {
  'use strict';

  const state = { api: '', config: null, adminToken: '' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const text = (value, fallback = '') => String(value == null ? fallback : value);
  const errors = {
    donation_unavailable: '捐赠服务尚未配置。',
    invalid_donation_order: '请检查 QQ、昵称和邮箱。',
    register_link_invalid_or_expired: '注册链接无效或已过期。',
    email_otp_unavailable: '邮箱验证暂未开启。',
    email_otp_invalid_or_expired: '验证码无效或已过期。',
    otp_rate_limited: '请稍后再获取验证码。',
    admin_auth_invalid: '管理 Token 不正确。',
    admin_auth_required: '管理会话已失效，请重新登录。',
    payment_confirmed_email_failed: '付款已确认，但邮件发送失败，请在管理页重发。',
  };

  function clean(value) { return text(value).trim(); }
  function setStatus(node, message, type) {
    if (!node) return;
    node.textContent = message || '';
    node.className = 'form-status' + (type ? ' is-' + type : '');
  }
  function setCloudState(message, error) {
    $$('[data-cloud-state]').forEach(node => {
      node.lastChild.textContent = message;
      node.classList.toggle('is-error', !!error);
    });
  }
  function apiUrl(path) {
    if (!state.api) throw new Error('服务端入口尚未配置');
    return new URL(path.replace(/^\//, ''), state.api.replace(/\/$/, '') + '/').toString();
  }
  async function request(path, options) {
    const response = await fetch(apiUrl(path), Object.assign({ referrerPolicy: 'no-referrer' }, options || {}));
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { message: raw }; }
    if (!response.ok || data.ok === false) throw new Error(data.message || errors[data.error] || data.error || ('HTTP ' + response.status));
    return data;
  }
  async function loadCloud() {
    const response = await fetch('cloud.txt', { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('cloud.txt 不可用');
    const lines = (await response.text()).split(/\r?\n/);
    const value = lines.map(line => line.trim()).find(line => line.toLowerCase().startsWith('api='));
    let api = value ? value.slice(4).trim() : '';
    const localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!api && localPreview) api = 'http://127.0.0.1:28088';
    if (!api || !/^https:\/\//i.test(api) && !(localPreview && /^http:\/\//i.test(api))) throw new Error('服务端入口尚未配置');
    state.api = api;
    setCloudState('服务入口已连接', false);
    return api;
  }
  function paramsFromTicket() {
    const params = new URLSearchParams(location.hash.length > 1 ? location.hash.slice(1) : location.search.slice(1));
    const ticket = Object.fromEntries(['issued', 'expires', 'nonce', 'order', 'sig'].map(key => [key, clean(params.get(key))]));
    if (location.search || location.hash) history.replaceState(null, '', location.pathname);
    return ticket;
  }
  function formBody(form, extra) {
    const body = Object.fromEntries(new FormData(form).entries());
    Object.entries(extra || {}).forEach(([key, value]) => { body[key] = value; });
    return body;
  }
  function jsonOptions(body) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
  function setButtonBusy(button, busy, label, idleLabel) {
    if (!button) return;
    button.disabled = busy;
    const target = $('[data-submit-label], [data-order-label]', button);
    if (target) target.textContent = busy ? label : idleLabel;
  }

  async function initHome() {
    const title = $('[data-home-status-title]');
    const copy = $('[data-home-status-copy]');
    try {
      await loadCloud();
      if (title) title.textContent = '服务端配置已就绪';
      if (copy) copy.textContent = '可以开始注册或创建订单';
    } catch (error) {
      setCloudState('服务暂不可用', true);
      if (title) title.textContent = '服务暂不可用';
      if (copy) copy.textContent = error.message || '请稍后再试';
    }
  }

  async function initRegister() {
    const form = $('[data-register-form]');
    if (!form) return;
    const status = $('[data-register-status]');
    const ticket = paramsFromTicket();
    Object.entries(ticket).forEach(([key, value]) => { const input = form.elements[key]; if (input) input.value = value; });
    if (!ticket.issued || !ticket.expires || !ticket.sig || !ticket.nonce || !ticket.order) setStatus(status, '注册链接参数缺失，请从邮件中重新打开注册链接。', 'error');
    const emailPanel = $('[data-email-panel]', form);
    const codeButton = $('[data-send-code]', form);
    const codeHint = $('[data-code-hint]', form);
    let emailBound = false;
    let emailEnabled = true;
    let resendTimer = null;
    try {
      await loadCloud();
      const data = await request('/register/status', jsonOptions(ticket));
      emailEnabled = data.emailEnabled !== false && data.enabled !== false;
      emailBound = !!data.emailBound;
      if (!emailEnabled) {
        emailPanel.hidden = true;
        $('[name="email"]', form).required = false;
        $('[name="emailCode"]', form).required = false;
      } else if (emailBound) {
        const email = $('[name="email"]', form);
        email.value = data.emailMasked || '已绑定邮箱'; email.readOnly = true; email.type = 'text';
        codeHint.textContent = '邮箱已绑定，可重新获取验证码';
      }
      setStatus(status, '注册链接有效，请填写设备信息。', 'ok');
    } catch (error) {
      setCloudState('服务暂不可用', true);
      setStatus(status, error.message || '无法读取注册链接状态。', 'error');
      return;
    }
    codeButton.addEventListener('click', async () => {
      const emailInput = $('[name="email"]', form);
      const email = emailBound ? '' : clean(emailInput.value).toLowerCase();
      if (!emailBound && (!email || !emailInput.checkValidity())) { setStatus(status, '请输入有效邮箱。', 'error'); emailInput.focus(); return; }
      codeButton.disabled = true; codeButton.textContent = '发送中';
      try {
        const data = await request('/register/send-code', jsonOptions(Object.assign({}, ticket, { email })));
        emailBound = true; emailInput.value = data.emailMasked || email; emailInput.readOnly = true; emailInput.type = 'text';
        setStatus(status, data.message || '验证码已发送。', 'ok');
        let seconds = Number(data.retryAfter || 60);
        clearInterval(resendTimer);
        resendTimer = setInterval(() => { seconds -= 1; codeButton.textContent = seconds > 0 ? seconds + ' 秒' : '重新获取'; if (seconds <= 0) { clearInterval(resendTimer); codeButton.disabled = false; } }, 1000);
      } catch (error) { codeButton.disabled = false; codeButton.textContent = '获取验证码'; setStatus(status, error.message || '验证码发送失败。', 'error'); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = $('button[type="submit"]', form); setButtonBusy(button, true, '提交中', '提交注册'); setStatus(status, '正在提交设备授权申请……', 'loading');
      try {
        const data = await request('/register/submit', jsonOptions(formBody(form)));
        setStatus(status, data.message || (data.status === 'pending' ? '申请已提交，等待审核。' : '注册提交成功。'), 'ok');
        button.disabled = true;
        const label = $('[data-submit-label]', button);
        if (label) label.textContent = '已提交';
      } catch (error) { setStatus(status, error.message || '注册提交失败。', 'error'); }
      finally { setButtonBusy(button, false, '提交中', '提交注册'); }
    });
  }

  function validImageUrl(value) { try { const url = new URL(value, state.api || location.href); return /^https?:$/i.test(url.protocol) ? url.toString() : ''; } catch (_) { return ''; } }
  async function initDonate() {
    const form = $('[data-donate-form]');
    if (!form) return;
    const status = $('[data-donate-status]');
    const paymentPanel = $('[data-payment-panel]');
    const amount = $('[data-amount]');
    const announcement = $('[data-announcement]');
    const imageWrap = $('[data-payment-image-wrap]');
    const image = $('[data-payment-image]');
    const unavailable = $('[data-payment-unavailable]');
    const orderResult = $('[data-order-result]');
    const orderTitle = $('[data-order-title]');
    const orderCopy = $('[data-order-copy]');
    let pollTimer = null;
    try {
      await loadCloud();
      const data = await request('/donate/config', { method: 'GET' });
      state.config = data;
      const configured = data.available === true && data.enabled !== false;
      paymentPanel.classList.toggle('is-unavailable', !configured);
      $('[data-payment-state]').textContent = configured ? '已配置' : '未配置';
      amount.textContent = configured && data.amount ? (String(data.amount).includes('¥') ? data.amount : '¥' + data.amount) : '--';
      announcement.textContent = data.announcement || (configured ? '请按页面提示完成付款。' : '服务端尚未配置订单信息。');
      const imageUrl = validImageUrl(data.paymentImage || data.paymentImageUrl || '');
      if (configured && imageUrl) { image.src = imageUrl; imageWrap.hidden = false; unavailable.hidden = true; } else { imageWrap.hidden = true; unavailable.hidden = false; }
      setStatus(status, configured ? '订单服务已就绪。' : '服务暂不可用，请稍后再试。', configured ? 'ok' : 'error');
    } catch (error) {
      paymentPanel.classList.add('is-unavailable'); $('[data-payment-state]').textContent = '未连接'; unavailable.hidden = false; setCloudState('服务暂不可用', true); setStatus(status, error.message || '无法读取订单配置。', 'error'); return;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = $('button[type="submit"]', form); setButtonBusy(button, true, '创建中', '创建订单'); setStatus(status, '正在创建订单……', 'loading');
      try {
        const data = await request('/donate/start', jsonOptions(formBody(form)));
        const orderId = data.orderId || data.id || data.order_id;
        if (!orderId) throw new Error('服务器未返回订单编号');
        orderResult.hidden = false; orderTitle.textContent = '等待付款'; orderCopy.textContent = '订单 ' + orderId + ' 已创建。付款确认后，注册链接会自动发送到填写的邮箱。'; setStatus(status, '订单已创建，请按页面收款信息完成付款。', 'ok');
        const statusToken = data.statusToken || '';
        clearInterval(pollTimer);
        const poll = async () => {
          try {
            const current = await request('/donate/status', jsonOptions({ orderId: String(orderId), statusToken }));
            const currentStatus = String(current.status || current.state || '').toLowerCase();
            if (currentStatus === 'paid' && current.emailStatus === 'sent') {
              orderTitle.textContent = '注册链接已发送'; orderCopy.textContent = '付款已确认，注册链接已发送到订单邮箱。请在 7 天内打开邮件中的链接完成登记。';
              clearInterval(pollTimer);
            } else if (currentStatus === 'paid' && current.emailStatus === 'failed') {
              orderTitle.textContent = '等待邮件重试'; orderCopy.textContent = '付款已确认，邮件发送遇到问题。管理员会从队列中重发注册链接。';
            } else if (currentStatus === 'cancelled' || currentStatus === 'expired' || currentStatus === 'failed') { orderTitle.textContent = '订单已结束'; orderCopy.textContent = current.message || '请重新创建订单。'; clearInterval(pollTimer); }
          } catch (_) { /* 下一轮继续，避免短暂网络波动打断订单 */ }
        };
        pollTimer = setInterval(poll, 5000); await poll();
      } catch (error) { setStatus(status, error.message || '订单创建失败。', 'error'); }
      finally { setButtonBusy(button, false, '创建中', '创建订单'); }
    });
  }

  function safeText(value, fallback = '未提供') {
    const result = clean(value);
    return result || fallback;
  }
  function renderAdminList(node, items, type) {
    if (!node) return;
    node.textContent = '';
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = '当前没有待处理项目'; node.appendChild(empty); return;
    }
    items.slice(0, 30).forEach(item => {
      const row = document.createElement('div'); row.className = 'admin-list-row';
      const main = document.createElement('div');
      const itemId = item.id || item.orderId || item.order_id || item.registrationId || item.registration_id || item.deviceId || '';
      const title = document.createElement('strong'); title.textContent = safeText(item.nickname || itemId, '未命名'); title.title = itemId;
      const detail = document.createElement('span');
      if (type === 'queue') {
        const amount = (Number(item.amount_cents || 0) / 100).toFixed(2);
        detail.textContent = safeText(item.email, '无邮箱') + ' · ¥' + amount + ' · ' + safeText(item.link_email_status || item.status, '待处理');
      } else {
        detail.textContent = safeText(item.board_id || item.email, '待处理') + ' · ' + safeText(item.status, '待处理');
      }
      main.append(title, detail); row.appendChild(main);
      const actions = document.createElement('div'); actions.className = 'row-actions';
      if (type === 'queue') {
        const action = document.createElement('button'); action.className = 'text-action'; action.type = 'button';
        action.dataset.adminAction = item.status === 'pending_payment' ? 'confirm-payment' : 'send-link';
        action.dataset.itemId = itemId; action.textContent = item.status === 'pending_payment' ? '确认付款并发链' : '重发注册链接'; actions.appendChild(action);
      } else {
        ['approve', 'reject'].forEach(actionName => { const action = document.createElement('button'); action.className = 'text-action' + (actionName === 'reject' ? ' text-action-danger' : ''); action.type = 'button'; action.dataset.adminAction = actionName; action.dataset.itemId = itemId; action.textContent = actionName === 'approve' ? '通过' : '拒绝'; actions.appendChild(action); });
      }
      row.appendChild(actions);
      node.appendChild(row);
    });
  }
  function renderConfig(node, data) {
    if (!node) return;
    node.textContent = '';
    const entries = [
      ['SMTP', data && (data.smtp != null ? data.smtp : data.smtpConfigured), '已配置', '未配置'],
      ['收款', data && (data.payment != null ? data.payment : data.paymentConfigured), '已配置', '未配置'],
      ['邮件验证', data && (data.emailOtp != null ? data.emailOtp : data.emailOtpEnabled), '已启用', '未启用'],
      ['API 状态', data && (data.api != null ? data.api : data.apiHealthy), '正常', '未连接'],
    ];
    entries.forEach(([label, value, yes, no]) => { const row = document.createElement('div'); row.className = 'config-row'; const name = document.createElement('span'); name.textContent = label; const status = document.createElement('strong'); status.textContent = value === true || value === 'true' || value === 'configured' ? yes : no; status.className = status.textContent === yes || status.textContent === '正常' ? 'is-ok' : 'is-muted'; row.append(name, status); node.appendChild(row); });
  }
  async function adminRequest(path, options) {
    const requestOptions = Object.assign({ referrerPolicy: 'no-referrer' }, options || {});
    requestOptions.headers = Object.assign({}, requestOptions.headers || {});
    if (state.adminToken && path !== '/admin/login') requestOptions.headers.Authorization = 'Bearer ' + state.adminToken;
    return request(path, requestOptions);
  }
  async function loadAdminData(kind, statusNode) {
    const paths = { queue: '/admin/queue', review: '/admin/review', policy: '/admin/policy', config: '/admin/config/status' };
    try {
      const data = await adminRequest(paths[kind], { method: 'GET' });
      if (kind === 'queue') { $('[data-queue-count]').textContent = text(data.pendingCount != null ? data.pendingCount : (data.items || []).length, '0'); renderAdminList($('[data-queue-list]'), data.items || data.queue, 'queue'); }
      if (kind === 'review') { $('[data-review-count]').textContent = text(data.pendingCount != null ? data.pendingCount : (data.items || []).length, '0'); renderAdminList($('[data-review-list]'), data.items || data.pending, 'review'); }
      if (kind === 'policy') { $('[data-allow-count]').textContent = text(data.allowCount != null ? data.allowCount : (data.allowlist || []).length, '0'); $('[data-deny-count]').textContent = text(data.denyCount != null ? data.denyCount : (data.denylist || []).length, '0'); }
      if (kind === 'config') {
        renderConfig($('[data-config-list]'), data);
        const donationForm = $('[data-donation-config-form]');
        const smtpForm = $('[data-smtp-config-form]');
        if (donationForm) {
          donationForm.elements.amount.value = data.amount || '';
          donationForm.elements.payment_image.value = data.paymentImage || '';
          donationForm.elements.announcement.value = data.announcement || '';
          donationForm.elements.enabled.checked = !!data.donationEnabled;
          donationForm.elements.email_otp_enabled.checked = data.otpEnabled !== false;
        }
        if (smtpForm) {
          smtpForm.elements.host.value = data.smtpHost || '';
          smtpForm.elements.port.value = data.smtpPort || 465;
          smtpForm.elements.sender.value = data.smtpSender || '';
          smtpForm.elements.username.value = data.smtpUsername || '';
          smtpForm.elements.starttls.checked = !!data.smtpStarttls;
          smtpForm.elements.password.required = !data.smtp;
        }
      }
    } catch (error) { setStatus(statusNode, error.message || '读取管理数据失败。', 'error'); }
  }
  async function initAdmin() {
    const loginPanel = $('[data-admin-login-panel]');
    const loginForm = $('[data-admin-login]');
    const dashboard = $('[data-admin-dashboard]');
    if (!loginForm || !dashboard) return;
    const loginStatus = $('[data-admin-login-status]');
    const actionStatus = $('[data-admin-action-status]');
    try { await loadCloud(); } catch (error) { setCloudState('服务暂不可用', true); setStatus(loginStatus, error.message || '服务端入口未配置。', 'error'); return; }
    const policyActions = $$('[data-policy-action]');
    const donationConfigForm = $('[data-donation-config-form]');
    const smtpConfigForm = $('[data-smtp-config-form]');
    const policyFilesForm = $('[data-policy-files-form]');
    const policyFileSelect = $('[data-policy-file-name]');
    const policyFileInput = $('[data-policy-file]');
    const policyDownload = $('[data-policy-download]');
    loginForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!loginForm.checkValidity()) { loginForm.reportValidity(); return; }
      const button = $('button[type="submit"]', loginForm); setButtonBusy(button, true, '登录中', '登录管理端'); setStatus(loginStatus, '正在验证管理 Token……', 'loading');
      try {
        const body = formBody(loginForm);
        await adminRequest('/admin/login', jsonOptions(body)); state.adminToken = body.token;
        loginForm.reset(); loginPanel.hidden = true; dashboard.hidden = false; setStatus(loginStatus, '', '');
        await Promise.all(['queue', 'review', 'policy', 'config'].map(kind => loadAdminData(kind, actionStatus)));
      }
      catch (error) { setStatus(loginStatus, error.message || '管理登录失败。', 'error'); }
      finally { setButtonBusy(button, false, '登录中', '登录管理端'); }
    });
    $('[data-admin-logout]').addEventListener('click', async () => { try { await adminRequest('/admin/logout', jsonOptions({})); } catch (_) {} state.adminToken = ''; dashboard.hidden = true; loginPanel.hidden = false; loginForm.reset(); setStatus(loginStatus, '已退出管理端。', 'ok'); });
    $$('[data-admin-refresh]').forEach(button => button.addEventListener('click', () => loadAdminData(button.dataset.adminRefresh, actionStatus)));
    policyActions.forEach(button => button.addEventListener('click', async () => {
      const actionBase = button.dataset.policyAction;
      const id = window.prompt((actionBase.endsWith('allow') ? '白名单' : '黑名单') + '设备 ID'); if (!id) return;
      try { await adminRequest('/admin/policy', jsonOptions({ action: actionBase, id: id.trim() })); setStatus(actionStatus, '设备名单已更新并签名。', 'ok'); await loadAdminData('policy', actionStatus); }
      catch (error) { setStatus(actionStatus, error.message || '设备名单更新失败。', 'error'); }
    }));
    dashboard.addEventListener('click', async event => {
      const button = event.target.closest('[data-admin-action]'); if (!button) return;
      try {
        await adminRequest('/admin/action', jsonOptions({ action: button.dataset.adminAction, id: button.dataset.itemId }));
        setStatus(actionStatus, '操作已完成。', 'ok');
        await loadAdminData(button.dataset.adminAction === 'approve' || button.dataset.adminAction === 'reject' ? 'review' : 'queue', actionStatus);
      } catch (error) { setStatus(actionStatus, error.message || '操作失败。', 'error'); }
    });
    if (donationConfigForm) donationConfigForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!donationConfigForm.checkValidity()) { donationConfigForm.reportValidity(); return; }
      const data = formBody(donationConfigForm); data.amount_cents = Math.round(Number(data.amount) * 100); data.enabled = data.enabled === 'on'; data.email_otp_enabled = data.email_otp_enabled === 'on'; delete data.amount;
      try { await adminRequest('/admin/config/donation', jsonOptions(data)); setStatus(actionStatus, '捐赠设置已保存。', 'ok'); await loadAdminData('config', actionStatus); }
      catch (error) { setStatus(actionStatus, error.message || '捐赠设置保存失败。', 'error'); }
    });
    if (smtpConfigForm) smtpConfigForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!smtpConfigForm.checkValidity()) { smtpConfigForm.reportValidity(); return; }
      try { await adminRequest('/admin/config/smtp', jsonOptions(formBody(smtpConfigForm))); smtpConfigForm.reset(); setStatus(actionStatus, '邮件服务器设置已保存。', 'ok'); await loadAdminData('config', actionStatus); }
      catch (error) { setStatus(actionStatus, error.message || '邮件设置保存失败。', 'error'); }
    });
    if (policyDownload) policyDownload.addEventListener('click', async () => {
      try {
        const data = await adminRequest('/admin/policy/files', { method: 'GET' });
        const selected = data[policyFileSelect.value];
        const blob = new Blob([selected.content + (selected.content.endsWith('\n') || !selected.content ? '' : '\n') + '# signature=' + selected.signature + '\n'], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = policyFileSelect.value + '.txt'; link.click(); URL.revokeObjectURL(link.href);
      } catch (error) { setStatus(actionStatus, error.message || '名单文件读取失败。', 'error'); }
    });
    if (policyFilesForm) policyFilesForm.addEventListener('submit', async event => {
      event.preventDefault(); const file = policyFileInput.files && policyFileInput.files[0]; if (!file) { setStatus(actionStatus, '请选择名单文本文件。', 'error'); return; }
      try { const content = await file.text(); await adminRequest('/admin/policy/files', jsonOptions({ name: policyFileSelect.value, content })); policyFilesForm.reset(); setStatus(actionStatus, '名单文件已替换并重新签名。', 'ok'); await loadAdminData('policy', actionStatus); }
      catch (error) { setStatus(actionStatus, error.message || '名单文件导入失败。', 'error'); }
    });
  }

  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'register') initRegister();
  if (page === 'donate') initDonate();
  if (page === 'admin') initAdmin();
  window.AaOverclockCloud = { request, loadCloud, state };
})();
