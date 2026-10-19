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
    const localPreview = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    let api = localPreview ? 'http://127.0.0.1:28088' : (value ? value.slice(4).trim() : '');
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
    const status = $('[data-donate-status]'), stage = $('[data-order-result]'), stateLabel = $('[data-payment-state]');
    const queueStatus = $('[data-queue-status]'), queuePosition = $('[data-queue-position]'), queueMessage = $('[data-queue-message]');
    const beginButton = $('[data-begin-payment]'), requeueButton = $('[data-requeue]'), paymentContent = $('[data-payment-content]');
    const timer = $('[data-donate-timer]'), success = $('[data-donate-success]'), restart = $('[data-donate-restart]');
    const emailSummary = $('[data-email-summary]'), amount = $('[data-amount]'), amountHelp = $('[data-amount-help]');
    const announcementTrigger = $('[data-announcement-trigger]'), announcementModal = $('[data-announcement-modal]');
    const announcementBody = $('[data-announcement-body]');
    let pollTimer = null, countdownTimer = null, orderId = '', statusToken = '', deadlineAt = 0, serverOffset = 0, queueState = '';
    const storageKey = 'koSidecarDonationIntent';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch (_) { saved = null; }
    function saveIntent() { try { localStorage.setItem(storageKey, JSON.stringify({ orderId, statusToken })); } catch (_) {} }
    function clearIntent() { try { localStorage.removeItem(storageKey); } catch (_) {} }
    function formatDuration(seconds) { const value = Math.max(0, Math.ceil(Number(seconds) || 0)); return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0'); }
    function updateCountdown() {
      const remaining = Math.max(0, (deadlineAt - (Date.now() + serverOffset)) / 1000);
      if (queueState === 'waiting') timer.textContent = '正在排队，请保持本页打开';
      else if (queueState === 'ready') timer.textContent = '确认剩余：' + formatDuration(remaining);
      else if (queueState === 'paying') timer.textContent = '付款剩余：' + formatDuration(remaining);
      else if (queueState === 'confirming') timer.textContent = '到账确认中';
      else if (queueState === 'timed_out') timer.textContent = '本轮预约已超时';
      else if (queueState === 'paid') timer.textContent = '赞助处理完成';
      else timer.textContent = '正在同步状态';
    }
    function showPaymentImage(selector, emptySelector, value) {
      const url = validImageUrl(value), wrap = $(selector), empty = $(emptySelector), image = $('img', wrap);
      if (url) { image.src = url; wrap.hidden = false; empty.hidden = true; } else { wrap.hidden = true; empty.hidden = false; }
    }
    function applyConfig(data) {
      const configured = data.available === true && data.enabled !== false;
      stateLabel.textContent = configured ? '已配置' : '未配置';
      const submit = $('button[type="submit"]', form); submit.disabled = !configured;
      amount.textContent = data.amount ? '¥' + data.amount : '--';
      amountHelp.textContent = configured ? '请在付款时段内完成页面显示的金额。' : '捐赠、收款码或邮件发送尚未配置。';
      showPaymentImage('[data-wechat-wrap]', '[data-wechat-empty]', data.wechatPayment || data.paymentImage);
      showPaymentImage('[data-alipay-wrap]', '[data-alipay-empty]', data.alipayPayment);
      if (data.announcement && data.announcementEnabled !== false) {
        announcementBody.textContent = data.announcement; announcementTrigger.hidden = false;
      }
      return configured;
    }
    function applyStatus(data) {
      queueState = data.queueState || (data.status === 'paid' ? 'paid' : 'ready'); deadlineAt = Number(data.deadlineAt || 0); serverOffset = Number(data.serverNow || Date.now()) - Date.now();
      stage.hidden = false; form.hidden = true; emailSummary.textContent = '注册链接将发送至 ' + (data.emailMasked || '已登记邮箱'); queueStatus.textContent = queueState === 'ready' ? '轮到您了' : queueState === 'paying' ? '等待付款' : queueState === 'confirming' ? '确认到账' : queueState === 'paid' ? '邮件处理中' : queueState === 'timed_out' ? '已超时' : '排队中';
      queuePosition.textContent = queueState === 'ready' ? '现在可以开始付款' : queueState === 'paying' ? '付款时段已为您锁定' : queueState === 'paid' ? '付款已确认' : queueState === 'timed_out' ? '本轮预约已经结束' : '正在同步预约状态';
      queueMessage.textContent = queueState === 'ready' ? '点击“开始付款”后才会显示收款码。' : queueState === 'paying' ? '请在倒计时结束前完成付款。' : queueState === 'confirming' ? '收款码已隐藏，系统正在确认到账。' : queueState === 'paid' ? (data.emailStatus === 'sent' ? '注册链接已发送，请检查收件箱和垃圾邮件目录。' : '付款已确认，邮件正在发送。') : queueState === 'timed_out' ? '本轮预约已结束，可以重新排队。' : '请保持本页打开。';
      beginButton.hidden = queueState !== 'ready'; requeueButton.hidden = queueState !== 'timed_out'; paymentContent.hidden = queueState !== 'paying'; success.hidden = !(queueState === 'paid' && data.emailStatus === 'sent'); restart.hidden = queueState === 'paid' && data.emailStatus === 'sent'; updateCountdown();
      if (queueState === 'paid' && data.emailStatus === 'sent') { clearTimeout(pollTimer); clearInterval(countdownTimer); } else if (!countdownTimer) countdownTimer = setInterval(updateCountdown, 1000);
    }
    async function poll() {
      if (!orderId || !statusToken) return;
      try { const data = await request('/donate/status', jsonOptions({ orderId, statusToken })); applyStatus(data); } catch (error) { if (/order_not_found|HTTP 404/.test(error.message)) { clearIntent(); form.hidden = false; stage.hidden = true; setStatus(status, '订单不存在，请重新填写邮箱。', 'error'); return; } }
      if (orderId && !(queueState === 'paid' && !success.hidden)) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, 2000); }
    }
    async function changeReservation(path, button) { button.disabled = true; try { const data = await request(path, jsonOptions({ orderId, statusToken })); applyStatus(data); } catch (error) { queueMessage.textContent = error.message || '操作失败，请稍后重试。'; } finally { button.disabled = false; } }
    try {
      await loadCloud();
      const data = await request('/donate/config', { method: 'GET' });
      state.config = data;
      const configured = applyConfig(data); setStatus(status, configured ? '订单服务已就绪。' : '捐赠、收款码或邮件发送尚未配置。', configured ? 'ok' : 'error');
    } catch (error) {
      stateLabel.textContent = '未连接'; setCloudState('服务暂不可用', true); setStatus(status, error.message || '无法读取订单配置。', 'error'); return;
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const button = $('button[type="submit"]', form); setButtonBusy(button, true, '登记中', '确认邮箱并进入排队'); setStatus(status, '正在登记邮箱……', 'loading');
      try {
        const data = await request('/donate/start', jsonOptions(formBody(form)));
        orderId = data.orderId; statusToken = data.statusToken; saveIntent(); applyStatus(data); setStatus(status, '邮箱已登记，请按页面提示完成付款。', 'ok'); poll();
      } catch (error) { setStatus(status, error.message || '订单创建失败。', 'error'); }
      finally { setButtonBusy(button, false, '登记中', '确认邮箱并进入排队'); }
    });
    beginButton.addEventListener('click', () => changeReservation('/donate/begin', beginButton));
    requeueButton.addEventListener('click', () => changeReservation('/donate/requeue', requeueButton));
    restart.addEventListener('click', () => { clearIntent(); clearTimeout(pollTimer); clearInterval(countdownTimer); window.location.reload(); });
    announcementTrigger.addEventListener('click', () => { announcementModal.hidden = false; $('[data-announcement-close]').focus(); });
    $('[data-announcement-dismiss]').addEventListener('click', () => { announcementModal.hidden = true; });
    $('[data-announcement-close]').addEventListener('click', () => { announcementModal.hidden = true; });
    if (saved && saved.orderId && saved.statusToken) { orderId = saved.orderId; statusToken = saved.statusToken; poll(); }
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
  function renderPolicyList(node, items, action) {
    if (!node) return;
    node.textContent = '';
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = '名单为空'; node.appendChild(empty); return;
    }
    items.forEach(value => {
      const row = document.createElement('div'); row.className = 'policy-row';
      const label = document.createElement('code'); label.textContent = String(value); label.title = String(value);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-action text-action-danger';
      remove.dataset.policyRemove = action; remove.dataset.policyId = String(value); remove.textContent = '移除';
      row.append(label, remove); node.appendChild(row);
    });
  }
  function renderNotificationList(node, items, payments) {
    if (!node) return;
    node.textContent = '';
    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = payments ? '当前没有识别到收款通知' : '当前没有手机通知'; node.appendChild(empty); return;
    }
    items.slice(0, 30).forEach(item => {
      const row = document.createElement('div'); row.className = 'admin-list-row notification-row';
      const main = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = safeText(item.title || item.package_name, '未命名');
      const content = document.createElement('span'); content.textContent = safeText(item.content || item.ticker, '无正文');
      main.append(title, content);
      const meta = document.createElement('small');
      const amount = Number(item.amount_cents || 0) > 0 ? ' · ¥' + (Number(item.amount_cents) / 100).toFixed(2) : '';
      meta.textContent = safeText(item.payment_status || item.package_name, '通知') + amount;
      row.append(main, meta); node.appendChild(row);
    });
  }
  async function adminRequest(path, options) {
    const requestOptions = Object.assign({ referrerPolicy: 'no-referrer' }, options || {});
    requestOptions.headers = Object.assign({}, requestOptions.headers || {});
    if (state.adminToken && path !== '/admin/login') requestOptions.headers.Authorization = 'Bearer ' + state.adminToken;
    return request(path, requestOptions);
  }
  async function loadAdminData(kind, statusNode) {
    const paths = { queue: '/admin/queue', review: '/admin/review', policy: '/admin/policy', config: '/admin/config/status', notifications: '/admin/phone-notifications', payments: '/admin/payment-notifications' };
    try {
      const data = await adminRequest(paths[kind], { method: 'GET' });
      if (kind === 'queue') { $('[data-queue-count]').textContent = text(data.pendingCount != null ? data.pendingCount : (data.items || []).length, '0'); renderAdminList($('[data-queue-list]'), data.items || data.queue, 'queue'); }
      if (kind === 'review') { $('[data-review-count]').textContent = text(data.pendingCount != null ? data.pendingCount : (data.items || []).length, '0'); renderAdminList($('[data-review-list]'), data.items || data.pending, 'review'); }
      if (kind === 'policy') {
        $('[data-allow-count]').textContent = text(data.allowCount != null ? data.allowCount : (data.allowlist || []).length, '0');
        $('[data-deny-count]').textContent = text(data.denyCount != null ? data.denyCount : (data.denylist || []).length, '0');
        renderPolicyList($('[data-allow-list]'), data.allowlist, 'allow');
        renderPolicyList($('[data-deny-list]'), data.denylist, 'deny');
      }
      if (kind === 'config') {
        renderConfig($('[data-config-list]'), data);
        const donationForm = $('[data-donation-config-form]');
        const smtpForm = $('[data-smtp-config-form]');
        if (donationForm) {
          donationForm.elements.amount.value = data.amount || '';
          donationForm.elements.wechat_payment.value = data.wechatPayment || data.paymentImage || '';
          donationForm.elements.alipay_payment.value = data.alipayPayment || '';
          donationForm.elements.announcement.value = data.announcement || '';
          donationForm.elements.enabled.checked = !!data.donationEnabled;
          donationForm.elements.announcement_enabled.checked = data.announcementEnabled !== false;
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
      if (kind === 'notifications') {
        renderNotificationList($('[data-notification-list]'), data.items, false);
        const presence = data.presence || {};
        $('[data-notification-presence]').textContent = presence.online ? '通知设备在线 · 最近心跳 ' + new Date(Number(presence.lastSeen || 0)).toLocaleString() : '通知设备暂未在线';
      }
      if (kind === 'payments') renderNotificationList($('[data-payment-notification-list]'), data.items, true);
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
    const localDirect = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(state.api);
    if (localDirect) {
      loginPanel.hidden = true;
      dashboard.hidden = false;
      const localSession = $('[data-admin-session-label]');
      if (localSession) localSession.textContent = '本机直连';
      const logoutButton = $('[data-admin-logout]');
      if (logoutButton) logoutButton.hidden = true;
      setStatus(actionStatus, '本机云端管理已直接连接。', 'ok');
      await Promise.all(['queue', 'review', 'policy', 'config', 'notifications', 'payments'].map(kind => loadAdminData(kind, actionStatus)));
    }
    const policyActions = $$('[data-policy-action]');
    const donationConfigForm = $('[data-donation-config-form]');
    const smtpConfigForm = $('[data-smtp-config-form]');
    const policyFilesForm = $('[data-policy-files-form]');
    const policyFileSelect = $('[data-policy-file-name]');
    const policyFileInput = $('[data-policy-file]');
    const policyDownload = $('[data-policy-download]');
    const phonePairButton = $('[data-phone-pair]');
    const clearNotificationsButton = $('[data-admin-clear-notifications]');
    phonePairButton?.addEventListener('click', async () => {
      setButtonBusy(phonePairButton, true, '读取中', '复制手机配对密钥');
      try {
        const data = await adminRequest('/admin/phone-token', { method: 'GET' });
        if (!data.token || !navigator.clipboard?.writeText) throw new Error('当前浏览器无法写入剪贴板。');
        await navigator.clipboard.writeText(data.token);
        setStatus(actionStatus, '手机配对密钥已复制，请保存到 KO 侧载超频通知目录。', 'ok');
      } catch (error) { setStatus(actionStatus, error.message || '读取手机配对密钥失败。', 'error'); }
      finally { setButtonBusy(phonePairButton, false, '读取中', '复制手机配对密钥'); }
    });
    clearNotificationsButton?.addEventListener('click', async () => {
      if (!window.confirm('清空手机通知和收款展示日志？')) return;
      setButtonBusy(clearNotificationsButton, true, '清空中', '清空日志');
      try {
        await adminRequest('/admin/notifications/clear', jsonOptions({}));
        setStatus(actionStatus, '通知日志已清空，捐赠订单和名单不会受影响。', 'ok');
        await Promise.all([loadAdminData('notifications', actionStatus), loadAdminData('payments', actionStatus)]);
      } catch (error) { setStatus(actionStatus, error.message || '通知日志清空失败。', 'error'); }
      finally { setButtonBusy(clearNotificationsButton, false, '清空中', '清空日志'); }
    });
    loginForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!loginForm.checkValidity()) { loginForm.reportValidity(); return; }
      const button = $('button[type="submit"]', loginForm); setButtonBusy(button, true, '登录中', '登录管理端'); setStatus(loginStatus, '正在验证远程管理凭据……', 'loading');
      try {
        const body = formBody(loginForm);
        await adminRequest('/admin/login', jsonOptions(body)); state.adminToken = body.token;
        loginForm.reset(); loginPanel.hidden = true; dashboard.hidden = false; setStatus(loginStatus, '', '');
        await Promise.all(['queue', 'review', 'policy', 'config', 'notifications', 'payments'].map(kind => loadAdminData(kind, actionStatus)));
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
      const removePolicy = event.target.closest('[data-policy-remove]');
      if (removePolicy) {
        try {
          await adminRequest('/admin/policy', jsonOptions({ action: 'remove-' + removePolicy.dataset.policyRemove, id: removePolicy.dataset.policyId }));
          setStatus(actionStatus, '设备名单已更新并签名。', 'ok');
          await loadAdminData('policy', actionStatus);
        } catch (error) { setStatus(actionStatus, error.message || '设备名单更新失败。', 'error'); }
        return;
      }
      const button = event.target.closest('[data-admin-action]'); if (!button) return;
      try {
        await adminRequest('/admin/action', jsonOptions({ action: button.dataset.adminAction, id: button.dataset.itemId }));
        setStatus(actionStatus, '操作已完成。', 'ok');
        await loadAdminData(button.dataset.adminAction === 'approve' || button.dataset.adminAction === 'reject' ? 'review' : 'queue', actionStatus);
      } catch (error) { setStatus(actionStatus, error.message || '操作失败。', 'error'); }
    });
    if (donationConfigForm) donationConfigForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!donationConfigForm.checkValidity()) { donationConfigForm.reportValidity(); return; }
      const data = formBody(donationConfigForm); data.amount_cents = Math.round(Number(data.amount) * 100); data.enabled = data.enabled === 'on'; data.announcement_enabled = data.announcement_enabled === 'on'; data.email_otp_enabled = data.email_otp_enabled === 'on'; delete data.amount;
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
  window.KOSidecarOverclockCloud = { request, loadCloud, state };
})();
