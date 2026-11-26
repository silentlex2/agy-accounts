(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var bridge = window.agyAccountsBridge || (typeof globalThis !== 'undefined' && globalThis.__AGY_ACCOUNTS_BRIDGE__);
  if (!bridge) return;
  if (typeof globalThis.__AGY_ACCOUNTS_MENU_CLEANUP__ === 'function') {
    try { globalThis.__AGY_ACCOUNTS_MENU_CLEANUP__(); } catch (e) {}
  }

  var state = {
    data: null,
    loading: false,
    hoverEmail: null,
    open: false,
    pinned: false,
    confirmEmail: null,
    switching: false,
  };

  var mouseX = -9999;
  var mouseY = -9999;
  var closeTimer = null;
  var toastTimer = null;
  var moTimer = null;
  var mo = null;

  var menuBtn = null;
  var dropdownWrap = null;
  var dropdown = null;
  var emailHintEl = null;
  var modal = null;
  var toastEl = null;

  function isDark() {
    try {
      var html = document.documentElement;
      if (html.classList.contains('dark') || html.dataset.theme === 'dark') return true;
      var bg = getComputedStyle(document.body).backgroundColor || '';
      var m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        return (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000 < 128;
      }
    } catch (e) {}
    return false;
  }

  function theme() {
    var dark = isDark();
    return {
      dark: dark,
      surface: dark ? 'var(--card, #1e1f22)' : 'var(--card, #ffffff)',
      subSurface: dark ? 'var(--muted, rgba(255,255,255,0.045))' : 'var(--muted, rgba(10,10,12,0.035))',
      hover: dark ? 'var(--secondary, rgba(255,255,255,0.08))' : 'var(--secondary, rgba(10,10,12,0.055))',
      fg: dark ? 'var(--foreground, #f2f3f5)' : 'var(--foreground, #0a0a0c)',
      muted: dark ? 'var(--muted-foreground, #9aa0a6)' : 'var(--muted-foreground, #71717a)',
      border: dark ? 'var(--border, rgba(255,255,255,0.10))' : 'var(--border, rgba(10,10,12,0.09))',
      shadow: dark
        ? '0 14px 36px rgba(0,0,0,0.52), 0 2px 8px rgba(0,0,0,0.30)'
        : '0 12px 32px rgba(10,10,12,0.11), 0 2px 6px rgba(10,10,12,0.05)',
      primary: dark ? 'var(--primary, #60a5fa)' : 'var(--primary, #2f75c3)',
      primaryText: '#ffffff',
      green: dark ? '#4ade80' : '#16a34a',
      greenBg: dark ? 'rgba(74,222,128,0.14)' : 'rgba(22,163,74,0.10)',
    };
  }

  function el(tag, text, css) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (css) node.style.cssText = css;
    return node;
  }

  function inRect(x, y, node, pad) {
    if (!node || node.style.display === 'none') return false;
    var r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var p = pad || 0;
    return x >= r.left - p && x <= r.right + p && y >= r.top - p && y <= r.bottom + p;
  }

  function isPointerInsideMenu() {
    return inRect(mouseX, mouseY, menuBtn, 4) || inRect(mouseX, mouseY, dropdownWrap, 4);
  }

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    if (state.pinned || state.confirmEmail) return;
    closeTimer = setTimeout(function () {
      closeTimer = null;
      if (state.pinned || state.confirmEmail) return;
      if (isPointerInsideMenu()) return;
      closeMenus();
    }, 260);
  }

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    if (!toastEl) {
      toastEl = el('div', '', '');
      toastEl.setAttribute('data-agy-accounts-ui', '1');
      document.body.appendChild(toastEl);
    }
    var t = theme();
    toastEl.textContent = msg;
    toastEl.style.cssText =
      'position:fixed;top:46px;left:50%;transform:translateX(-50%);z-index:2147483646;' +
      'padding:7px 14px;border-radius:10px;font:500 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;' +
      'background:' + t.surface + ';color:' + t.fg + ';border:1px solid ' + t.border + ';' +
      'box-shadow:' + t.shadow + ';pointer-events:none;display:block;-webkit-app-region:no-drag;';
    toastTimer = setTimeout(function () {
      if (toastEl) toastEl.style.display = 'none';
    }, 2600);
  }

  function loadData() {
    if (state.loading) return;
    state.loading = true;
    bridge.list().then(function (res) {
      if (res && !res.error) {
        state.data = res;
      } else if (res && res.error) {
        showToast('读取账号列表失败: ' + res.error);
      }
    }).catch(function () {
    }).finally(function () {
      state.loading = false;
      if (state.open) renderDropdown();
    });
  }

  function closeMenus() {
    clearCloseTimer();
    state.open = false;
    state.pinned = false;
    state.hoverEmail = null;
    if (dropdownWrap) dropdownWrap.style.display = 'none';
  }

  function openMenu(pinned) {
    clearCloseTimer();
    var wasOpen = state.open;
    state.open = true;
    if (pinned !== undefined) state.pinned = pinned;
    if (!state.data || !wasOpen) loadData();
    renderDropdown();
    placeDropdown();
  }

  function placeDropdown() {
    if (!dropdownWrap || !menuBtn || !state.open) return;
    var r = menuBtn.getBoundingClientRect();
    dropdownWrap.style.display = 'block';
    dropdownWrap.style.top = Math.round(r.bottom - 1) + 'px';
    dropdownWrap.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 250))) + 'px';
  }

  function ensureContainers() {
    if (!dropdownWrap) {
      dropdownWrap = el('div', '', '');
      dropdownWrap.setAttribute('data-agy-accounts-ui', '1');
      dropdownWrap.style.cssText = 'position:fixed;z-index:2147483644;padding-top:6px;display:none;-webkit-app-region:no-drag;';
      dropdownWrap.addEventListener('mouseenter', clearCloseTimer);
      dropdownWrap.addEventListener('mouseleave', scheduleClose);

      dropdown = el('div', '', '');
      dropdown.setAttribute('data-agy-accounts-ui', '1');
      dropdownWrap.appendChild(dropdown);
      document.body.appendChild(dropdownWrap);
    }
  }

  function updateEmailHint() {
    if (!emailHintEl) return;
    emailHintEl.textContent = state.hoverEmail || '点击目标账号可安全切换';
  }

  function openConfirmModal(acc) {
    closeMenus();
    state.confirmEmail = acc.email;
    if (!modal) {
      modal = el('div', '', '');
      modal.setAttribute('data-agy-accounts-ui', '1');
      modal.addEventListener('mousedown', function (e) {
        if (e.target === modal && !state.switching) {
          state.confirmEmail = null;
          modal.style.display = 'none';
        }
      });
      document.body.appendChild(modal);
    }
    var t = theme();
    modal.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(10,10,12,0.40);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,Segoe UI,sans-serif;-webkit-app-region:no-drag;';
    while (modal.firstChild) modal.removeChild(modal.firstChild);

    var box = el('div', '',
      'width:372px;max-width:90vw;padding:20px 22px;border-radius:14px;' +
      'background:' + t.surface + ';color:' + t.fg + ';border:1px solid ' + t.border + ';box-shadow:' + t.shadow + ';'
    );
    box.appendChild(el('div', '切换 Antigravity 账号', 'font:600 15px/1.4 system-ui;margin-bottom:10px;'));

    var targetCard = el('div', '', 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:9px;background:' + t.subSurface + ';border:1px solid ' + t.border + ';margin-bottom:10px;');
    var tcLeft = el('div', '', 'min-width:0;');
    tcLeft.appendChild(el('div', acc.shortName, 'font:600 13.5px/1.3 ui-monospace,monospace;color:' + t.fg + ';'));
    tcLeft.appendChild(el('div', acc.email, 'font:400 11.5px/1.35 ui-monospace,monospace;color:' + t.muted + ';word-break:break-all;'));
    targetCard.appendChild(tcLeft);
    box.appendChild(targetCard);

    box.appendChild(el('div',
      '确认写入新凭据并重启客户端吗？重启过程大约需要几秒钟。',
      'font:400 12.5px/1.5 system-ui;color:' + t.muted + ';margin-bottom:16px;'
    ));

    var btns = el('div', '', 'display:flex;justify-content:flex-end;gap:8px;');
    var cancelBtn = el('button', '取消',
      'padding:7px 14px;border-radius:8px;border:1px solid ' + t.border + ';background:transparent;' +
      'color:' + t.fg + ';font:500 12.5px/1.3 system-ui;cursor:pointer;'
    );
    var okBtn = el('button', '确认切换并重启',
      'padding:7px 15px;border-radius:8px;border:none;background:' + t.primary + ';' +
      'color:' + t.primaryText + ';font:500 12.5px/1.3 system-ui;cursor:pointer;'
    );

    cancelBtn.addEventListener('click', function () {
      if (state.switching) return;
      state.confirmEmail = null;
      modal.style.display = 'none';
    });

    okBtn.addEventListener('click', function () {
      if (state.switching) return;
      state.switching = true;
      okBtn.textContent = '正在切换并重启…';
      okBtn.style.opacity = '0.72';
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      bridge.switchAccount(acc.email).then(function (res) {
        if (res && res.error) {
          state.switching = false;
          okBtn.textContent = '确认切换并重启';
          okBtn.style.opacity = '1';
          okBtn.disabled = false;
          cancelBtn.disabled = false;
          showToast('切号失败: ' + res.error);
        }
      }).catch(function (err) {
        state.switching = false;
        okBtn.textContent = '确认切换并重启';
        okBtn.style.opacity = '1';
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        showToast('切号失败: ' + (err && err.message ? err.message : String(err)));
      });
    });

    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(btns);
    modal.appendChild(box);
  }

  function openNewAccountModal() {
    closeMenus();
    state.confirmEmail = '__new_account__';
    if (!modal) {
      modal = el('div', '', '');
      modal.setAttribute('data-agy-accounts-ui', '1');
      modal.addEventListener('mousedown', function (e) {
        if (e.target === modal && !state.switching) {
          state.confirmEmail = null;
          modal.style.display = 'none';
        }
      });
      document.body.appendChild(modal);
    }
    var t = theme();
    modal.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(10,10,12,0.40);backdrop-filter:blur(4px);font-family:system-ui,-apple-system,Segoe UI,sans-serif;-webkit-app-region:no-drag;';
    while (modal.firstChild) modal.removeChild(modal.firstChild);

    var box = el('div', '',
      'width:372px;max-width:90vw;padding:20px 22px;border-radius:14px;' +
      'background:' + t.surface + ';color:' + t.fg + ';border:1px solid ' + t.border + ';box-shadow:' + t.shadow + ';'
    );
    box.appendChild(el('div', '添加新账号', 'font:600 15px/1.4 system-ui;margin-bottom:10px;'));
    box.appendChild(el('div',
      '当前账号的登录凭据已保存在列表中，不会丢失。',
      'font:500 12.5px/1.5 system-ui;color:' + t.fg + ';margin-bottom:6px;'
    ));
    box.appendChild(el('div',
      '确认退出当前登录并重启客户端进入登录页吗？用浏览器登录新账号后，打开「账号」菜单就会自动收录进列表。',
      'font:400 12.5px/1.5 system-ui;color:' + t.muted + ';margin-bottom:16px;'
    ));

    var btns = el('div', '', 'display:flex;justify-content:flex-end;gap:8px;');
    var cancelBtn = el('button', '取消',
      'padding:7px 14px;border-radius:8px;border:1px solid ' + t.border + ';background:transparent;' +
      'color:' + t.fg + ';font:500 12.5px/1.3 system-ui;cursor:pointer;'
    );
    var okBtn = el('button', '退出并登录新账号',
      'padding:7px 15px;border-radius:8px;border:none;background:' + t.primary + ';' +
      'color:' + t.primaryText + ';font:500 12.5px/1.3 system-ui;cursor:pointer;'
    );

    cancelBtn.addEventListener('click', function () {
      if (state.switching) return;
      state.confirmEmail = null;
      modal.style.display = 'none';
    });

    okBtn.addEventListener('click', function () {
      if (state.switching) return;
      if (typeof bridge.newAccount !== 'function') {
        showToast('请先运行一次 install-menu.cmd 更新主进程补丁');
        return;
      }
      state.switching = true;
      okBtn.textContent = '正在退出并重启…';
      okBtn.style.opacity = '0.72';
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      bridge.newAccount().then(function (res) {
        if (res && res.error) {
          state.switching = false;
          okBtn.textContent = '退出并登录新账号';
          okBtn.style.opacity = '1';
          okBtn.disabled = false;
          cancelBtn.disabled = false;
          showToast('操作失败: ' + res.error);
        }
      }).catch(function () {
        state.switching = false;
        okBtn.textContent = '退出并登录新账号';
        okBtn.style.opacity = '1';
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        showToast('请先运行 install-menu.cmd 更新主进程补丁');
      });
    });

    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(btns);
    modal.appendChild(box);
  }

  function renderDropdown() {
    ensureContainers();
    if (!state.open) {
      dropdownWrap.style.display = 'none';
      return;
    }

    var t = theme();
    dropdown.style.cssText =
      'width:228px;padding:6px;border-radius:12px;' +
      'background:' + t.surface + ';color:' + t.fg + ';border:1px solid ' + t.border + ';' +
      'box-shadow:' + t.shadow + ';font-family:system-ui,-apple-system,Segoe UI,sans-serif;' +
      '-webkit-app-region:no-drag;';
    while (dropdown.firstChild) dropdown.removeChild(dropdown.firstChild);

    var accounts = (state.data && state.data.accounts) || [];
    var header = el('div', '', 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px 6px;');
    header.appendChild(el('span', '账号池', 'font:500 11px/1.2 system-ui;color:' + t.muted + ';'));
    header.appendChild(el('span', accounts.length + ' 个', 'font:400 11px/1.2 system-ui;color:' + t.muted + ';'));
    dropdown.appendChild(header);

    if (!accounts.length) {
      dropdown.appendChild(el('div', state.loading ? '正在读取…' : '暂无已保存账号', 'padding:10px 8px;font:400 12px/1.4 system-ui;color:' + t.muted + ';'));
    } else {
      accounts.forEach(function (acc) {
        var isHovered = state.hoverEmail === acc.email;
        var row = el('div', '',
          'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;' +
          'border-radius:8px;cursor:pointer;transition:background .12s ease;' +
          'background:' + (isHovered ? t.hover : 'transparent') + ';'
        );
        row.setAttribute('data-agy-email', acc.email);

        var left = el('div', '', 'display:flex;align-items:center;gap:8px;min-width:0;');
        var dot = el('span', '',
          'width:7px;height:7px;border-radius:50%;flex-shrink:0;' +
          'background:' + (acc.active ? t.green : 'transparent') + ';' +
          'border:1.5px solid ' + (acc.active ? t.green : t.border) + ';'
        );
        left.appendChild(dot);
        left.appendChild(el('span', acc.shortName, 'font:600 13px/1.25 ui-monospace,SFMono-Regular,Consolas,monospace;color:' + t.fg + ';'));
        if (acc.active) {
          left.appendChild(el('span', '当前', 'font:500 10px/1.2 system-ui;padding:1px 5px;border-radius:4px;background:' + t.greenBg + ';color:' + t.green + ';'));
        }
        row.appendChild(left);

        var right = el('div', '', 'display:flex;align-items:center;gap:4px;flex-shrink:0;');
        if (!acc.active) {
          right.appendChild(el('span', '›', 'font:400 13px/1 system-ui;color:' + t.muted + ';opacity:0.65;'));
        }
        row.appendChild(right);

        row.addEventListener('mouseenter', function () {
          clearCloseTimer();
          if (state.hoverEmail !== acc.email) {
            state.hoverEmail = acc.email;
            var allRows = dropdown.querySelectorAll('[data-agy-email]');
            for (var k = 0; k < allRows.length; k++) {
              allRows[k].style.background = allRows[k] === row ? t.hover : 'transparent';
            }
            updateEmailHint();
          }
        });
        row.addEventListener('click', function (e) {
          e.stopPropagation();
          if (acc.active) {
            showToast('当前已在使用账号「' + acc.shortName + '」');
            return;
          }
          if (!acc.inPool) {
            showToast('该账号尚未入池，请重新打开菜单同步');
            return;
          }
          openConfirmModal(acc);
        });

        dropdown.appendChild(row);
      });
    }

    dropdown.appendChild(el('div', '', 'height:1px;background:' + t.border + ';margin:6px 4px;'));

    var newRow = el('div', '+ 添加新账号',
      'padding:6px 9px;border-radius:7px;cursor:pointer;font:500 12px/1.3 system-ui;color:' + t.primary + ';'
    );
    newRow.addEventListener('mouseenter', function () {
      newRow.style.background = t.hover;
      if (state.hoverEmail) {
        state.hoverEmail = null;
        var allRows = dropdown.querySelectorAll('[data-agy-email]');
        for (var k = 0; k < allRows.length; k++) allRows[k].style.background = 'transparent';
        updateEmailHint();
      }
    });
    newRow.addEventListener('mouseleave', function () { newRow.style.background = 'transparent'; });
    newRow.addEventListener('click', function (e) {
      e.stopPropagation();
      openNewAccountModal();
    });
    dropdown.appendChild(newRow);

    emailHintEl = el('div', state.hoverEmail || '点击目标账号可安全切换',
      'padding:3px 9px 2px;font:400 10.5px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;color:' + t.muted + ';' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.85;'
    );
    dropdown.appendChild(emailHintEl);
  }

  function hasSiblingMenuText(container) {
    if (!container) return false;
    var pText = container.textContent || '';
    return (pText.indexOf('视图') !== -1 || pText.indexOf('View') !== -1) &&
      (pText.indexOf('工作区') !== -1 || pText.indexOf('Workspace') !== -1 || pText.indexOf('Antigravity') !== -1);
  }

  function findWindowMenuButton() {
    var candidates = document.querySelectorAll('button, [role="menuitem"], [role="button"]');
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (!node || node.getAttribute('data-agy-accounts-ui')) continue;
      if (node.children && node.children.length > 0) continue;
      var txt = (node.textContent || '').trim();
      if (txt !== '窗口' && txt !== 'Window') continue;
      var rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top >= 70 || rect.left >= 500) continue;

      if (hasSiblingMenuText(node.parentElement)) return { btn: node, anchor: node };
      if (node.parentElement && hasSiblingMenuText(node.parentElement.parentElement)) return { btn: node, anchor: node.parentElement };
    }
    return null;
  }

  function mountButton() {
    if (menuBtn && document.contains(menuBtn)) return;
    var found = findWindowMenuButton();
    if (!found || !found.anchor || !found.anchor.parentElement) return;
    var oldBtn = document.getElementById('agy-menu-accounts-btn');
    if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);

    var winBtn = found.btn;
    var anchor = found.anchor;
    var btn = document.createElement('button');
    btn.id = 'agy-menu-accounts-btn';
    btn.type = 'button';
    btn.setAttribute('data-agy-accounts-ui', '1');
    btn.setAttribute('data-i18n-ignore', '1');
    btn.className = winBtn.className || '';
    btn.textContent = '账号';
    btn.style.webkitAppRegion = 'no-drag';

    btn.addEventListener('mouseenter', function () {
      openMenu(false);
    });
    btn.addEventListener('mouseleave', function () {
      scheduleClose();
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.open && state.pinned) {
        closeMenus();
      } else {
        openMenu(true);
      }
    });

    if (anchor !== winBtn) {
      var wrap = document.createElement(anchor.tagName.toLowerCase());
      wrap.className = anchor.className || '';
      wrap.setAttribute('data-agy-accounts-ui', '1');
      wrap.style.webkitAppRegion = 'no-drag';
      wrap.appendChild(btn);
      anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
    } else {
      anchor.parentElement.insertBefore(btn, anchor.nextSibling);
    }
    menuBtn = btn;
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (state.open && isPointerInsideMenu()) {
      clearCloseTimer();
    }
  }

  function onMouseDown(e) {
    if (!state.open) return;
    var t = e.target;
    if ((menuBtn && menuBtn.contains(t)) || (dropdownWrap && dropdownWrap.contains(t))) return;
    closeMenus();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (state.confirmEmail && !state.switching && modal) {
        state.confirmEmail = null;
        modal.style.display = 'none';
      } else if (state.open) {
        closeMenus();
      }
    }
  }

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  globalThis.__AGY_ACCOUNTS_MENU_CLEANUP__ = function () {
    clearCloseTimer();
    if (toastTimer) clearTimeout(toastTimer);
    if (moTimer) clearTimeout(moTimer);
    if (mo) { mo.disconnect(); mo = null; }
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    [menuBtn && menuBtn.parentElement && menuBtn.parentElement.getAttribute('data-agy-accounts-ui') ? menuBtn.parentElement : menuBtn, dropdownWrap, modal, toastEl].forEach(function (n) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
  };

  function init() {
    mountButton();
    if (document.body) {
      mo = new MutationObserver(function () {
        if (moTimer) return;
        moTimer = setTimeout(function () {
          moTimer = null;
          mountButton();
        }, 350);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
