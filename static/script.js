(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ══════════════════════════════════════════════════════
  // CLERK AUTH GUARD
  // ══════════════════════════════════════════════════════
  window.addEventListener('load', async () => {
    await window.Clerk.load();

    if (!window.Clerk.user) {
      window.location.href = '/login';
      return;
    }

    const user     = window.Clerk.user;
    const fullName = user.fullName || user.firstName || 'User';
    const email    = user.primaryEmailAddress?.emailAddress || '';

    // Mount UserButton in topbar
    window.Clerk.mountUserButton($('#clerkUserButtonTopbar'), {
      afterSignOutUrl: '/login',
    });

    // Populate sidebar user card
    $('#userName').textContent  = fullName;
    $('#userEmail').textContent = email;

    const avatarWrap = $('#clerkUserButton');
    if (user.imageUrl) {
      avatarWrap.innerHTML = `<img src="${user.imageUrl}" class="user-avatar-img" alt="${fullName}" />`;
    } else {
      avatarWrap.innerHTML = `<div class="user-avatar-initials">${fullName.charAt(0).toUpperCase()}</div>`;
    }

    // Sign out button
    $('#signOutBtn')?.addEventListener('click', async () => {
      await window.Clerk.signOut();
      window.location.href = '/login';
    });

    // Sync user to backend
    try {
      const token = await window.Clerk.session.getToken();
      await fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ email, name: fullName }),
      });
    } catch (_) {}

    // Init the app
    initApp();
  });

  // ── Get auth token ─────────────────────────────────────
  async function getToken() {
    try {
      return await window.Clerk.session.getToken();
    } catch {
      window.location.href = '/login';
      return null;
    }
  }

  // ══════════════════════════════════════════════════════
  // MAIN APPLICATION
  // ══════════════════════════════════════════════════════
  function initApp() {
    // ── Element references ────────────────────────────────
    const sidebar         = $('#sidebar');
    const sidebarToggle   = $('#sidebarToggle');
    const backdrop        = $('#backdrop');
    const uploadToggleBtn = $('#uploadToggleBtn');
    const closePanelBtn   = $('#closePanelBtn');
    const uploadPanel     = $('#uploadPanel');
    const uploadForm      = $('#uploadForm');
    const uploadBtn       = $('#uploadBtn');
    const dropZone        = $('#dropZone');
    const fileInput       = $('#fileInput');
    const fileChip        = $('#fileChip');
    const fileChipName    = $('#fileChipName');
    const dropPrimary     = $('#dropPrimary');
    const progressWrap    = $('#progressWrap');
    const progressFill    = $('#progressFill');
    const progressLabel   = $('#progressLabel');
    const chatForm        = $('#chatForm');
    const chatInput       = $('#chatInput');
    const sendBtn         = $('#sendBtn');
    const messages        = $('#messages');
    const welcomeState    = $('#welcomeState');
    const typingRow       = $('#typingRow');
    const toastStack      = $('#toastStack');
    const newChatBtn      = $('#newChatBtn');
    const pdfListSidebar  = $('#pdfListSidebar');
    const pdfSidebarEmpty = $('#pdfSidebarEmpty');
    const pdfCount        = $('#pdfCount');
    const scrollBottomBtn = $('#scrollBottomBtn');

    // Notifications
    const notifBtn         = $('#notifBtn');
    const notificationPanel= $('#notificationPanel');
    const closeNotifBtn    = $('#closeNotifBtn');

    // Search
    const searchBtn     = $('#searchBtn');
    const searchOverlay = $('#searchOverlay');
    const searchInput   = $('#searchInput');

    // Settings
    const settingsModal      = $('#settingsModal');
    const closeSettingsBtn   = $('#closeSettingsBtn');
    const settingsCancelBtn  = $('#settingsCancelBtn');
    const settingsSaveBtn    = $('#settingsSaveBtn');

    // Confirm dialog
    const confirmDialog    = $('#confirmDialog');
    const confirmCancelBtn = $('#confirmCancelBtn');
    const confirmOkBtn     = $('#confirmOkBtn');

    let uploadedPdfs = [];
    let lastQuestion = '';
    let droppedFile  = null;
    let confirmCallback = null;

    // ══════════════════════════════════════════════════════
    // LOAD PDFS FROM SERVER
    // ══════════════════════════════════════════════════════
    async function loadPdfsFromServer() {
      try {
        const token = await getToken();
        if (!token) return;
        const res  = await fetch('/api/pdfs', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        uploadedPdfs = (data.pdfs || []).map(p => p.filename);
        renderPdfList();
      } catch (_) {}
    }
    loadPdfsFromServer();

    // ══════════════════════════════════════════════════════
    // TOAST SYSTEM
    // ══════════════════════════════════════════════════════
    function toast(msg, type = 'info', duration = 3000) {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      const icons = { success: '✓', error: '✕', info: 'i' };
      el.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span><span>${msg}</span>`;
      toastStack.appendChild(el);
      setTimeout(() => {
        el.classList.add('out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
      }, duration);
    }

    // ══════════════════════════════════════════════════════
    // SIDEBAR
    // ══════════════════════════════════════════════════════
    sidebarToggle?.addEventListener('click', () => {
      const open = sidebar.classList.toggle('open');
      backdrop.classList.toggle('visible', open);
      sidebarToggle.setAttribute('aria-expanded', open);
    });
    backdrop?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('visible');
    });

    // ══════════════════════════════════════════════════════
    // NAV PANELS
    // ══════════════════════════════════════════════════════
    $$('.nav-item[data-nav]').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const nav = item.dataset.nav;
        $$('.nav-item').forEach(n => { n.classList.remove('active'); n.removeAttribute('aria-current'); });
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
        $('#docsPanel').hidden     = nav !== 'docs';
        $('#settingsPanel').hidden = nav !== 'settings';

        // Open settings modal from nav
        if (nav === 'settings') {
          settingsModal.hidden = false;
        }
      });
    });

    // ══════════════════════════════════════════════════════
    // UPLOAD PANEL
    // ══════════════════════════════════════════════════════
    uploadToggleBtn?.addEventListener('click', () => {
      const hidden = uploadPanel.hasAttribute('hidden');
      hidden ? uploadPanel.removeAttribute('hidden') : uploadPanel.setAttribute('hidden', '');
    });
    closePanelBtn?.addEventListener('click', () => uploadPanel.setAttribute('hidden', ''));
    uploadPanel?.addEventListener('click', e => {
      if (e.target === uploadPanel) uploadPanel.setAttribute('hidden', '');
    });

    // ══════════════════════════════════════════════════════
    // NOTIFICATION PANEL
    // ══════════════════════════════════════════════════════
    notifBtn?.addEventListener('click', () => {
      notificationPanel.classList.toggle('open');
    });
    closeNotifBtn?.addEventListener('click', () => {
      notificationPanel.classList.remove('open');
    });

    // ══════════════════════════════════════════════════════
    // SEARCH OVERLAY
    // ══════════════════════════════════════════════════════
    searchBtn?.addEventListener('click', () => {
      searchOverlay.hidden = false;
      setTimeout(() => searchInput.focus(), 50);
    });
    searchOverlay?.addEventListener('click', e => {
      if (e.target === searchOverlay) searchOverlay.hidden = true;
    });
    document.addEventListener('keydown', e => {
      // Cmd/Ctrl + K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchOverlay.hidden = false;
        setTimeout(() => searchInput.focus(), 50);
      }
      // Escape to close overlays
      if (e.key === 'Escape') {
        if (!searchOverlay.hidden) { searchOverlay.hidden = true; return; }
        if (!settingsModal.hidden) { settingsModal.hidden = true; return; }
        if (notificationPanel.classList.contains('open')) { notificationPanel.classList.remove('open'); return; }
        if (!uploadPanel.hasAttribute('hidden')) { uploadPanel.setAttribute('hidden', ''); return; }
        if (!confirmDialog.hasAttribute('hidden')) { confirmDialog.setAttribute('hidden', ''); return; }
      }
    });

    // ══════════════════════════════════════════════════════
    // SETTINGS MODAL
    // ══════════════════════════════════════════════════════
    closeSettingsBtn?.addEventListener('click', () => { settingsModal.hidden = true; });
    settingsCancelBtn?.addEventListener('click', () => { settingsModal.hidden = true; });
    settingsSaveBtn?.addEventListener('click', () => {
      settingsModal.hidden = true;
      toast('Settings saved', 'success');
    });
    settingsModal?.addEventListener('click', e => {
      if (e.target === settingsModal) settingsModal.hidden = true;
    });

    // Toggle switches
    $$('.toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        const isActive = toggle.classList.contains('active');
        toggle.setAttribute('aria-checked', isActive);
      });
      toggle.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    });

    // ══════════════════════════════════════════════════════
    // CONFIRM DIALOG
    // ══════════════════════════════════════════════════════
    function showConfirm(title, text, onConfirm, type = 'warning') {
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      const icon = $('#confirmIcon');
      icon.className = `confirm-dialog-icon ${type}`;
      confirmCallback = onConfirm;
      confirmDialog.hidden = false;
    }
    confirmCancelBtn?.addEventListener('click', () => { confirmDialog.hidden = true; });
    confirmOkBtn?.addEventListener('click', () => {
      confirmDialog.hidden = true;
      if (confirmCallback) confirmCallback();
    });
    confirmDialog?.addEventListener('click', e => {
      if (e.target === confirmDialog) confirmDialog.hidden = true;
    });

    // ══════════════════════════════════════════════════════
    // PDF SIDEBAR LIST
    // ══════════════════════════════════════════════════════
    function renderPdfList() {
      pdfCount.textContent = uploadedPdfs.length;
      $$('.pdf-item', pdfListSidebar).forEach(el => el.remove());
      if (!uploadedPdfs.length) { pdfSidebarEmpty.hidden = false; return; }
      pdfSidebarEmpty.hidden = true;
      uploadedPdfs.forEach(name => {
        const item = document.createElement('div');
        item.className = 'pdf-item';
        item.setAttribute('role', 'listitem');
        item.innerHTML = `
          <span class="pdf-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
          <span class="pdf-item-name" title="${escHtml(name)}">${escHtml(name)}</span>
          <span class="pdf-item-badge">Ready</span>`;
        pdfListSidebar.appendChild(item);
      });

      // Add notification for new upload
      addNotification(`Document "${uploadedPdfs[uploadedPdfs.length - 1]}" is ready for questions`);
    }
    renderPdfList();

    // ══════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════════════
    let notifications = [];
    function addNotification(text) {
      notifications.unshift({ text, time: new Date(), read: false });
      renderNotifications();
    }
    function renderNotifications() {
      const list = $('#notificationList');
      if (!notifications.length) {
        list.innerHTML = `<div class="notification-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span>No notifications yet</span>
        </div>`;
        return;
      }
      list.innerHTML = notifications.map(n => `
        <div class="notification-item">
          <div class="notification-dot ${n.read ? 'read' : ''}"></div>
          <div>
            <div class="notification-text">${escHtml(n.text)}</div>
            <div class="notification-time">${timeAgo(n.time)}</div>
          </div>
        </div>`).join('');

      // Mark as read when panel opens
      list.querySelectorAll('.notification-item').forEach((item, i) => {
        item.addEventListener('click', () => {
          notifications[i].read = true;
          renderNotifications();
        });
      });
    }
    function timeAgo(date) {
      const s = Math.floor((Date.now() - date.getTime()) / 1000);
      if (s < 60) return 'Just now';
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
      return `${Math.floor(s / 86400)}d ago`;
    }

    // ══════════════════════════════════════════════════════
    // FILE SELECTION
    // ══════════════════════════════════════════════════════
    function setFile(file) {
      droppedFile = file || null;
      if (!file) {
        fileChip.hidden = true;
        fileChipName.textContent = '';
        dropPrimary.textContent = 'Drop your document here';
        dropZone.classList.remove('has-file');
        return;
      }
      fileChipName.textContent = file.name;
      fileChip.hidden = false;
      dropPrimary.textContent = 'Ready to upload';
      dropZone.classList.add('has-file');
    }

    fileInput?.addEventListener('change', () => setFile(fileInput.files[0] || null));

    // ── Drag & drop ──────────────────────────────────────
    ['dragenter', 'dragover'].forEach(ev =>
      dropZone?.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
    );
    ['dragleave', 'drop'].forEach(ev =>
      dropZone?.addEventListener(ev, e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (ev === 'drop') {
          const f = e.dataTransfer?.files?.[0];
          if (f?.name.toLowerCase().endsWith('.pdf')) {
            setFile(f);
            toast('Document ready — click Upload.', 'success');
          } else {
            toast('Only PDF files are accepted.', 'error');
          }
        }
      })
    );

    // ══════════════════════════════════════════════════════
    // PROGRESS BAR
    // ══════════════════════════════════════════════════════
    let progressTimer = null;
    function startProgress() {
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      progressLabel.textContent = 'Uploading…';
      let p = 0;
      progressTimer = setInterval(() => {
        p = Math.min(88, p + Math.random() * 9);
        progressFill.style.width = `${p}%`;
        if (p > 30) progressLabel.textContent = 'Processing document…';
        if (p > 60) progressLabel.textContent = 'Analyzing content…';
        if (p > 80) progressLabel.textContent = 'Almost done…';
      }, 250);
    }
    function finishProgress(ok) {
      clearInterval(progressTimer);
      progressFill.style.width = '100%';
      progressLabel.textContent = ok ? 'Complete!' : 'Failed.';
      setTimeout(() => { progressWrap.hidden = true; progressFill.style.width = '0%'; }, 1200);
    }

    // ══════════════════════════════════════════════════════
    // UPLOAD
    // ══════════════════════════════════════════════════════
    uploadForm?.addEventListener('submit', async e => {
      e.preventDefault();
      const file = droppedFile || fileInput?.files?.[0];
      if (!file) { toast('Please select a document first.', 'error'); return; }
      if (!file.name.toLowerCase().endsWith('.pdf')) { toast('Only PDF files are accepted.', 'error'); return; }

      const token = await getToken();
      if (!token) return;

      uploadBtn.classList.add('loading');
      uploadBtn.disabled = true;
      startProgress();

      const fd = new FormData();
      fd.append('pdf', file);

      try {
        const res  = await fetch('/upload', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd,
        });
        const data = await res.json();
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        finishProgress(true);
        toast('Document uploaded successfully!', 'success', 3500);
        await loadPdfsFromServer();
        setFile(null);
        fileInput.value = '';
        setTimeout(() => uploadPanel.setAttribute('hidden', ''), 1200);
      } catch (err) {
        finishProgress(false);
        toast(err.message, 'error', 4000);
      } finally {
        uploadBtn.classList.remove('loading');
        uploadBtn.disabled = false;
      }
    });

    // ══════════════════════════════════════════════════════
    // TEXTAREA AUTO-GROW
    // ══════════════════════════════════════════════════════
    chatInput?.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + 'px';
    });
    chatInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit(); }
    });

    // ══════════════════════════════════════════════════════
    // SCROLL TO BOTTOM
    // ══════════════════════════════════════════════════════
    function scrollToBottom() { messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' }); }

    scrollBottomBtn?.addEventListener('click', scrollToBottom);

    messages?.addEventListener('scroll', () => {
      const distFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
      scrollBottomBtn?.classList.toggle('visible', distFromBottom > 200);
    });

    // ══════════════════════════════════════════════════════
    // APPEND MESSAGE (ChatGPT-style layout)
    // ══════════════════════════════════════════════════════
    function appendMessage(role, text) {
      if (welcomeState) welcomeState.style.display = 'none';
      const isUser = role === 'user';
      const row = document.createElement('div');
      row.className = `msg-row ${isUser ? 'msg-user' : 'msg-ai'}`;
      row.setAttribute('role', 'listitem');

      const user     = window.Clerk.user;
      const initials = (user.fullName || user.firstName || 'U').charAt(0).toUpperCase();

      const avatarInner = isUser
        ? (user.imageUrl
            ? `<img src="${user.imageUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="You" />`
            : initials)
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.9"/><path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.6"/><path d="M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.8"/></svg>`;

      const senderName = isUser ? (user.fullName || user.firstName || 'You') : 'RAGdoc AI';
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      const actionsHtml = isUser ? '' : `
        <div class="msg-actions">
          <button class="msg-action-btn copy-msg-btn" type="button" title="Copy response" aria-label="Copy response">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span>Copy</span>
          </button>
          <button class="msg-action-btn regen-msg-btn" type="button" title="Regenerate" aria-label="Regenerate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Regenerate</span>
          </button>
        </div>`;

      row.innerHTML = `
        <div class="msg-avatar ${isUser ? 'msg-avatar--user' : 'msg-avatar--ai'}" aria-hidden="true">${avatarInner}</div>
        <div class="msg-content">
          <div class="msg-sender">${escHtml(senderName)} <span class="msg-sender-time">${timeStr}</span></div>
          <div class="msg-text reveal"></div>
          ${actionsHtml}
        </div>`;

      messages.insertBefore(row, typingRow);
      const textEl = row.querySelector('.msg-text');

      if (isUser) {
        textEl.textContent = text;
      } else {
        renderMarkdown(textEl, text);
        row.querySelector('.copy-msg-btn')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(textEl.textContent.trim());
            toast('Copied to clipboard', 'success', 1600);
          } catch { toast('Clipboard unavailable.', 'error'); }
        });
        row.querySelector('.regen-msg-btn')?.addEventListener('click', () => {
          if (lastQuestion) { chatInput.value = lastQuestion; submitChat(lastQuestion); }
          else toast('No previous question to regenerate.', 'info');
        });
      }
      scrollToBottom();
      return textEl;
    }

    // ══════════════════════════════════════════════════════
    // CHAT SUBMIT
    // ══════════════════════════════════════════════════════
    chatForm?.addEventListener('submit', e => {
      e.preventDefault();
      const q = chatInput.value.trim();
      if (!q) return;
      submitChat(q);
    });

    async function submitChat(q) {
      lastQuestion = q;
      chatInput.value = '';
      chatInput.style.height = 'auto';
      sendBtn.disabled = true;

      const token = await getToken();
      if (!token) return;

      appendMessage('user', q);
      showTyping();

      try {
        const res  = await fetch('/ask', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ question: q }),
        });
        const data = await res.json();
        hideTyping();
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        appendMessage('ai', data.answer);
      } catch (err) {
        hideTyping();
        appendMessage('ai', `Something went wrong. Please try again.`);
        toast(err.message, 'error', 4000);
      } finally {
        sendBtn.disabled = false;
        chatInput.focus();
      }
    }

    // ══════════════════════════════════════════════════════
    // TYPING INDICATOR
    // ══════════════════════════════════════════════════════
    function showTyping() { typingRow.hidden = false; typingRow.removeAttribute('aria-hidden'); scrollToBottom(); }
    function hideTyping()  { typingRow.hidden = true;  typingRow.setAttribute('aria-hidden', 'true'); }

    // ══════════════════════════════════════════════════════
    // NEW CHAT
    // ══════════════════════════════════════════════════════
    newChatBtn?.addEventListener('click', () => {
      if ($$('.msg-row', messages).length > 0) {
        showConfirm(
          'Start new conversation?',
          'This will clear the current conversation. You can always upload new documents.',
          () => {
            $$('.msg-row', messages).forEach(el => el.remove());
            welcomeState.style.display = '';
            lastQuestion = '';
            chatInput.value = '';
            chatInput.style.height = 'auto';
            toast('New conversation started', 'info');
          }
        );
      }
    });

    // ══════════════════════════════════════════════════════
    // QUICK CHIPS
    // ══════════════════════════════════════════════════════
    $$('.quick-chip[data-prompt]').forEach(btn =>
      btn.addEventListener('click', () => {
        chatInput.value = btn.dataset.prompt;
        chatInput.focus();
        chatInput.dispatchEvent(new Event('input'));
      })
    );

    // ══════════════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════════════
    function escHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ══════════════════════════════════════════════════════
    // MARKDOWN RENDERER
    // ══════════════════════════════════════════════════════
    function renderMarkdown(el, raw) {
      if (!el || raw == null) return;
      const text = String(raw).trim();
      let html = '', lastIdx = 0;
      const codeRe = /```(\w*)\n?([\s\S]*?)```/g;
      let m;
      while ((m = codeRe.exec(text)) !== null) {
        html += inlineMarkdown(text.slice(lastIdx, m.index));
        html += buildCodeBlock(m[1]?.trim() || 'code', m[2] || '');
        lastIdx = m.index + m[0].length;
      }
      html += inlineMarkdown(text.slice(lastIdx));
      el.innerHTML = html;
      $$('.code-copy-btn', el).forEach(btn =>
        btn.addEventListener('click', async () => {
          const code = btn.closest('.code-block')?.querySelector('pre')?.textContent || '';
          try {
            await navigator.clipboard.writeText(code);
            btn.textContent = '✓ Copied';
            setTimeout(() => (btn.textContent = 'Copy'), 1400);
            toast('Code copied!', 'success', 1600);
          } catch { toast('Clipboard unavailable.', 'error'); }
        })
      );
    }

    function buildCodeBlock(lang, code) {
      const hi = syntaxHighlight(escHtml(code.trimEnd()), lang);
      return `<div class="code-block"><div class="code-topbar"><span class="code-lang">${escHtml(lang)}</span><button class="code-copy-btn" type="button">Copy</button></div><pre><code>${hi}</code></pre></div>`;
    }

    function inlineMarkdown(s) {
      if (!s) return '';
      let h = s
        .replace(/^#{6}\s(.+)$/gm, '<h6>$1</h6>').replace(/^#{5}\s(.+)$/gm, '<h5>$1</h5>')
        .replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>').replace(/^###\s(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s(.+)$/gm, '<h2>$1</h2>').replace(/^#\s(.+)$/gm, '<h1>$1</h1>')
        .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/^---$/gm, '<hr/>')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>').replace(/_([^_]+)_/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/^[\*\-]\s(.+)$/gm, '<li>$1</li>')
        .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
      h = h.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, b => `<ul>${b}</ul>`);
      h = h.split('\n').map(line => {
        const t = line.trim();
        if (!t) return '';
        if (/^<(h[1-6]|ul|ol|li|blockquote|hr|pre|div)/.test(t)) return t;
        return `<p>${t}</p>`;
      }).join('\n');
      return h;
    }

    // ══════════════════════════════════════════════════════
    // SYNTAX HIGHLIGHTING
    // ══════════════════════════════════════════════════════
    function syntaxHighlight(esc, lang) {
      if (!lang || ['text', 'txt', 'plain'].includes(lang)) return esc;
      const kw = {
        js:   'const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|try|catch|finally|throw|async|await|import|from|export|default|typeof|instanceof|void|delete|in|of|true|false|null|undefined|this|super|extends|static|yield|do',
        py:   'def|class|return|if|elif|else|for|while|try|except|finally|import|from|as|with|pass|break|continue|raise|yield|lambda|and|or|not|in|is|True|False|None|async|await|global|nonlocal|del|assert|print',
        java: 'public|private|protected|class|interface|extends|implements|new|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|throws|import|package|static|final|abstract|void|int|long|double|float|boolean|char|String|true|false|null|this|super|instanceof',
        go:   'func|package|import|return|if|else|for|range|switch|case|break|continue|var|const|type|struct|interface|map|chan|go|defer|select|make|new|true|false|nil|string|int|int64|float64|bool|error',
        rs:   'fn|let|mut|const|use|mod|pub|struct|enum|impl|trait|match|if|else|for|while|loop|return|break|continue|true|false|Some|None|Ok|Err|String|str|i32|i64|u32|u64|f32|f64|bool|Vec|Box|self|Self',
      };
      let kwSet = kw.js;
      if (['python', 'py'].includes(lang))             kwSet = kw.py;
      else if (['go'].includes(lang))                   kwSet = kw.go;
      else if (['rust', 'rs'].includes(lang))           kwSet = kw.rs;
      else if (['java', 'kotlin', 'kt'].includes(lang)) kwSet = kw.java;
      return esc
        .replace(/(\/\/[^\n]*)/g, '<span class="tok-cmt">$1</span>')
        .replace(/(#[^\n]*)/g, '<span class="tok-cmt">$1</span>')
        .replace(/(&quot;[^&]*&quot;)/g, '<span class="tok-str">$1</span>')
        .replace(/(&#039;[^&]*&#039;)/g, '<span class="tok-str">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>')
        .replace(new RegExp(`\\b(${kwSet})\\b`, 'g'), '<span class="tok-kw">$1</span>')
        .replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="tok-fn">$1</span>');
    }
  } // end initApp

})();
