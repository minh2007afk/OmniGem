/**
 * OmniGem Optimize Prompt Module
 *
 * Architecture (iframe-free, no history pollution):
 *   PARENT tab:
 *     1. Writes { id, prompt } to chrome.storage.local → "omnigem_opt_req"
 *     2. window.open('/app', 'omnigem-opt-popup') → small off-screen popup
 *     3. Listens on chrome.storage.onChanged for "omnigem_opt_res"
 *     4. On result: fills input, shows ×/✓ buttons, closes popup
 *
 *   POPUP (window.name === 'omnigem-opt-popup'):
 *     1. Reads request from storage
 *     2. Tries to enable Gemini's native Temporary Chat (no history)
 *     3. Fills input with meta-prompt, submits
 *     4. Waits for stop-button to appear → disappear (generation done)
 *     5. Captures response text
 *     6. Writes result to storage → "omnigem_opt_res"
 *     7. If NOT using temp-chat: auto-deletes the conversation
 *     8. window.close()
 */
(() => {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const waitUntil = (fn, timeoutMs = 30000, intervalMs = 300) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        if (fn()) { clearInterval(id); resolve(); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error('waitUntil timeout')); }
      }, intervalMs);
    });

  // ═══════════════════════════════════════════════════════════════════
  //  POPUP WORKER ─ runs only inside the opened optimization popup
  // ═══════════════════════════════════════════════════════════════════
  if (window.self === window.top && window.name === 'omnigem-opt-popup') {
    console.log('[OmniGem] Optimize popup worker booting...');

    // ── Helpers inside popup ─────────────────────────────────────────
    const getInput = () =>
      document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][data-placeholder]') ||
      document.querySelector('rich-textarea');

    const hasStopBtn = () =>
      !!document.querySelector(
        'button[aria-label*="Stop"], button[aria-label*="Dừng"], ' +
        '[data-test-id="stop-button"], .stop-button'
      );

    const hasModelResponse = () => !!document.querySelector('model-response');

    const captureLastResponse = () => {
      const all = document.querySelectorAll('model-response');
      if (!all.length) return '';
      const last = all[all.length - 1];
      // Prefer paragraphs inside markdown container
      const paras = last.querySelectorAll('p, .markdown p, message-content p');
      if (paras.length) {
        return Array.from(paras).map(p => (p.innerText || p.textContent || '').trim())
          .filter(Boolean).join('\n').trim();
      }
      return (last.innerText || last.textContent || '').trim();
    };

    // ── Try to enable Gemini native Temporary Chat ───────────────────
    async function tryEnableTempChat() {
      await sleep(1500);
      const els = Array.from(document.querySelectorAll('button, a, [role="menuitem"], mat-slide-toggle'));
      const btn = els.find(el => {
        const txt = (el.textContent || el.getAttribute('aria-label') || el.title || '').toLowerCase();
        return txt.includes('tạm thời') || txt.includes('temporary') || txt.includes('temp chat');
      });
      if (btn) {
        btn.click();
        console.log('[OmniGem Worker] Temporary chat enabled');
        await sleep(400);
        return true;
      }
      return false;
    }

    // ── Auto-delete the current conversation from sidebar ────────────
    async function tryDeleteConversation() {
      try {
        await sleep(800);
        // The active/current conversation item in the sidebar
        const activeSelectors = [
          'conversation-list-item[active]',
          'side-nav-item[aria-selected="true"]',
          '[aria-current="page"]',
          '.active-conversation',
          'nav a.active',
          'nav [class*="active"]'
        ];
        let activeEl = null;
        for (const sel of activeSelectors) {
          activeEl = document.querySelector(sel);
          if (activeEl) break;
        }
        if (!activeEl) {
          // Try finding by URL match
          const href = window.location.pathname;
          activeEl = document.querySelector(`a[href="${href}"], a[href*="${href}"]`);
        }
        if (!activeEl) return;

        // Trigger hover to reveal ⋮ button
        activeEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        activeEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(400);

        // Find options/kebab button
        const optBtn = activeEl.querySelector(
          'button[aria-label*="option" i], button[aria-label*="tùy chọn" i], ' +
          'button[aria-label*="more" i], button[aria-label*="thêm" i], ' +
          'button.mat-mdc-icon-button, button[aria-haspopup]'
        ) || activeEl.closest('li, [role="listitem"]')?.querySelector(
          'button[aria-haspopup], button.mat-mdc-icon-button'
        );

        if (!optBtn) return;
        optBtn.click();
        await sleep(350);

        // Find delete option in menu
        const menuItems = Array.from(document.querySelectorAll(
          '[role="menuitem"], [role="option"], mat-option, button'
        ));
        const delBtn = menuItems.find(el => {
          const txt = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
          return txt.includes('xóa') || txt.includes('delete') || txt.includes('remove');
        });
        if (!delBtn) return;
        delBtn.click();
        await sleep(350);

        // Confirm dialog
        const confirmBtns = Array.from(document.querySelectorAll('button'));
        const confirmBtn = confirmBtns.find(el => {
          const txt = (el.textContent || '').toLowerCase().trim();
          return txt === 'xóa' || txt === 'delete' || txt === 'xác nhận' || txt === 'confirm' || txt === 'ok';
        });
        if (confirmBtn) confirmBtn.click();
        console.log('[OmniGem Worker] Conversation deleted');
      } catch (e) {
        console.warn('[OmniGem Worker] Delete conversation failed (non-fatal):', e);
      }
    }

    // ── Main worker flow ─────────────────────────────────────────────
    async function runWorker() {
      let req = null;
      try {
        // 1. Read request from storage
        req = await new Promise(resolve =>
          chrome.storage.local.get('omnigem_opt_req', r => resolve(r.omnigem_opt_req))
        );
        if (!req || req.status !== 'pending') {
          console.warn('[OmniGem Worker] No pending request found, closing');
          window.close();
          return;
        }
        console.log('[OmniGem Worker] Got request id=', req.id);

        // 2. Try temporary chat (avoid history)
        const usedTempChat = await tryEnableTempChat();

        // 3. Wait for Gemini input to be ready
        await waitUntil(() => !!getInput(), 20000, 250);
        await sleep(500);

        const input = getInput();
        if (!input) throw new Error('Gemini input not found in popup');

        // 4. Fill input with meta-prompt
        input.focus();
        // Clear existing content
        input.innerHTML = '';
        // Use execCommand for Quill/contenteditable compatibility
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, req.prompt);
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);

        // 5. Submit via Enter key
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true
        }));

        // Fallback: click Send button
        await sleep(120);
        const sendBtn = document.querySelector(
          'button[aria-label*="Send"], button[aria-label*="Gửi"], ' +
          '.send-button, [data-test-id="send-button"]'
        );
        if (sendBtn && !sendBtn.disabled) sendBtn.click();

        // 6. Wait for stop button to APPEAR (generation starting — up to 8s)
        await waitUntil(() => hasStopBtn() || hasModelResponse(), 8000, 150);

        // 7. Wait for stop button to DISAPPEAR (generation done — up to 90s)
        // If stop button never appeared, wait for model-response instead
        if (hasStopBtn()) {
          await waitUntil(() => !hasStopBtn(), 90000, 400);
        } else {
          // Fallback: just wait a moment if response already appeared
          await sleep(1500);
        }
        await sleep(400); // DOM settle

        // 8. Capture response
        const optimized = captureLastResponse();
        if (!optimized) throw new Error('Empty response captured');
        console.log('[OmniGem Worker] Got optimized text, length=', optimized.length);

        // 9. Write result to storage
        await new Promise(resolve =>
          chrome.storage.local.set({
            omnigem_opt_res: { id: req.id, status: 'success', optimized }
          }, resolve)
        );

        // 10. Clean up conversation (if not using native temp chat)
        if (!usedTempChat) {
          await tryDeleteConversation();
        }

        await sleep(400);
        window.close();

      } catch (err) {
        console.error('[OmniGem Worker] Error:', err);
        await new Promise(resolve =>
          chrome.storage.local.set({
            omnigem_opt_res: { id: req?.id, status: 'error', error: err.message }
          }, resolve)
        );
        await sleep(300);
        window.close();
      }
    }

    // Boot after Gemini SPA hydrates
    const boot = () => setTimeout(runWorker, 1200);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }

    return; // ← Stop here; parent code below does not run in popup
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PARENT ─ runs in the main Gemini chat tab
  // ═══════════════════════════════════════════════════════════════════
  if (window.self !== window.top) return; // Skip all iframes

  const OmniGemOptimize = {
    _originalPrompt: '',
    _optimizedPrompt: '',
    _state: 'idle',   // 'idle' | 'loading' | 'review'
    _popup: null,
    _storageListener: null,
    _timeoutTimer: null,

    // ── Inject Optimize button + word count into toolbar ─────────────
    injectButton() {
      const toolbar = document.getElementById('omnigem-input-toolbar');
      if (!toolbar) return;
      if (toolbar.querySelector('.omnigem-optimize-wrapper')) return;

      const left = toolbar.querySelector('.omnigem-input-toolbar-left');
      if (!left) return;

      const wrapper = document.createElement('span');
      wrapper.className = 'omnigem-optimize-wrapper';

      wrapper.innerHTML = `
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn"
                title="Tối ưu prompt bằng AI ─ gửi vào cửa sổ ẩn, không lưu lịch sử">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
        <span class="omnigem-word-count" id="omnigem-word-count"></span>
      `;

      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', () => this.runOptimize());

      left.prepend(wrapper);

      // Live word/char count as user types
      this._bindWordCount();
    },

    _bindWordCount() {
      const updateCount = () => {
        const countEl = document.getElementById('omnigem-word-count');
        if (!countEl || this._state !== 'idle') return;
        const input = OmniGemDOM.getChatInput();
        if (!input) return;
        const text = (input.innerText || input.textContent || '').trim();
        if (!text) { countEl.textContent = ''; return; }
        const words = text.split(/\s+/).length;
        countEl.textContent = `${words} words / ${text.length} characters`;
      };

      // Poll — avoids need for direct input event attachment across SPA re-mounts
      setInterval(updateCount, 500);
    },

    // ── Main optimize flow ───────────────────────────────────────────
    async runOptimize() {
      if (this._state !== 'idle') return;

      const input = OmniGemDOM.getChatInput();
      if (!input) return;

      const original = (input.innerText || input.textContent || '').trim();
      if (!original) {
        this._flashButton('rgba(242,139,130,0.8)');
        return;
      }

      this._originalPrompt = original;
      this._state = 'loading';
      this._setLoadingUI(true);

      const metaPrompt =
        `Rewrite the following prompt to be clearer, more specific, and more effective. ` +
        `Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ` +
        `Respond in the same language as the original prompt.\n\n` +
        `Original prompt:\n${original}`;

      try {
        const optimized = await this._optimizeViaPopup(metaPrompt);
        this._optimizedPrompt = optimized;

        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize]', err);
        this._state = 'idle';
        this._setLoadingUI(false);
        this._flashButton('rgba(242,139,130,0.8)');
      } finally {
        this._cleanupPopup();
      }
    },

    // ── Open popup + storage-based communication ─────────────────────
    _optimizeViaPopup(metaPrompt) {
      return new Promise(async (resolve, reject) => {
        this._cleanupPopup();

        const reqId = Date.now().toString();

        // Write request to storage
        await new Promise(r => chrome.storage.local.set({
          omnigem_opt_req: { id: reqId, prompt: metaPrompt, status: 'pending' },
          omnigem_opt_res: null
        }, r));

        // Open minimized off-screen popup
        const basePath = window.location.pathname.match(/^(\/u\/\d+)/)?.[1] || '';
        const url = `${window.location.origin}${basePath}/app`;
        this._popup = window.open(url, 'omnigem-opt-popup',
          'width=900,height=700,left=9999,top=9999,resizable=yes,scrollbars=yes'
        );
        console.log('[OmniGem] Optimize popup opened, waiting for result...');

        const TIMEOUT = 110000; // 110s

        const cleanup = () => {
          if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
          if (this._storageListener) {
            chrome.storage.onChanged.removeListener(this._storageListener);
            this._storageListener = null;
          }
        };

        this._storageListener = (changes, area) => {
          if (area !== 'local') return;
          if (!changes.omnigem_opt_res?.newValue) return;
          const res = changes.omnigem_opt_res.newValue;
          if (!res || res.id !== reqId) return;

          cleanup();
          if (res.status === 'success') resolve(res.optimized);
          else reject(new Error(res.error || 'Worker error'));
        };

        chrome.storage.onChanged.addListener(this._storageListener);

        this._timeoutTimer = setTimeout(() => {
          cleanup();
          reject(new Error('Optimize popup timed out (110s)'));
        }, TIMEOUT);
      });
    },

    _cleanupPopup() {
      if (this._popup && !this._popup.closed) {
        try { this._popup.close(); } catch (_) {}
      }
      this._popup = null;
      if (this._storageListener) {
        chrome.storage.onChanged.removeListener(this._storageListener);
        this._storageListener = null;
      }
      if (this._timeoutTimer) {
        clearTimeout(this._timeoutTimer);
        this._timeoutTimer = null;
      }
    },

    // ── UI helpers ───────────────────────────────────────────────────
    _setLoadingUI(loading) {
      const btn = document.getElementById('omnigem-optimize-btn');
      const countEl = document.getElementById('omnigem-word-count');
      if (!btn) return;
      if (loading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        if (countEl) countEl.textContent = '';
      } else {
        btn.classList.remove('is-loading');
        btn.disabled = false;
      }
    },

    _setReviewUI() {
      const wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML = `
        <div class="omnigem-optimize-actions">
          <button class="omnigem-opt-reject-btn" id="omnigem-opt-reject"
                  title="Khôi phục prompt gốc (×)">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button class="omnigem-opt-accept-btn" id="omnigem-opt-accept"
                  title="Giữ prompt đã tối ưu (✓)">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </button>
        </div>
        <span class="omnigem-word-count" id="omnigem-word-count"></span>
      `;
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', () => this.reject());
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', () => this.accept());
    },

    _restoreOptimizeButton() {
      const wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML = `
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn"
                title="Tối ưu prompt bằng AI ─ gửi vào cửa sổ ẩn, không lưu lịch sử">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
        <span class="omnigem-word-count" id="omnigem-word-count"></span>
      `;
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', () => this.runOptimize());
      this._state = 'idle';
    },

    _flashButton(color) {
      const btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      const orig = btn.style.borderColor;
      btn.style.borderColor = color;
      setTimeout(() => { btn.style.borderColor = orig; }, 800);
    },

    _updateWordCount(text) {
      const countEl = document.getElementById('omnigem-word-count');
      if (!countEl) return;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = `${words} words / ${text.length} characters`;
    },

    // ── Accept / Reject ──────────────────────────────────────────────
    accept() {
      this._restoreOptimizeButton();
    },

    reject() {
      const input = OmniGemDOM.getChatInput();
      if (input) {
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._updateWordCount(this._originalPrompt);
      }
      this._restoreOptimizeButton();
    },

    // ── Init ─────────────────────────────────────────────────────────
    init() {
      const tryInject = () => {
        if (document.getElementById('omnigem-input-toolbar')) this.injectButton();
      };
      tryInject();
      setInterval(() => {
        const toolbar = document.getElementById('omnigem-input-toolbar');
        if (toolbar && !toolbar.querySelector('.omnigem-optimize-wrapper')) this.injectButton();
      }, 1500);
    }
  };

  window.OmniGemOptimize = OmniGemOptimize;
})();
