/**
 * 账户登录下拉菜单
 * 由 app.js 调用 window.NeutronAccountMenu(ctx) 创建，ctx 注入共享依赖。
 * 返回公共方法：loadAccount / renderAccountAvatar / renderAccountMenu /
 *              showAccountView / bindAccountMenu / closeAccountMenu
 */
window.NeutronAccountMenu = function (ctx) {
  'use strict';

  const {
    state, dom, api, IS_OVERLAY,
    closeDownloadPanel, closeHistoryPanel, closeBookmarksPanel,
    closeExtensionPopup, closeContextMenu, showToast,
  } = ctx;

  const DEFAULT_ACCOUNT = { isLoggedIn: true, name: '俊文', email: '2818...@qq.com' };

  /** 从设置读取账户状态（settings.json 持久化，主窗口/覆盖层共享） */
  async function loadAccount() {
    try {
      const saved = await api.getSetting('account');
      state.account = (saved && typeof saved === 'object' && saved.isLoggedIn !== undefined)
        ? saved
        : Object.assign({}, DEFAULT_ACCOUNT);
    } catch (e) {
      state.account = Object.assign({}, DEFAULT_ACCOUNT);
    }
    try {
      const sync = await api.getSetting('accountSync');
      state.accountSync = sync === undefined ? true : !!sync;
    } catch (e) {
      state.accountSync = true;
    }
  }

  /** 保存账户状态并广播（onSettingsChanged 会同步到主窗口头像） */
  async function saveAccount() {
    try { await api.setSetting('account', state.account); } catch (e) { /* 忽略 */ }
  }

  /** 渲染主窗口工具栏上的圆形头像 */
  function renderAccountAvatar() {
    const btn = dom.btnAccount;
    if (!btn) return;
    if (state.account && state.account.isLoggedIn) {
      const initial = (state.account.name || '?').trim().charAt(0);
      btn.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'account-avatar__initial';
      span.textContent = initial;
      btn.appendChild(span);
      btn.classList.add('account-avatar--logged-in');
      btn.title = state.account.name || '账户';
    } else {
      btn.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>' +
        '<circle cx="12" cy="7" r="4"/></svg>';
      btn.classList.remove('account-avatar--logged-in');
      btn.title = '账户';
    }
  }

  /** 渲染覆盖层中账户菜单的内容（头部大头像/昵称/邮箱/同步状态） */
  function renderAccountMenu() {
    const acct = state.account || { isLoggedIn: false, name: '', email: '' };
    dom.accountMenuName.textContent = acct.name || '';
    dom.accountMenuEmail.textContent = acct.email || '';
    dom.accountMenuAvatarLg.textContent = (acct.name || '?').trim().charAt(0);
    if (dom.accountMenuSyncText) {
      dom.accountMenuSyncText.textContent = state.accountSync ? '同步已启用' : '同步已暂停';
    }
    hideAccountNewProfile();
  }

  /** 覆盖层内账户面板视图切换：accountMenu / accountLoginView / accountRegisterView / accountForgotView */
  function showAccountView(name) {
    ['accountMenu', 'accountLoginView', 'accountRegisterView', 'accountForgotView'].forEach((v) => {
      if (dom[v]) dom[v].hidden = v !== name;
    });
    // 切换视图时清空错误/成功提示并恢复样式
    [dom.accountLoginError, dom.accountLoginCodeError, dom.accountRegisterError, dom.accountForgotError].forEach((el) => {
      if (el) {
        el.hidden = true;
        el.className = 'account-view__error';
      }
    });
    // 切到登录界面时默认显示「密码登录」
    if (name === 'accountLoginView') switchAccountLoginTab('pwd');
  }

  /** 显示登录/注册/忘记密码表单错误 */
  function showAccountFormError(errorEl, msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.className = 'account-view__error';
    errorEl.hidden = false;
  }

  /** 显示表单成功提示（绿色） */
  function showAccountFormSuccess(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'account-view__success';
    el.hidden = false;
  }

  /** 密码可见性切换 */
  function togglePasswordVisible(btn, input) {
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    btn.title = isPwd ? '隐藏密码' : '显示密码';
  }

  /** 校验手机号或邮箱 */
  function isValidAccount(val) {
    return /^1\d{10}$/.test(val) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  }

  /** 获取验证码按钮倒计时（60 秒） */
  function startCodeCountdown(btn) {
    if (!btn || btn.dataset.counting === '1') return;
    btn.dataset.counting = '1';
    let seconds = 60;
    const original = btn.textContent;
    btn.disabled = true;
    const timer = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = original;
        btn.dataset.counting = '0';
      } else {
        btn.textContent = '重新发送(' + seconds + 's)';
      }
    }, 1000);
  }

  /**
   * 请求发送验证码（真实发送：由主进程通过 SMTP/短信服务发送）
   * @param type 验证码场景（login / register / forgot）
   * @param phoneEl 手机号/邮箱输入框
   * @param btnEl 获取验证码按钮
   * @param errorEl 提示元素
   */
  async function requestVerifyCode(type, phoneEl, btnEl, errorEl) {
    const account = phoneEl.value.trim();
    if (!account) {
      showAccountFormError(errorEl, '请输入手机号或邮箱');
      return;
    }
    if (!isValidAccount(account)) {
      showAccountFormError(errorEl, '手机号或邮箱格式不正确');
      return;
    }
    const result = await api.sendVerifyCode(account);
    if (!result || !result.ok) {
      showAccountFormError(errorEl, (result && result.error) || '验证码发送失败');
      return;
    }
    console.log('发送验证码至 ' + account);
    showAccountFormSuccess(errorEl, '验证码已发送至 ' + account + '，请查收（10 分钟内有效）');
    startCodeCountdown(btnEl);
  }

  /**
   * 使用本地模拟验证码（无需配置发送服务，降级方案）
   * @param accountEl 手机号/邮箱输入框
   * @param errorEl 提示元素
   */
  function handleMockVerifyCode(accountEl, errorEl) {
    const account = accountEl.value.trim();
    if (!account) {
      showAccountFormError(errorEl, '请先输入手机号或邮箱');
      return;
    }
    if (!isValidAccount(account)) {
      showAccountFormError(errorEl, '手机号或邮箱格式不正确');
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    state.mockCodes[account] = code;
    console.log('[本地模拟] 验证码：' + code);
    showAccountFormSuccess(errorEl, '本地模拟验证码：' + code + '（未配置发送服务，仅供体验登录流程）');
  }

  /**
   * 校验验证码（本地模拟码优先，其次走主进程真实校验；校验通过后即作废）
   * @param accountEl 手机号/邮箱输入框
   * @param codeEl 验证码输入框
   * @returns {Promise<boolean>}
   */
  async function checkVerifyCode(accountEl, codeEl) {
    const account = accountEl.value.trim();
    const code = (codeEl.value || '').trim();
    if (!account || !code) return false;
    // 本地模拟验证码优先（未配置发送服务时的降级方案）
    if (state.mockCodes[account] && String(state.mockCodes[account]) === code) {
      delete state.mockCodes[account];
      return true;
    }
    try {
      return !!(await api.checkVerifyCode(account, code));
    } catch (e) {
      return false;
    }
  }

  /** 登录界面 tab 切换：pwd=密码登录 / code=验证码登录 */
  function switchAccountLoginTab(mode) {
    const isPwd = mode === 'pwd';
    if (dom.accountLoginPwdArea) dom.accountLoginPwdArea.hidden = !isPwd;
    if (dom.accountLoginCodeArea) dom.accountLoginCodeArea.hidden = isPwd;
    if (dom.accountLoginTabPwd) {
      dom.accountLoginTabPwd.classList.toggle('active', isPwd);
      dom.accountLoginTabPwd.setAttribute('aria-selected', String(isPwd));
    }
    if (dom.accountLoginTabCode) {
      dom.accountLoginTabCode.classList.toggle('active', !isPwd);
      dom.accountLoginTabCode.setAttribute('aria-selected', String(!isPwd));
    }
    if (dom.accountLoginError) dom.accountLoginError.hidden = true;
    if (dom.accountLoginCodeError) dom.accountLoginCodeError.hidden = true;
  }

  /** 密码登录提交（登录界面-密码登录） */
  async function submitAccountLogin() {
    const username = dom.accountLoginUsername.value.trim();
    const password = dom.accountLoginPassword.value;
    if (!username || !password) {
      showAccountFormError(dom.accountLoginError, '请输入账号和密码');
      return;
    }
    console.log('登录');
    // 模拟登录：账号 @ 前缀作为昵称，完整账号作为邮箱
    const name = username.split('@')[0] || username;
    state.account = { isLoggedIn: true, name: name, email: username };
    await saveAccount();
    renderAccountAvatar();
    // 登录成功 → 切换到账户菜单（覆盖层保持打开）
    renderAccountMenu();
    showAccountView('accountMenu');
  }

  /** 验证码登录提交（登录界面-验证码登录） */
  async function submitAccountLoginByCode() {
    const account = dom.accountLoginPhone.value.trim();
    const code = (dom.accountLoginCode.value || '').trim();
    if (!account || !code) {
      showAccountFormError(dom.accountLoginCodeError, '请输入手机号/邮箱和验证码');
      return;
    }
    if (!(await checkVerifyCode(dom.accountLoginPhone, dom.accountLoginCode))) {
      showAccountFormError(dom.accountLoginCodeError, '验证码错误或已失效');
      return;
    }
    console.log('登录');
    // 模拟登录：账号 @ 前缀作为昵称，完整账号作为邮箱
    const name = account.split('@')[0] || account;
    state.account = { isLoggedIn: true, name: name, email: account };
    await saveAccount();
    renderAccountAvatar();
    renderAccountMenu();
    showAccountView('accountMenu');
  }

  /** 注册提交（注册界面，需验证码） */
  async function submitAccountRegister() {
    const nickname = dom.accountRegisterNickname.value.trim();
    const account = dom.accountRegisterPhone.value.trim();
    const code = (dom.accountRegisterCode.value || '').trim();
    const pwd = dom.accountRegisterPassword.value;
    const pwd2 = dom.accountRegisterPassword2.value;
    if (!nickname || !account || !pwd) {
      showAccountFormError(dom.accountRegisterError, '请填写昵称、手机号/邮箱和密码');
      return;
    }
    if (!isValidAccount(account)) {
      showAccountFormError(dom.accountRegisterError, '手机号或邮箱格式不正确');
      return;
    }
    if (!code) {
      showAccountFormError(dom.accountRegisterError, '请先获取并输入验证码');
      return;
    }
    if (!(await checkVerifyCode(dom.accountRegisterPhone, dom.accountRegisterCode))) {
      showAccountFormError(dom.accountRegisterError, '验证码错误或已失效');
      return;
    }
    if (pwd.length < 6) {
      showAccountFormError(dom.accountRegisterError, '密码长度至少 6 位');
      return;
    }
    if (pwd !== pwd2) {
      showAccountFormError(dom.accountRegisterError, '两次输入的密码不一致');
      return;
    }
    console.log('注册');
    state.account = { isLoggedIn: true, name: nickname, email: account };
    await saveAccount();
    renderAccountAvatar();
    // 注册成功 → 切换到账户菜单（覆盖层保持打开）
    renderAccountMenu();
    showAccountView('accountMenu');
  }

  /** 忘记密码提交（验证码重置，需验证码 + 新密码） */
  async function submitAccountForgot() {
    const account = dom.accountForgotPhone.value.trim();
    const code = (dom.accountForgotCode.value || '').trim();
    const pwd = dom.accountForgotPassword.value;
    const pwd2 = dom.accountForgotPassword2.value;
    if (!account || !code || !pwd) {
      showAccountFormError(dom.accountForgotError, '请填写手机号/邮箱、验证码和新密码');
      return;
    }
    if (!(await checkVerifyCode(dom.accountForgotPhone, dom.accountForgotCode))) {
      showAccountFormError(dom.accountForgotError, '验证码错误或已失效');
      return;
    }
    if (pwd.length < 6) {
      showAccountFormError(dom.accountForgotError, '新密码长度至少 6 位');
      return;
    }
    if (pwd !== pwd2) {
      showAccountFormError(dom.accountForgotError, '两次输入的新密码不一致');
      return;
    }
    console.log('忘记密码');
    // 模拟重置：显示成功提示，稍后返回登录界面
    showAccountFormSuccess(dom.accountForgotError, '密码重置成功，请使用新密码登录');
    setTimeout(() => showAccountView('accountLoginView'), 1500);
  }

  /** 退出账号（覆盖层内点击）：确认后重置为未登录，收起菜单 */
  async function handleAccountLogout() {
    const ok = window.confirm('确定要退出账号吗？');
    if (!ok) return;
    console.log('退出账号');
    state.account = { isLoggedIn: false, name: '', email: '' };
    await saveAccount();
    renderAccountAvatar();
    api.hidePanelOverlay();
    showToast('已退出账号');
  }

  /** 同步开关：点击在「已启用 / 已暂停」之间切换（菜单内实时反馈） */
  async function toggleAccountSync() {
    state.accountSync = !state.accountSync;
    try { await api.setSetting('accountSync', state.accountSync); } catch (e) { /* 忽略 */ }
    if (dom.accountMenuSyncText) {
      dom.accountMenuSyncText.textContent = state.accountSync ? '同步已启用' : '同步已暂停';
    }
    console.log(state.accountSync ? '同步已启用' : '同步已暂停');
  }

  /** 显示新建配置文件输入区 */
  function showAccountNewProfile() {
    if (!dom.accountNewProfile) return;
    dom.accountNewProfile.hidden = false;
    dom.accountNewProfileInput.value = '';
    dom.accountNewProfileInput.focus();
  }

  /** 隐藏新建配置文件输入区 */
  function hideAccountNewProfile() {
    if (dom.accountNewProfile) dom.accountNewProfile.hidden = true;
  }

  /** 创建新配置文件并切换（新配置文件 = 独立的未登录身份） */
  async function createAccountProfile() {
    const name = (dom.accountNewProfileInput.value || '').trim();
    if (!name) {
      dom.accountNewProfileInput.focus();
      return;
    }
    console.log('设置新配置文件');
    state.account = { isLoggedIn: false, name: '', email: '' };
    await saveAccount();
    api.hidePanelOverlay();
    showToast('已创建并切换到配置文件「' + name + '」');
  }

  /** 菜单项点击（实际效果） */
  function handleAccountMenuItem(action) {
    switch (action) {
      case 'passwords':
        console.log('密码和自动填充');
        api.hidePanelOverlay();
        api.createTab('neutron://settings#privacy');   // 设置-隐私与安全
        break;
      case 'profile':
        console.log('个人资料设置');
        api.hidePanelOverlay();
        api.createTab('neutron://settings#profile');   // 设置-个人资料
        break;
      case 'sync':
        toggleAccountSync();                            // 同步开关（菜单保持打开）
        break;
      case 'new-profile':
        console.log('设置新配置文件');
        showAccountNewProfile();                        // 展开输入区
        break;
      case 'guest':
        console.log('以访客身份浏览');
        api.hidePanelOverlay();
        api.createTab('neutron://newtab');              // 新标签页
        break;
      case 'logout':
        handleAccountLogout();
        break;
    }
  }

  /** 主窗口：打开账户面板（已登录=账户菜单，未登录=登录界面，由覆盖层按状态渲染） */
  async function openAccountMenu() {
    if (state.accountMenuOpen) return;
    // 关闭其他悬浮窗
    if (state.downloadPanelOpen) closeDownloadPanel();
    if (state.historyPanelOpen) closeHistoryPanel();
    if (state.bookmarksPanelOpen) closeBookmarksPanel();
    if (state.extensionPopupOpen) closeExtensionPopup();
    if (state.contextMenuOpen) closeContextMenu();
    const r = dom.btnAccount.getBoundingClientRect();
    state.accountMenuOpen = true;
    dom.btnAccount.setAttribute('aria-expanded', 'true');
    api.showPanelOverlay({
      type: 'account',
      anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
    });
  }

  /** 主窗口：关闭账户菜单 */
  function closeAccountMenu() {
    if (!state.accountMenuOpen) return;
    state.accountMenuOpen = false;
    dom.btnAccount.setAttribute('aria-expanded', 'false');
    api.hidePanelOverlay();
  }

  function bindAccountMenu() {
    // 主窗口：头像按钮开关菜单
    if (!IS_OVERLAY && dom.btnAccount) {
      dom.btnAccount.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.accountMenuOpen) {
          closeAccountMenu();
        } else {
          openAccountMenu();
        }
      });
      return;
    }

    // 覆盖层：菜单项点击（事件委托）
    if (dom.accountMenu) {
      dom.accountMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.account-menu__item');
        if (!item) return;
        handleAccountMenuItem(item.dataset.action);
      });

      // 新建配置文件输入区
      if (dom.accountNewProfileCancel) {
        dom.accountNewProfileCancel.addEventListener('click', hideAccountNewProfile);
      }
      if (dom.accountNewProfileOk) {
        dom.accountNewProfileOk.addEventListener('click', createAccountProfile);
      }
      if (dom.accountNewProfileInput) {
        dom.accountNewProfileInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') createAccountProfile();
        });
      }

      // Esc 键：输入区开着先收起输入区，否则关闭菜单
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (dom.accountNewProfile && !dom.accountNewProfile.hidden) {
            hideAccountNewProfile();
          } else {
            api.hidePanelOverlay();
          }
        }
      });

      // ============ 登录界面 ============
      if (dom.accountLoginClose) {
        dom.accountLoginClose.addEventListener('click', () => api.hidePanelOverlay());
      }
      if (dom.accountLoginTabPwd) {
        dom.accountLoginTabPwd.addEventListener('click', () => switchAccountLoginTab('pwd'));
      }
      if (dom.accountLoginTabCode) {
        dom.accountLoginTabCode.addEventListener('click', () => switchAccountLoginTab('code'));
      }
      if (dom.accountLoginSubmit) {
        dom.accountLoginSubmit.addEventListener('click', submitAccountLogin);
      }
      if (dom.accountLoginTogglePwd) {
        dom.accountLoginTogglePwd.addEventListener('click', () => {
          togglePasswordVisible(dom.accountLoginTogglePwd, dom.accountLoginPassword);
        });
      }
      if (dom.accountLoginUsername) {
        dom.accountLoginUsername.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountLogin();
        });
      }
      if (dom.accountLoginPassword) {
        dom.accountLoginPassword.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountLogin();
        });
      }
      // 验证码登录
      if (dom.accountLoginSendCode) {
        dom.accountLoginSendCode.addEventListener('click', () => {
          requestVerifyCode('login', dom.accountLoginPhone, dom.accountLoginSendCode, dom.accountLoginCodeError);
        });
      }
      if (dom.accountLoginMockCode) {
        dom.accountLoginMockCode.addEventListener('click', () => {
          handleMockVerifyCode(dom.accountLoginPhone, dom.accountLoginCodeError);
        });
      }
      if (dom.accountLoginCodeSubmit) {
        dom.accountLoginCodeSubmit.addEventListener('click', submitAccountLoginByCode);
      }
      if (dom.accountLoginPhone) {
        dom.accountLoginPhone.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountLoginByCode();
        });
      }
      if (dom.accountLoginCode) {
        dom.accountLoginCode.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountLoginByCode();
        });
      }
      if (dom.accountLoginForgot) {
        dom.accountLoginForgot.addEventListener('click', () => showAccountView('accountForgotView'));
      }
      if (dom.accountLoginGoRegister) {
        dom.accountLoginGoRegister.addEventListener('click', () => showAccountView('accountRegisterView'));
      }

      // ============ 注册界面 ============
      if (dom.accountRegisterClose) {
        dom.accountRegisterClose.addEventListener('click', () => api.hidePanelOverlay());
      }
      if (dom.accountRegisterSubmit) {
        dom.accountRegisterSubmit.addEventListener('click', submitAccountRegister);
      }
      if (dom.accountRegisterSendCode) {
        dom.accountRegisterSendCode.addEventListener('click', () => {
          requestVerifyCode('register', dom.accountRegisterPhone, dom.accountRegisterSendCode, dom.accountRegisterError);
        });
      }
      if (dom.accountRegisterMockCode) {
        dom.accountRegisterMockCode.addEventListener('click', () => {
          handleMockVerifyCode(dom.accountRegisterPhone, dom.accountRegisterError);
        });
      }
      [dom.accountRegisterNickname, dom.accountRegisterPhone, dom.accountRegisterCode, dom.accountRegisterPassword, dom.accountRegisterPassword2].forEach((el) => {
        if (el) el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountRegister();
        });
      });
      if (dom.accountRegisterGoLogin) {
        dom.accountRegisterGoLogin.addEventListener('click', () => showAccountView('accountLoginView'));
      }

      // ============ 忘记密码界面 ============
      if (dom.accountForgotClose) {
        dom.accountForgotClose.addEventListener('click', () => api.hidePanelOverlay());
      }
      if (dom.accountForgotSubmit) {
        dom.accountForgotSubmit.addEventListener('click', submitAccountForgot);
      }
      if (dom.accountForgotSendCode) {
        dom.accountForgotSendCode.addEventListener('click', () => {
          requestVerifyCode('forgot', dom.accountForgotPhone, dom.accountForgotSendCode, dom.accountForgotError);
        });
      }
      if (dom.accountForgotMockCode) {
        dom.accountForgotMockCode.addEventListener('click', () => {
          handleMockVerifyCode(dom.accountForgotPhone, dom.accountForgotError);
        });
      }
      [dom.accountForgotPhone, dom.accountForgotCode, dom.accountForgotPassword, dom.accountForgotPassword2].forEach((el) => {
        if (el) el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') submitAccountForgot();
        });
      });
      if (dom.accountForgotGoLogin) {
        dom.accountForgotGoLogin.addEventListener('click', () => showAccountView('accountLoginView'));
      }
    }
  }

  return {
    loadAccount,
    renderAccountAvatar,
    renderAccountMenu,
    showAccountView,
    bindAccountMenu,
    closeAccountMenu,
  };
};
