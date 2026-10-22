/**
 * LinkNotify - Apple Light Liquid-Glass Application Logic
 * Adheres strictly to Greensock GSAP Animation Skills
 * Zero Emojis Permitted, True Device Connection Status
 */

(function () {
  'use strict';

  // State Management
  const STATE = {
    role: localStorage.getItem('linknotify_role') || 'A', // 'A' or 'B'
    pairCode: localStorage.getItem('linknotify_pair_code') || null,
    activeTab: 'tabNotify',
    mqttClient: null,
    mqttConnected: false,
    lastPeerHeartbeat: 0,
    peerBattery: null,
    peerCharging: false,
    peerPerm: false,
    peerSignalDbm: null,
    peerDeviceName: null,
    activeFilter: 'all',
    notifications: [],
    qr: null,
    heartbeatTimer: null,
    statusEvalTimer: null
  };

  // DOM Elements
  const el = {
    currentRoleTitle: document.getElementById('currentRoleTitle'),
    modeSelectRow: document.getElementById('modeSelectRow'),
    connPill: document.getElementById('connStatusPill'),
    connDot: document.getElementById('connStatusDot'),
    connText: document.getElementById('connStatusText'),
    roleModal: document.getElementById('roleSelectModal'),
    btnCloseRoleModal: document.getElementById('btnCloseRoleModal'),
    btnChooseRoleA: document.getElementById('btnChooseRoleA'),
    btnChooseRoleB: document.getElementById('btnChooseRoleB'),
    checkRoleA: document.getElementById('checkRoleA'),
    checkRoleB: document.getElementById('checkRoleB'),
    btnDisconnect: document.getElementById('btnDisconnect'),
    deviceTitleA: document.getElementById('deviceTitleA'),
    deviceTitleB: document.getElementById('deviceTitleB'),
    tagLocalA: document.getElementById('tagLocalA'),
    tagLocalB: document.getElementById('tagLocalB'),
    permAVal: document.getElementById('permAVal'),
    permBVal: document.getElementById('permBVal'),
    battAVal: document.getElementById('battAVal'),
    battBVal: document.getElementById('battBVal'),
    signalANum: document.getElementById('signalANum'),
    signalBNum: document.getElementById('signalBNum'),
    signalASvg: document.getElementById('signalASvg'),
    signalBSvg: document.getElementById('signalBSvg'),
    pairInputModal: document.getElementById('pairInputModal'),
    btnClosePairModal: document.getElementById('btnClosePairModal'),
    btnOpenPairModal: document.getElementById('btnOpenPairModal'),
    btnPastePairCode: document.getElementById('btnPastePairCode'),
    btnConfirmPair: document.getElementById('btnConfirmPair'),
    boundDeviceInfo: document.getElementById('boundDeviceInfo'),
    codeHeroBanner: document.getElementById('codeHeroBanner'),
    heroCodeSource: document.getElementById('heroCodeSource'),
    heroCodeValue: document.getElementById('heroCodeValue'),
    heroCodeTime: document.getElementById('heroCodeTime'),
    btnCopyHeroCode: document.getElementById('btnCopyHeroCode'),
    filterTabs: document.getElementById('filterTabs'),
    feedContainer: document.getElementById('feedContainer'),
    emptyState: document.getElementById('emptyState'),
    countAll: document.getElementById('countAll'),
    countCode: document.getElementById('countCode'),
    countSms: document.getElementById('countSms'),
    countApp: document.getElementById('countApp'),
    codesVaultContainer: document.getElementById('codesVaultContainer'),
    emptyCodesState: document.getElementById('emptyCodesState'),
    pairDigitsBox: document.getElementById('pairDigitsBox'),
    qrCanvas: document.getElementById('qrCanvas'),
    btnRegenPairCode: document.getElementById('btnRegenPairCode'),
    btnCopyPairCode: document.getElementById('btnCopyPairCode'),
    pairTabModeACard: document.getElementById('pairTabModeACard'),
    pairTabBoundStatus: document.getElementById('pairTabBoundStatus'),
    btnOpenPairModalFromTab: document.getElementById('btnOpenPairModalFromTab'),
    btnOpenPermission: document.getElementById('btnOpenPermission'),
    btnRequestBattery: document.getElementById('btnRequestBattery'),
    bottomNavBar: document.getElementById('bottomNavBar'),
    toast: document.getElementById('toastNotice'),
    digitInputs: [
      document.getElementById('digit1'),
      document.getElementById('digit2'),
      document.getElementById('digit3'),
      document.getElementById('digit4'),
      document.getElementById('digit5'),
      document.getElementById('digit6')
    ]
  };

  /* ===================================================================
   * 1. GSAP Ambient & Micro-Interaction Enhancements
   * =================================================================== */
  function initGsapAnimations() {
    gsap.to('.blob-1', {
      x: 'random(-30, 30)',
      y: 'random(-25, 25)',
      scale: 1.1,
      duration: 12,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut'
    });

    gsap.to('.blob-2', {
      x: 'random(-40, 40)',
      y: 'random(-30, 30)',
      scale: 1.08,
      duration: 15,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 1.5
    });

    gsap.to('.blob-3', {
      x: 'random(-25, 25)',
      y: 'random(-25, 25)',
      scale: 1.15,
      duration: 14,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      delay: 3
    });

    document.querySelectorAll('.btn-liquid').forEach(btn => {
      btn.addEventListener('touchstart', () => {
        gsap.to(btn, { scale: 0.95, duration: 0.1, ease: 'power1.out' });
      }, { passive: true });

      btn.addEventListener('touchend', () => {
        gsap.to(btn, { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.4)' });
      }, { passive: true });

      btn.addEventListener('mousedown', () => {
        gsap.to(btn, { scale: 0.95, duration: 0.1, ease: 'power1.out' });
      });

      btn.addEventListener('mouseup', () => {
        gsap.to(btn, { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.4)' });
      });

      btn.addEventListener('mouseleave', () => {
        gsap.to(btn, { scale: 1, duration: 0.2, ease: 'power2.out' });
      });
    });
  }

  /* ===================================================================
   * 2. Crypto Utilities (End-to-End Encryption with 6-Digit Code)
   * =================================================================== */
  async function sha256Hex(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveAesKey(code) {
    const rawKey = new TextEncoder().encode(code.padEnd(32, '#').slice(0, 32));
    return await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptPayload(dataObj, code) {
    try {
      const key = await deriveAesKey(code);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(dataObj));
      const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoded
      );
      return JSON.stringify({
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(cipherBuffer))
      });
    } catch (e) {
      console.error('Encryption failed', e);
      return JSON.stringify(dataObj);
    }
  }

  async function decryptPayload(cipherJsonStr, code) {
    try {
      const parsed = JSON.parse(cipherJsonStr);
      if (!parsed.iv || !parsed.data) {
        return parsed;
      }
      const key = await deriveAesKey(code);
      const iv = new Uint8Array(parsed.iv);
      const data = new Uint8Array(parsed.data);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
      );
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      console.warn('Decryption failed');
      return null;
    }
  }

  /* ===================================================================
   * 3. Toast and UI Feedback
   * =================================================================== */
  function showToast(msg) {
    el.toast.textContent = msg;
    gsap.killTweensOf(el.toast);
    const tl = gsap.timeline();
    tl.to(el.toast, {
      y: 0,
      autoAlpha: 1,
      duration: 0.3,
      ease: 'back.out(1.6)'
    }).to(el.toast, {
      y: 35,
      autoAlpha: 0,
      duration: 0.25,
      ease: 'power2.in',
      delay: 2.0
    });
  }

  function triggerVibrate() {
    if (window.AndroidNative && window.AndroidNative.vibrate) {
      window.AndroidNative.vibrate();
    } else if (navigator.vibrate) {
      navigator.vibrate([45, 30, 45]);
    }
  }

  function copyText(text) {
    if (window.AndroidNative && window.AndroidNative.copyToClipboard) {
      window.AndroidNative.copyToClipboard(text);
      showToast('已复制');
      triggerVibrate();
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (e) {}

    showToast('已复制');
    triggerVibrate();
  }

  /* ===================================================================
   * 4. View Switching & Tab Navigation
   * =================================================================== */
  function switchTab(targetTabId) {
    if (STATE.activeTab === targetTabId) return;

    const currentTabEl = document.getElementById(STATE.activeTab);
    const targetTabEl = document.getElementById(targetTabId);
    if (!targetTabEl) return;

    // Update bottom nav bar active item
    const navItems = document.querySelectorAll('.menu a[data-tab]');
    navItems.forEach(item => {
      if (item.getAttribute('data-tab') === targetTabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    const tl = gsap.timeline({ defaults: { duration: 0.22, ease: 'power2.out' } });

    if (currentTabEl) {
      tl.to(currentTabEl, {
        autoAlpha: 0,
        scale: 0.98,
        y: -6,
        duration: 0.16,
        ease: 'power2.in',
        onComplete: () => {
          currentTabEl.style.display = 'none';
        }
      });
    }

    tl.set(targetTabEl, { display: 'block', autoAlpha: 0, scale: 0.98, y: 10 })
      .to(targetTabEl, {
        autoAlpha: 1,
        scale: 1,
        y: 0,
        duration: 0.24,
        ease: 'back.out(1.3)'
      });

    STATE.activeTab = targetTabId;

    if (targetTabId === 'tabCodes') {
      renderCodesVault();
    } else if (targetTabId === 'tabNotify') {
      renderFeed();
    } else if (targetTabId === 'tabPair') {
      if (STATE.pairCode) {
        renderPairDigits(STATE.pairCode);
        renderQrCode(STATE.pairCode);
      }
      updatePairTabStatus();
    } else if (targetTabId === 'tabSettings') {
      updateDualDeviceStatus();
    }
  }

  function updateRoleModalUI() {
    const isA = (STATE.role === 'A');
    if (el.currentRoleTitle) {
      el.currentRoleTitle.textContent = isA ? '主力' : '备用';
    }
    if (el.btnChooseRoleA) {
      el.btnChooseRoleA.classList.toggle('active-selected', isA);
    }
    if (el.btnChooseRoleB) {
      el.btnChooseRoleB.classList.toggle('active-selected', !isA);
    }
    if (el.checkRoleA) {
      el.checkRoleA.style.display = isA ? 'block' : 'none';
    }
    if (el.checkRoleB) {
      el.checkRoleB.style.display = !isA ? 'block' : 'none';
    }
  }

  function switchRole(newRole) {
    STATE.role = newRole;
    localStorage.setItem('linknotify_role', newRole);

    if (window.AndroidNative && window.AndroidNative.savePairConfig) {
      window.AndroidNative.savePairConfig(STATE.pairCode || '', newRole);
    }

    updateRoleModalUI();
    closeModal(el.roleModal);

    if (newRole === 'A') {
      if (el.pairTabModeACard) {
        el.pairTabModeACard.style.display = 'block';
      }
      initModeA();
    } else if (newRole === 'B') {
      if (el.pairTabModeACard) {
        el.pairTabModeACard.style.display = 'none';
      }
      initModeB();
    }

    updatePairTabStatus();
    updateDualDeviceStatus();
    connectMqtt();
  }

  function updatePairTabStatus() {
    if (el.pairTabBoundStatus) {
      if (STATE.pairCode) {
        const peerName = STATE.peerDeviceName ? ` (${STATE.peerDeviceName})` : '';
        el.pairTabBoundStatus.textContent = '当前绑定码: ' + formatPairCode(STATE.pairCode) + peerName;
      } else {
        el.pairTabBoundStatus.textContent = '未连接 (输入备用机 6 位码完成配对)';
      }
    }
  }

  function openModal(modalEl) {
    modalEl.style.visibility = 'visible';
    gsap.killTweensOf([modalEl, modalEl.firstElementChild]);
    gsap.to(modalEl, { autoAlpha: 1, duration: 0.22, ease: 'power2.out' });
    gsap.fromTo(modalEl.firstElementChild,
      { y: 30, scale: 0.94, autoAlpha: 0 },
      { y: 0, scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.4)' }
    );
  }

  function closeModal(modalEl) {
    gsap.to(modalEl.firstElementChild, { y: 20, scale: 0.96, autoAlpha: 0, duration: 0.18, ease: 'power2.in' });
    gsap.to(modalEl, {
      autoAlpha: 0,
      duration: 0.22,
      ease: 'power2.in',
      onComplete: () => { modalEl.style.visibility = 'hidden'; }
    });
  }

  /* ===================================================================
   * 5. Mode A: 主力机 (Receiver)
   * =================================================================== */
  function initModeA() {
    updateBoundDeviceUI();
    loadStoredNotifications();
    renderFeed();

    if (!STATE.pairCode) {
      setTimeout(() => openModal(el.pairInputModal), 350);
    }
  }

  function updateBoundDeviceUI() {
    const isModeA = (STATE.role === 'A');
    const isPeerOnline = !!(STATE.pairCode && STATE.mqttConnected && STATE.lastPeerHeartbeat > 0 && (Date.now() - STATE.lastPeerHeartbeat < 45000));
    if (STATE.pairCode && isPeerOnline) {
      const peerName = STATE.peerDeviceName || (isModeA ? '备用机' : '主力机');
      let battStr = '';
      if (STATE.peerBattery !== null) {
        battStr = ' · 电量 ' + STATE.peerBattery + '%' + (STATE.peerCharging ? ' (充电中)' : '');
      }
      el.boundDeviceInfo.textContent = peerName + ': ' + formatPairCode(STATE.pairCode) + battStr;
    } else {
      el.boundDeviceInfo.textContent = (isModeA ? '备用机: 未连接' : '主力机: 未连接');
    }
  }

  function formatPairCode(code) {
    if (!code || code.length < 6) return code || '------';
    return code.slice(0, 3) + ' ' + code.slice(3, 6);
  }

  function loadStoredNotifications() {
    try {
      const stored = localStorage.getItem('linknotify_history');
      STATE.notifications = stored ? JSON.parse(stored) : [];
    } catch (e) {
      STATE.notifications = [];
    }
  }

  function saveStoredNotifications() {
    try {
      localStorage.setItem('linknotify_history', JSON.stringify(STATE.notifications.slice(0, 100)));
    } catch (e) {}
  }

  function extractVerificationCode(text) {
    if (!text) return null;
    const match = text.match(/(?:验证码|动态码|校验码|确认码|code|Code|CODE)[^\d]{0,8}(\d{4,8})\b/i);
    if (match) return match[1];
    const plainMatch = text.match(/\b\d{4,8}\b/);
    return plainMatch ? plainMatch[0] : null;
  }

  function onNewNotificationReceived(item) {
    if (STATE.notifications.some(n => n.id === item.id)) return;

    const code = extractVerificationCode(item.content);
    item.verificationCode = code;

    STATE.notifications.unshift(item);
    saveStoredNotifications();

    if (code) {
      el.heroCodeSource.textContent = (item.title || item.appName || '验证码');
      el.heroCodeValue.textContent = code;
      el.heroCodeTime.textContent = '刚刚收到 · 10分钟内有效';
      el.codeHeroBanner.style.display = 'flex';

      gsap.killTweensOf(el.codeHeroBanner);
      gsap.fromTo(el.codeHeroBanner,
        { y: -20, scale: 0.94, autoAlpha: 0 },
        { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: 'back.out(1.5)' }
      );

      triggerVibrate();
    }

    renderFeed(true);
    if (code) {
      renderCodesVault();
    }
  }

  /**
   * Generates specific app icons for notifications.
   * Requirement:
   * All notifications except SMS MUST display the corresponding real application icon (as specific as possible).
   * 1. If sourceType === 'sms': Apple Messages style green squircle with white speech bubble.
   * 2. If item.icon exists (data:image/png;base64,... from Android PackageManager): Display real native app icon.
   * 3. Fallback: Detailed vector SVG brand logos for major Chinese and global apps.
   * 4. Universal fallback: Dynamic Apple squircle badge with first letter/character of app name and distinct gradient.
   */
  function getAppIconHtml(item) {
    if (!item) {
      return '<div class="feed-app-avatar" style="background: #8e8e93;"><svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg></div>';
    }

    const isSms = item.sourceType === 'sms';

    // 1. SMS: Dedicated Apple Messages green icon
    if (isSms) {
      return `
        <div class="feed-app-avatar" style="background: linear-gradient(135deg, #34C759, #30B74E);">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        </div>
      `;
    }

    // 2. Real native App Icon (Base64 PNG from Android PackageManager)
    if (item.icon && item.icon.startsWith('data:image')) {
      const altText = escapeHtml(item.appName || item.title || 'App');
      return `
        <div class="feed-app-avatar">
          <img class="feed-app-avatar-img" src="${item.icon}" alt="${altText}" onerror="this.parentElement.style.display='none';">
        </div>
      `;
    }

    // 3. Fallback: Precise brand vector icons
    const pkg = (item.packageName || '').toLowerCase();
    const name = (item.appName || item.title || '').toLowerCase();

    // WeChat (微信)
    if (pkg.includes('tencent.mm') || name.includes('微信')) {
      return `
        <div class="feed-app-avatar" style="background: #07C160;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff">
            <path d="M9.5 4C5.36 4 2 6.91 2 10.5c0 1.98.98 3.76 2.53 4.96L4 18.5l3.29-1.65c.7.2 1.44.31 2.21.31.25 0 .5-.02.74-.05-.24-.59-.38-1.23-.38-1.91 0-3.37 3.2-6.1 7.14-6.1.48 0 .94.04 1.39.13C19.7 6.47 15.09 4 9.5 4zm-2.25 4c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25-1.25-.56-1.25-1.25.56-1.25 1.25-1.25zm5.5 0c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25-1.25-.56-1.25-1.25.56-1.25 1.25-1.25zm3.75 4.2c-3.31 0-6 2.24-6 5s2.69 5 6 5c.62 0 1.22-.08 1.77-.24L21 23.5l-1.03-2.58C21.2 19.89 22 18.53 22 17c0-2.76-2.69-5-6-5zm-2 3c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm4 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1z"/>
          </svg>
        </div>
      `;
    }

    // QQ
    if (pkg.includes('tencent.mobileqq') || name.includes('qq')) {
      return `
        <div class="feed-app-avatar" style="background: #12B7F5;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff">
            <path d="M12 2C7.58 2 4 5.58 4 10c0 2.24.93 4.26 2.43 5.71-.28.84-.78 1.93-1.61 2.76-.23.23-.07.63.25.63 1.63 0 3.09-.64 4.07-1.58.9.31 1.86.48 2.86.48 4.42 0 8-3.58 8-8s-3.58-8-8-8zm-3 8c-.83 0-1.5-.67-1.5-1.5S8.17 7 9 7s1.5.67 1.5 1.5S9.83 10 9 10zm6 0c-.83 0-1.5-.67-1.5-1.5S14.17 7 15 7s1.5.67 1.5 1.5S15.83 10 15 10z"/>
          </svg>
        </div>
      `;
    }

    // Alipay (支付宝)
    if (pkg.includes('alipay') || name.includes('支付宝')) {
      return `
        <div class="feed-app-avatar" style="background: #1677FF;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff">
            <path d="M5 4h14v2H5V4zm1 5h12v2H6V9zm6 3c-2.8 0-5.1 1.8-5.8 4.3 1.2.9 2.7 1.5 4.3 1.5 3.3 0 6.1-2.2 6.8-5.2H12zm1.2 5.5c-1.1 0-2.1-.4-2.9-1.1.5-1.4 1.7-2.4 3.2-2.4h2.1c-.5 2-2.3 3.5-4.4 3.5z"/>
          </svg>
        </div>
      `;
    }

    // DingTalk (钉钉)
    if (pkg.includes('rimet') || name.includes('钉钉')) {
      return `
        <div class="feed-app-avatar" style="background: #007FFF;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </div>
      `;
    }

    // Feishu (飞书)
    if (pkg.includes('lark') || name.includes('飞书')) {
      return `
        <div class="feed-app-avatar" style="background: #3370FF;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        </div>
      `;
    }

    // Taobao (淘宝)
    if (pkg.includes('taobao') || name.includes('淘宝')) {
      return `
        <div class="feed-app-avatar" style="background: #FF5000;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M19.5 7h-3.6V5.5c0-.8-.7-1.5-1.5-1.5h-4.8c-.8 0-1.5.7-1.5 1.5V7H4.5c-.8 0-1.5.7-1.5 1.5v10c0 .8.7 1.5 1.5 1.5h15c.8 0 1.5-.7 1.5-1.5v-10c0-.8-.7-1.5-1.5-1.5zM9.6 5.5h4.8V7H9.6V5.5zm5.9 8.5c0 1.9-1.6 3.5-3.5 3.5s-3.5-1.6-3.5-3.5 1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5z"/>
          </svg>
        </div>
      `;
    }

    // JD (京东)
    if (pkg.includes('jingdong') || name.includes('京东')) {
      return `
        <div class="feed-app-avatar" style="background: #E1251B;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M17 18c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zM7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm0-3l1.1-2h7.45c.75 0 1.41-.41 1.75-1.03L21.7 4H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"/>
          </svg>
        </div>
      `;
    }

    // Douyin / TikTok (抖音)
    if (pkg.includes('aweme') || name.includes('抖音') || name.includes('tiktok')) {
      return `
        <div class="feed-app-avatar" style="background: #111113;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        </div>
      `;
    }

    // Weibo (微博)
    if (pkg.includes('weibo') || name.includes('微博')) {
      return `
        <div class="feed-app-avatar" style="background: #E6162D;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
        </div>
      `;
    }

    // Meituan (美团)
    if (pkg.includes('meituan') || name.includes('美团')) {
      return `
        <div class="feed-app-avatar" style="background: #FFC300;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#1C1C1E">
            <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>
          </svg>
        </div>
      `;
    }

    // Bilibili (哔哩哔哩 / B站)
    if (pkg.includes('bili') || name.includes('哔哩哔哩') || name.includes('b站')) {
      return `
        <div class="feed-app-avatar" style="background: #FB7299;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm-9 8c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm5 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/>
          </svg>
        </div>
      `;
    }

    // Banks (银行 / 招商 / 工行 / 建行 / 农行 / 中行)
    if (name.includes('银行') || name.includes('招商') || name.includes('工行') || name.includes('建行') || name.includes('农行') || name.includes('中行') || name.includes('交行')) {
      return `
        <div class="feed-app-avatar" style="background: #C8161D;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/>
          </svg>
        </div>
      `;
    }

    // Mail (邮箱 / Gmail / Outlook)
    if (pkg.includes('mail') || pkg.includes('gm') || name.includes('邮箱') || name.includes('邮件')) {
      return `
        <div class="feed-app-avatar" style="background: #007AFF;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </div>
      `;
    }

    // Phone / Calls (电话 / 通话 / 来电)
    if (pkg.includes('dialer') || name.includes('电话') || name.includes('通话') || name.includes('来电')) {
      return `
        <div class="feed-app-avatar" style="background: #34C759;">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.44-5.15-3.75-6.59-6.59l1.97-1.57c.27-.27.36-.66.24-1.01-.36-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.72 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
          </svg>
        </div>
      `;
    }

    // 4. Universal Fallback: Dynamic Apple squircle badge with first letter/character
    const targetText = (item.appName || item.title || '应').trim();
    const firstChar = targetText ? targetText.charAt(0).toUpperCase() : 'A';
    const gradients = [
      'linear-gradient(135deg, #5856D6, #3634A3)',
      'linear-gradient(135deg, #FF2D55, #D01137)',
      'linear-gradient(135deg, #AF52DE, #8931B6)',
      'linear-gradient(135deg, #007AFF, #0051A8)',
      'linear-gradient(135deg, #34C759, #248A3D)',
      'linear-gradient(135deg, #FF9500, #C97200)',
      'linear-gradient(135deg, #5AC8FA, #1B97D4)'
    ];
    let hash = 0;
    for (let i = 0; i < targetText.length; i++) {
      hash = (hash << 5) - hash + targetText.charCodeAt(i);
      hash |= 0;
    }
    const bgGradient = gradients[Math.abs(hash) % gradients.length];

    return `
      <div class="feed-app-avatar" style="background: ${bgGradient};">
        <span style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif; font-size: 0.88rem; font-weight: 700; color: #ffffff;">${escapeHtml(firstChar)}</span>
      </div>
    `;
  }

  function renderFeed(isNewArrival = false) {
    const list = STATE.notifications.filter(item => {
      if (STATE.activeFilter === 'code') return !!item.verificationCode;
      if (STATE.activeFilter === 'sms') return item.sourceType === 'sms';
      if (STATE.activeFilter === 'app') return item.sourceType !== 'sms';
      return true;
    });

    el.countAll.textContent = '(' + STATE.notifications.length + ')';
    el.countCode.textContent = '(' + STATE.notifications.filter(n => !!n.verificationCode).length + ')';
    el.countSms.textContent = '(' + STATE.notifications.filter(n => n.sourceType === 'sms').length + ')';
    el.countApp.textContent = '(' + STATE.notifications.filter(n => n.sourceType !== 'sms').length + ')';

    el.feedContainer.innerHTML = '';

    if (list.length === 0) {
      el.emptyState.style.display = 'block';
      return;
    } else {
      el.emptyState.style.display = 'none';
    }

    const fragment = document.createDocumentFragment();

    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'feed-card';

      const isSms = item.sourceType === 'sms';
      const timeStr = formatRelativeTime(item.timestamp);
      const appName = item.appName || (isSms ? '短信' : '应用通知');
      const hasDistinctTitle = item.title && item.title.trim() && item.title.trim() !== appName.trim();

      let codeHtml = '';
      if (item.verificationCode) {
        codeHtml = `
          <div class="feed-code-action-bar">
            <div>
              <span style="font-size: 0.72rem; color: var(--apple-blue); margin-right: 6px;">验证码:</span>
              <span class="feed-extracted-code">${item.verificationCode}</span>
            </div>
            <button class="btn-liquid btn-liquid-primary btn-liquid-sm" data-code="${item.verificationCode}">
              复制
            </button>
          </div>
        `;
      }

      const iconHtml = getAppIconHtml(item);

      card.innerHTML = `
        <div class="feed-header-row">
          <div class="feed-app-meta">
            ${iconHtml}
            <div class="feed-app-info">
              <span class="feed-app-name">${escapeHtml(appName)}</span>
              <span class="feed-source-pill ${isSms ? 'pill-sms' : 'pill-app'}">${isSms ? '短信' : '应用'}</span>
            </div>
          </div>
          <span class="feed-time">${timeStr}</span>
        </div>
        <div class="feed-content-box">
          ${hasDistinctTitle ? `<div class="feed-msg-title">${escapeHtml(item.title)}</div>` : ''}
          <div class="feed-msg-body">${escapeHtml(item.content || '')}</div>
          ${codeHtml}
        </div>
      `;

      const copyBtn = card.querySelector('button[data-code]');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyText(copyBtn.getAttribute('data-code'));
        });
      }

      fragment.appendChild(card);
    });

    el.feedContainer.appendChild(fragment);

    if (isNewArrival) {
      const firstCard = el.feedContainer.firstElementChild;
      if (firstCard) {
        gsap.fromTo(firstCard,
          { y: -25, autoAlpha: 0, scale: 0.94 },
          { y: 0, autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(1.5)' }
        );
      }
    } else {
      gsap.fromTo('.feed-card',
        { y: 16, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.04, ease: 'power2.out' }
      );
    }
  }

  function renderCodesVault() {
    if (!el.codesVaultContainer) return;

    const codesList = STATE.notifications.filter(n => !!n.verificationCode);
    el.codesVaultContainer.innerHTML = '';

    if (codesList.length === 0) {
      if (el.emptyCodesState) el.emptyCodesState.style.display = 'block';
      return;
    }

    if (el.emptyCodesState) el.emptyCodesState.style.display = 'none';

    const frag = document.createDocumentFragment();
    codesList.forEach(item => {
      const card = document.createElement('div');
      card.className = 'liquid-card';
      card.style.padding = '14px 16px';
      card.style.marginBottom = '12px';

      const isSms = item.sourceType === 'sms';
      const timeStr = formatRelativeTime(item.timestamp);
      const appName = item.appName || (isSms ? '短信' : '应用');
      const iconHtml = getAppIconHtml(item);

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
          <div style="display: flex; gap: 10px; align-items: flex-start; flex: 1; min-width: 0;">
            ${iconHtml}
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="feed-source-pill ${isSms ? 'pill-sms' : 'pill-app'}">${isSms ? '短信' : '应用'}</span>
                <span style="font-size: 0.86rem; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(item.title || appName)}
                </span>
              </div>
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', monospace; font-size: 1.6rem; font-weight: 800; letter-spacing: 0.12em; color: var(--apple-blue); margin: 4px 0 2px;">
                ${escapeHtml(item.verificationCode)}
              </div>
              <div style="font-size: 0.72rem; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${timeStr} · ${escapeHtml((item.content || '').slice(0, 50))}
              </div>
            </div>
          </div>
          <button class="btn-liquid btn-liquid-primary btn-liquid-sm" data-vault-code="${item.verificationCode}">
            复制
          </button>
        </div>
      `;

      const btn = card.querySelector('button[data-vault-code]');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyText(item.verificationCode);
        });
      }

      frag.appendChild(card);
    });

    el.codesVaultContainer.appendChild(frag);

    gsap.fromTo(el.codesVaultContainer.children,
      { y: 14, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.3, stagger: 0.04, ease: 'power2.out' }
    );
  }

  function formatRelativeTime(ts) {
    if (!ts) return '刚刚';
    const diff = Math.floor((Date.now() - Number(ts)) / 1000);
    if (diff < 30) return '刚刚';
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    const d = new Date(Number(ts));
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ===================================================================
   * 6. Mode B: 备用机 (Transmitter)
   * =================================================================== */
  function initModeB() {
    if (!STATE.pairCode) {
      generateNewPairCode();
    } else {
      renderPairDigits(STATE.pairCode);
      renderQrCode(STATE.pairCode);
    }
    updateDualDeviceStatus();
  }

  function generateNewPairCode(isManual = false) {
    const num = Math.floor(100000 + Math.random() * 900000).toString();
    STATE.pairCode = num;
    localStorage.setItem('linknotify_pair_code', num);

    if (window.AndroidNative && window.AndroidNative.savePairConfig) {
      window.AndroidNative.savePairConfig(num, 'B');
    }

    renderPairDigits(num);
    renderQrCode(num);
    connectMqtt();
    if (isManual) {
      showToast('已刷新');
    }
  }

  function renderPairDigits(code) {
    const digits = code.split('');
    const digitEls = el.pairDigitsBox.querySelectorAll('.pair-digit');
    digitEls.forEach((box, idx) => {
      box.textContent = digits[idx] || '-';
    });

    gsap.fromTo(digitEls,
      { y: -10, scale: 0.9 },
      { y: 0, scale: 1, duration: 0.3, stagger: 0.03, ease: 'back.out(1.8)' }
    );
  }

  function renderQrCode(code) {
    try {
      if (!STATE.qr) {
        STATE.qr = new QRious({
          element: el.qrCanvas,
          value: 'linknotify://pair/' + code,
          size: 154,
          background: '#ffffff',
          foreground: '#1c1c1e',
          level: 'M'
        });
      } else {
        STATE.qr.value = 'linknotify://pair/' + code;
      }
    } catch (e) {
      console.error('QR code render failed', e);
    }
  }

  function renderSignalSvg(svgEl, dbm, isOnline) {
    if (!svgEl) return;
    const rects = svgEl.querySelectorAll('rect');
    if (!rects || rects.length !== 4) return;

    if (!isOnline || dbm === null || isNaN(Number(dbm))) {
      rects.forEach(r => r.setAttribute('fill', 'rgba(0,0,0,0.18)'));
      return;
    }

    const val = Number(dbm);
    let bars = 1;
    if (val >= -65) bars = 4;
    else if (val >= -78) bars = 3;
    else if (val >= -90) bars = 2;
    else bars = 1;

    const activeColor = '#007aff';
    const inactiveColor = 'rgba(0,0,0,0.18)';

    rects.forEach((r, idx) => {
      r.setAttribute('fill', idx < bars ? activeColor : inactiveColor);
    });
  }

  const KNOWN_DEVICE_MODELS = {
    'V2344A': 'Vivo S18pro',
    'V2344DA': 'Vivo S18pro',
    'V2323A': 'Vivo S18',
    'V2329A': 'Vivo S18e',
    'V2362A': 'Vivo S19',
    'V2364A': 'Vivo S19 Pro',
    'V2309A': 'Vivo X100 Pro',
    'V2324A': 'Vivo X100',
    'V2324HA': 'Vivo X100s',
    'V2359A': 'Vivo X100 Ultra',
    'V2405A': 'Vivo X200',
    'V2415A': 'Vivo X200 Pro',
    'V2419A': 'Vivo X200 Pro mini',
    'V2338A': 'iQOO 12',
    '23127PN0CC': 'Xiaomi 14',
    '23116PN5BC': 'Xiaomi 14 Pro',
    '24031PN0DC': 'Xiaomi 14 Ultra',
    '24129PN74C': 'Xiaomi 15',
    '24101PNABC': 'Xiaomi 15 Pro',
    '2210132C': 'Xiaomi 13 Pro',
    '2211133C': 'Xiaomi 13',
    '2311DRK48C': 'Redmi K70',
    '23113RKC6C': 'Redmi K70 Pro',
    '24117RK2CC': 'Redmi K80',
    '24122RKC7C': 'Redmi K80 Pro',
    'ALN-AL00': 'HUAWEI Mate 60 Pro',
    'ALN-AL80': 'HUAWEI Mate 60 Pro',
    'BRA-AL00': 'HUAWEI Mate 60',
    'HBP-AL00': 'HUAWEI Pura 70',
    'HBN-AL00': 'HUAWEI Pura 70 Pro',
    'BVY-AN00': 'HONOR Magic6 Pro',
    'PHY110': 'OPPO Find X7',
    'PHZ110': 'OPPO Find X7 Ultra',
    'PKB110': 'OPPO Find X8',
    'PJD110': 'OnePlus 12',
    'PJJ110': 'OnePlus Ace 3',
    'SM-S9280': 'Galaxy S24 Ultra',
    'SM-S9210': 'Galaxy S24'
  };

  function resolveFriendlyDeviceName(modelStr) {
    if (!modelStr) return '未知设备';
    const clean = modelStr.trim();
    if (KNOWN_DEVICE_MODELS[clean.toUpperCase()]) {
      return KNOWN_DEVICE_MODELS[clean.toUpperCase()];
    }
    return clean;
  }

  function getLocalDeviceInfo() {
    if (window.AndroidNative && window.AndroidNative.getDeviceInfo) {
      try {
        const d = JSON.parse(window.AndroidNative.getDeviceInfo());
        if (d.friendlyName) return d.friendlyName;
        if (d.model) return resolveFriendlyDeviceName(d.model);
        if (d.deviceName) return d.deviceName;
      } catch (e) {}
    }
    return '当前设备';
  }

  function getLocalBatteryInfo() {
    if (window.AndroidNative && window.AndroidNative.getBatteryInfo) {
      try {
        const b = JSON.parse(window.AndroidNative.getBatteryInfo());
        return { percent: (b.percent !== undefined && b.percent !== null) ? b.percent : null, isCharging: !!b.isCharging };
      } catch (e) {}
    }
    return { percent: null, isCharging: false };
  }

  function getLocalSignalInfo() {
    if (window.AndroidNative && window.AndroidNative.getSignalInfo) {
      try {
        const s = JSON.parse(window.AndroidNative.getSignalInfo());
        return { dbm: (s.dbm !== undefined && s.dbm !== null) ? s.dbm : null, level: s.level || 0, type: s.type || 'none' };
      } catch (e) {}
    }
    return { dbm: null, level: 0, type: 'none' };
  }

  function getLocalPermissionInfo() {
    if (window.AndroidNative && window.AndroidNative.checkPermissions) {
      try {
        const p = JSON.parse(window.AndroidNative.checkPermissions());
        return { notification: !!p.notificationListener, battery: !!p.batteryIgnoring };
      } catch (e) {}
    }
    return { notification: null, battery: null };
  }

  function updateDualDeviceStatus() {
    const isModeA = (STATE.role === 'A');
    const localBatt = getLocalBatteryInfo();
    const localSig = getLocalSignalInfo();
    const localPerm = getLocalPermissionInfo();
    const localDevice = getLocalDeviceInfo();

    const isPeerOnline = !!(STATE.pairCode && STATE.mqttConnected && STATE.lastPeerHeartbeat > 0 && (Date.now() - STATE.lastPeerHeartbeat < 45000));

    // "本机" Badge Toggle
    if (el.tagLocalA) el.tagLocalA.style.display = isModeA ? 'inline-block' : 'none';
    if (el.tagLocalB) el.tagLocalB.style.display = !isModeA ? 'inline-block' : 'none';

    // Update Device Titles
    if (isModeA) {
      if (el.deviceTitleA) el.deviceTitleA.textContent = localDevice;
      if (el.deviceTitleB) {
        el.deviceTitleB.textContent = isPeerOnline ? (STATE.peerDeviceName || '备用机') : '未连接';
      }
    } else {
      if (el.deviceTitleB) el.deviceTitleB.textContent = localDevice;
      if (el.deviceTitleA) {
        el.deviceTitleA.textContent = isPeerOnline ? (STATE.peerDeviceName || '主力机') : '未连接';
      }
    }

    // A端 Metrics
    if (isModeA) {
      // Local is A
      if (el.permAVal) {
        if (localPerm.notification === true) {
          el.permAVal.innerHTML = '<span class="status-dot"></span><span style="color: var(--apple-green);">已开启</span>';
        } else if (localPerm.notification === false) {
          el.permAVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--apple-orange); cursor: pointer;">未开启</span>';
        } else {
          el.permAVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--text-tertiary);">待检测</span>';
        }
      }
      if (el.battAVal) {
        el.battAVal.textContent = localBatt.percent !== null ? (localBatt.percent + '%' + (localBatt.isCharging ? ' · 充' : '')) : '--%';
      }
      if (el.signalANum) {
        el.signalANum.textContent = localSig.dbm !== null ? (localSig.dbm + ' dBm') : '-- dBm';
      }
      renderSignalSvg(el.signalASvg, localSig.dbm, localSig.dbm !== null);
    } else {
      // Remote peer is A
      if (el.permAVal) {
        if (isPeerOnline) {
          const permOn = (STATE.peerPerm === true);
          el.permAVal.innerHTML = `<span class="status-dot ${permOn ? '' : 'offline'}"></span><span style="color: ${permOn ? 'var(--apple-green)' : 'var(--apple-orange)'};">${permOn ? '已开启' : '未开启'}</span>`;
        } else {
          el.permAVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--text-tertiary);">未连接</span>';
        }
      }
      if (el.battAVal) {
        el.battAVal.textContent = (isPeerOnline && STATE.peerBattery !== null) ? STATE.peerBattery + '%' + (STATE.peerCharging ? ' · 充' : '') : '--%';
      }
      if (el.signalANum) {
        el.signalANum.textContent = (isPeerOnline && STATE.peerSignalDbm !== null) ? STATE.peerSignalDbm + ' dBm' : '-- dBm';
      }
      renderSignalSvg(el.signalASvg, isPeerOnline ? STATE.peerSignalDbm : null, isPeerOnline);
    }

    // B端 Metrics
    if (!isModeA) {
      // Local is B
      if (el.permBVal) {
        if (localPerm.notification === true) {
          el.permBVal.innerHTML = '<span class="status-dot"></span><span style="color: var(--apple-green);">已开启</span>';
        } else if (localPerm.notification === false) {
          el.permBVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--apple-orange); cursor: pointer;">未开启</span>';
        } else {
          el.permBVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--text-tertiary);">待检测</span>';
        }
      }
      if (el.battBVal) {
        el.battBVal.textContent = localBatt.percent !== null ? (localBatt.percent + '%' + (localBatt.isCharging ? ' · 充' : '')) : '--%';
      }
      if (el.signalBNum) {
        el.signalBNum.textContent = localSig.dbm !== null ? (localSig.dbm + ' dBm') : '-- dBm';
      }
      renderSignalSvg(el.signalBSvg, localSig.dbm, localSig.dbm !== null);
    } else {
      // Remote peer is B
      if (el.permBVal) {
        if (isPeerOnline) {
          const permOn = (STATE.peerPerm === true);
          el.permBVal.innerHTML = `<span class="status-dot ${permOn ? '' : 'offline'}"></span><span style="color: ${permOn ? 'var(--apple-green)' : 'var(--apple-orange)'};">${permOn ? '已开启' : '未开启'}</span>`;
        } else {
          el.permBVal.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--text-tertiary);">未连接</span>';
        }
      }
      if (el.battBVal) {
        el.battBVal.textContent = (isPeerOnline && STATE.peerBattery !== null) ? STATE.peerBattery + '%' + (STATE.peerCharging ? ' · 充' : '') : '--%';
      }
      if (el.signalBNum) {
        el.signalBNum.textContent = (isPeerOnline && STATE.peerSignalDbm !== null) ? STATE.peerSignalDbm + ' dBm' : '-- dBm';
      }
      renderSignalSvg(el.signalBSvg, isPeerOnline ? STATE.peerSignalDbm : null, isPeerOnline);
    }
  }

  /* ===================================================================
   * 7. Cross-Network MQTT Channel & Heartbeat Logic (True Status)
   * =================================================================== */
  async function connectMqtt() {
    if (!STATE.pairCode) {
      evaluateTrueConnectionStatus();
      return;
    }

    if (STATE.mqttClient) {
      try { STATE.mqttClient.end(); } catch (e) {}
    }

    const channelHash = (await sha256Hex(STATE.pairCode)).slice(0, 16);
    const topic = 'linknotify/v1/' + channelHash;

    setMqttConnected(false);

    const brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    const clientId = 'ln_' + (STATE.role || 'X') + '_' + Math.random().toString(16).slice(2, 8);

    try {
      const client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 3000
      });

      STATE.mqttClient = client;

      client.on('connect', () => {
        setMqttConnected(true);
        client.subscribe(topic, { qos: 1 }, () => {
          if (STATE.role === 'B') {
            sendHeartbeatPing();
          }
        });
      });

      client.on('message', async (recvTopic, messageBuffer) => {
        if (recvTopic !== topic) return;
        try {
          const rawStr = messageBuffer.toString();
          const decrypted = await decryptPayload(rawStr, STATE.pairCode);
          if (!decrypted) return;

          // Heartbeat message handler
          if (decrypted.type === 'heartbeat') {
            if (decrypted.role !== STATE.role) {
              STATE.lastPeerHeartbeat = Date.now();
              if (decrypted.battery !== undefined) {
                STATE.peerBattery = decrypted.battery;
                STATE.peerCharging = !!decrypted.isCharging;
              }
              if (decrypted.permission !== undefined) {
                STATE.peerPerm = decrypted.permission;
              }
              if (decrypted.signalDbm !== undefined) {
                STATE.peerSignalDbm = decrypted.signalDbm;
              }
              if (decrypted.deviceName) {
                STATE.peerDeviceName = resolveFriendlyDeviceName(decrypted.deviceName);
              }
              evaluateTrueConnectionStatus();
              updateBoundDeviceUI();
              updateDualDeviceStatus();

              // If Mode A receives B's ping and reply is enabled, send A's heartbeat so B also receives A's stats
              if (STATE.role === 'A' && decrypted.role === 'B' && decrypted.reply !== false) {
                sendHeartbeatPing(false);
              }
            }
            return;
          }

          // Real notification payload
          if (decrypted.content) {
            STATE.lastPeerHeartbeat = Date.now();
            if (STATE.role === 'A') {
              onNewNotificationReceived(decrypted);
              evaluateTrueConnectionStatus();
              updateDualDeviceStatus();
            }
          }
        } catch (e) {
          console.error('MQTT message error', e);
        }
      });

      client.on('error', () => {
        setMqttConnected(false);
      });

      client.on('close', () => {
        setMqttConnected(false);
      });
    } catch (e) {
      console.error('MQTT init error', e);
      setMqttConnected(false);
    }
  }

  function setMqttConnected(connected) {
    STATE.mqttConnected = connected;
    if (el.channelStatusVal) {
      el.channelStatusVal.textContent = connected ? '在线' : '离线';
    }
    evaluateTrueConnectionStatus();
  }

  // Periodic heartbeat from Mode B to prove device existence to Mode A
  function startHeartbeatRoutine() {
    if (STATE.heartbeatTimer) clearInterval(STATE.heartbeatTimer);
    STATE.heartbeatTimer = setInterval(() => {
      if (STATE.role === 'B' && STATE.mqttConnected) {
        sendHeartbeatPing();
      }
    }, 20000);

    if (STATE.statusEvalTimer) clearInterval(STATE.statusEvalTimer);
    STATE.statusEvalTimer = setInterval(evaluateTrueConnectionStatus, 4000);
  }

  async function sendHeartbeatPing(canReply = true) {
    if (!STATE.pairCode || !STATE.mqttClient || !STATE.mqttConnected) return;
    const channelHash = (await sha256Hex(STATE.pairCode)).slice(0, 16);
    const topic = 'linknotify/v1/' + channelHash;

    const batt = getLocalBatteryInfo();
    const perm = getLocalPermissionInfo();
    const sig = getLocalSignalInfo();
    const localDevice = getLocalDeviceInfo();

    const pingObj = {
      type: 'heartbeat',
      role: STATE.role,
      battery: batt.percent,
      isCharging: batt.isCharging,
      permission: perm.notification,
      signalDbm: sig.dbm,
      deviceName: localDevice,
      reply: canReply,
      time: Date.now()
    };

    const encrypted = await encryptPayload(pingObj, STATE.pairCode);
    STATE.mqttClient.publish(topic, encrypted, { qos: 0 });
  }

  // Evaluates REAL device-to-device connection status
  function evaluateTrueConnectionStatus() {
    if (!STATE.pairCode) {
      updateStatusBadge('offline', '未连接');
      updateDualDeviceStatus();
      return;
    }

    if (!STATE.mqttConnected) {
      updateStatusBadge('error', '未连接');
      updateDualDeviceStatus();
      return;
    }

    const now = Date.now();
    const timeSinceHeartbeat = now - STATE.lastPeerHeartbeat;

    if (STATE.role === 'B') {
      if (STATE.lastPeerHeartbeat > 0 && timeSinceHeartbeat < 45000) {
        updateStatusBadge('', (STATE.peerDeviceName || '主力机') + ' 在线');
      } else {
        updateStatusBadge('offline', '未连接');
      }
      updateDualDeviceStatus();
      return;
    }

    // Primary Phone (Mode A): Check if Phone B is genuinely alive
    if (STATE.role === 'A') {
      if (STATE.lastPeerHeartbeat > 0 && timeSinceHeartbeat < 45000) {
        let text = (STATE.peerDeviceName || '备用机') + ' 在线';
        if (STATE.peerBattery !== null) {
          text = (STATE.peerDeviceName || '备用机') + ' ' + STATE.peerBattery + '%';
        }
        updateStatusBadge('', text);
      } else {
        updateStatusBadge('offline', '未连接');
      }
      updateDualDeviceStatus();
    }
  }

  function updateStatusBadge(dotClass, text) {
    el.connText.textContent = text;
    el.connDot.className = 'status-dot';
    if (dotClass) {
      el.connDot.classList.add(dotClass);
    }
  }

  async function broadcastNotification(item) {
    if (!STATE.pairCode) return;
    const channelHash = (await sha256Hex(STATE.pairCode)).slice(0, 16);
    const topic = 'linknotify/v1/' + channelHash;

    const encrypted = await encryptPayload(item, STATE.pairCode);

    if (STATE.mqttClient && STATE.mqttConnected) {
      STATE.mqttClient.publish(topic, encrypted, { qos: 1 });
    }
  }

  /* ===================================================================
   * 8. Event Handlers & Modal Interactions
   * =================================================================== */
  function initEventHandlers() {
    if (el.modeSelectRow) {
      el.modeSelectRow.addEventListener('click', () => {
        updateRoleModalUI();
        openModal(el.roleModal);
      });
    }

    if (el.btnCloseRoleModal) {
      el.btnCloseRoleModal.addEventListener('click', () => {
        closeModal(el.roleModal);
      });
    }

    if (el.btnChooseRoleA) {
      el.btnChooseRoleA.addEventListener('click', () => {
        switchRole('A');
      });
    }

    if (el.btnChooseRoleB) {
      el.btnChooseRoleB.addEventListener('click', () => {
        switchRole('B');
      });
    }

    if (el.btnDisconnect) {
      el.btnDisconnect.addEventListener('click', () => {
        STATE.pairCode = null;
        STATE.lastPeerHeartbeat = 0;
        STATE.peerBattery = null;
        STATE.peerCharging = false;
        STATE.peerPerm = null;
        STATE.peerSignalDbm = null;
        STATE.peerDeviceName = null;
        localStorage.removeItem('linknotify_pair_code');

        if (window.AndroidNative && window.AndroidNative.savePairConfig) {
          window.AndroidNative.savePairConfig('', STATE.role);
        }

        if (STATE.mqttClient) {
          try {
            STATE.mqttClient.end(true);
          } catch (e) {}
          STATE.mqttClient = null;
        }
        setMqttConnected(false);

        updateBoundDeviceUI();
        updatePairTabStatus();
        updateDualDeviceStatus();
        evaluateTrueConnectionStatus();

        showToast('已断开连接');
        triggerVibrate();
      });
    }

    el.btnOpenPairModal.addEventListener('click', () => {
      openModal(el.pairInputModal);
      el.digitInputs[0].focus();
    });

    el.btnClosePairModal.addEventListener('click', () => closeModal(el.pairInputModal));

    el.digitInputs.forEach((input, index) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(0, 1);
        if (val && index < 5) {
          el.digitInputs[index + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
          el.digitInputs[index - 1].focus();
        }
      });
    });

    el.btnPastePairCode.addEventListener('click', async () => {
      try {
        let text = '';
        if (navigator.clipboard) {
          text = await navigator.clipboard.readText();
        }
        const digits = text.replace(/\D/g, '').slice(0, 6);
        if (digits.length === 6) {
          digits.split('').forEach((d, i) => {
            el.digitInputs[i].value = d;
          });
          showToast('已填入配对码: ' + digits);
        } else {
          showToast('未检测到 6 位数字');
        }
      } catch (e) {
        showToast('读取剪贴板失败');
      }
    });

    el.btnConfirmPair.addEventListener('click', () => {
      const code = el.digitInputs.map(i => i.value.trim()).join('');
      if (code.length !== 6) {
        showToast('请输入 6 位配对码');
        return;
      }
      STATE.pairCode = code;
      STATE.lastPeerHeartbeat = 0;
      localStorage.setItem('linknotify_pair_code', code);
      if (window.AndroidNative && window.AndroidNative.savePairConfig) {
        window.AndroidNative.savePairConfig(code, 'A');
      }
      closeModal(el.pairInputModal);
      updateBoundDeviceUI();
      connectMqtt();
      showToast('已绑定: ' + formatPairCode(code));
    });

    el.btnRegenPairCode.addEventListener('click', () => {
      generateNewPairCode(true);
    });
    el.btnCopyPairCode.addEventListener('click', () => {
      copyText(STATE.pairCode);
    });

    el.btnCopyHeroCode.addEventListener('click', () => {
      copyText(el.heroCodeValue.textContent);
    });

    // Apple Segmented Control Click
    el.filterTabs.querySelectorAll('.segment-item').forEach(chip => {
      chip.addEventListener('click', () => {
        el.filterTabs.querySelectorAll('.segment-item').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        STATE.activeFilter = chip.getAttribute('data-filter');
        renderFeed();
      });
    });

    el.btnOpenPermission.addEventListener('click', () => {
      if (window.AndroidNative && window.AndroidNative.openNotificationSettings) {
        window.AndroidNative.openNotificationSettings();
      } else {
        showToast('请在系统设置中授予通知读取权限');
      }
    });

    el.btnRequestBattery.addEventListener('click', () => {
      if (window.AndroidNative && window.AndroidNative.requestBatteryOptimization) {
        window.AndroidNative.requestBatteryOptimization();
      } else {
        showToast('系统设置已打开');
      }
    });

    // Floating Bottom Navigation (.menu a[data-tab])
    document.querySelectorAll('.menu a[data-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = tabBtn.getAttribute('data-tab');
        if (targetTab) {
          switchTab(targetTab);
        }
      });
    });


    if (el.btnOpenPairModalFromTab) {
      el.btnOpenPairModalFromTab.addEventListener('click', () => {
        openModal(el.pairInputModal);
        el.digitInputs[0].focus();
      });
    }

    if (el.btnClearCache) {
      el.btnClearCache.addEventListener('click', () => {
        STATE.notifications = [];
        localStorage.removeItem('linknotify_history');
        renderFeed();
        renderCodesVault();
        showToast('已清理本地缓存');
      });
    }
  }

  /* ===================================================================
   * 9. Exposed Global Hooks for Android Native Service Callbacks
   * =================================================================== */
  window.LinkNotifyNative = {
    onNotificationCollected: function (jsonStr) {
      try {
        const item = JSON.parse(jsonStr);
        if (STATE.role === 'B') {
          broadcastNotification(item);
        }
      } catch (e) {
        console.error('onNotificationCollected parse error', e);
      }
    },
    onAppResume: function () {
      updateDualDeviceStatus();
    }
  };

  /* ===================================================================
   * 10. Bootstrap App
   * =================================================================== */
  function start() {
    initGsapAnimations();
    initEventHandlers();
    startHeartbeatRoutine();

    if (window.AndroidNative && window.AndroidNative.getPairConfig) {
      try {
        const nativeCfg = JSON.parse(window.AndroidNative.getPairConfig());
        if (nativeCfg.role) STATE.role = nativeCfg.role;
        if (nativeCfg.pairCode) STATE.pairCode = nativeCfg.pairCode;
      } catch (e) {}
    }

    if (!STATE.role) {
      openModal(el.roleModal);
    } else {
      switchRole(STATE.role);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
