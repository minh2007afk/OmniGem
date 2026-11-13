/**
 * OmniGem Optimize Prompt Module
 *
 * Flow:
 *   PARENT (current tab):
 *     1. window.open() popup SYNCHRONOUSLY (before any await, keeps user-gesture)
 *     2. Write request to chrome.storage.local
 *     3. Listen chrome.storage.onChanged for result
 *     4. On result: fill input, show × / ✓, close popup
 *
 *   POPUP (window.name === 'omnigem-opt-popup'):
 *     1. Read request from storage
 *     2. Switch model to Flash (faster + saves Pro quota)
 *     3. Fill meta-prompt, submit
 *     4. Wait for response to stabilize (content-diff based, not stop-button)
 *     5. Capture response text
 *     6. Write result to storage
 *     7. Auto-delete the new conversation from sidebar
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
  //  POPUP WORKER ─ only runs in the optimization popup window
  // ═══════════════════════════════════════════════════════════════════
  if (window.self === window.top && window.name === 'omnigem-opt-popup') {
    console.log('[OmniGem] Optimize popup worker booted');

    // ── Helpers ───────────────────────────────────────────────────────
    const getInput = () =>
      document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][data-placeholder]') ||
      document.querySelector('rich-textarea');

    const getStopBtn = () =>
      document.querySelector(
        'button[aria-label*="Stop"], button[aria-label*="Dừng"], ' +
        '[data-test-id="stop-button"], .stop-button'
      );

    const hasModelResponse = () => !!document.querySelector('model-response');

    // ── Switch to Flash model ─────────────────────────────────────────
    async function switchToFlash() {
      await sleep(500);
      // The model selector is a button showing current model name
      const modelBtn = Array.from(document.querySelectorAll('button'))
        .find(el => {
          const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
          return (txt === 'pro' || txt === 'flash' || txt === 'ultra' ||
                  txt.includes('gemini') || txt.includes('1.5') || txt.includes('2.0')) &&
                 txt.length < 30;
        });
      if (!modelBtn) {
        console.warn('[OmniGem Worker] Model selector not found, skipping Flash switch');
        return;
      }
      modelBtn.click();
      await sleep(500);

      // Find Flash option in dropdown
      const flashOpt = Array.from(document.querySelectorAll(
        '[role="option"], [role="menuitem"], mat-option, .mat-mdc-menu-item, button'
      )).find(el => {
        const txt = (el.textContent || '').toLowerCase();
        return txt.includes('flash') && !txt.includes('disabled');
      });

      if (flashOpt) {
        flashOpt.click();
        console.log('[OmniGem Worker] Switched to Flash model');
        await sleep(400);
      } else {
        // Close menu if Flash not found
        document.body.click();
        console.warn('[OmniGem Worker] Flash option not found, using default model');
      }
    }

    // ── Fill input reliably ───────────────────────────────────────────
    async function fillInput(input, text) {
      input.focus();
      // Clear
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await sleep(80);
      // Insert
      document.execCommand('insertText', false, text);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
    }

    // ── Submit via Enter + fallback click ─────────────────────────────
    async function submitInput(input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
      await sleep(120);
      const sendBtn = document.querySelector(
        'button[aria-label*="Send"], button[aria-label*="Gửi"], ' +
        '[data-test-id="send-button"], .send-button'
      );
      if (sendBtn && !sendBtn.disabled) sendBtn.click();
    }

    // ── Wait for response to finish via content stability ─────────────
    // More reliable than stop-button which may not appear in all Gemini versions
    async function waitForStableResponse(timeoutMs = 90000) {
      const t0 = Date.now();
      let lastText = '';
      let stableCount = 0;

      // First wait for ANY model-response to appear (up to 8s)
      await waitUntil(() => hasModelResponse() || !!getStopBtn(), 8000, 200)
        .catch(() => {}); // ignore timeout here — will catch in stability loop

      while (Date.now() - t0 < timeoutMs) {
        await sleep(700);
        const all = document.querySelectorAll('model-response');
        if (!all.length) continue;

        const currentText = (all[all.length - 1].innerText || '').trim();
        const stopBtn = getStopBtn();

        if (currentText && currentText === lastText && !stopBtn) {
          stableCount++;
          if (stableCount >= 2) {
            console.log('[OmniGem Worker] Response stable, length=', currentText.length);
            return; // Done
          }
        } else {
          stableCount = 0;
          lastText = currentText;
        }
      }
      throw new Error('Response timed out after ' + (timeoutMs / 1000) + 's');
    }

    // ── Capture last model response ───────────────────────────────────
    function captureLastResponse() {
      const all = document.querySelectorAll('model-response');
      if (!all.length) return '';
      const last = all[all.length - 1];
      const paras = last.querySelectorAll('p, .markdown p, message-content p');
      if (paras.length) {
        return Array.from(paras)
          .map(p => (p.innerText || p.textContent || '').trim())
          .filter(Boolean).join('\n').trim();
      }
      return (last.innerText || last.textContent || '').trim();
    }

    // ── Auto-delete the current conversation from sidebar ─────────────
    async function deleteCurrentConversation() {
      try {
        await sleep(1200);
        // Try multiple selectors for the active sidebar item
        const activeSel = [
          'conversation-list-item[active]',
          'conversation-list-item.active',
          'side-nav-item[aria-selected="true"]',
          '[aria-current="page"]',
          'nav a[aria-current]',
          '.active-conversation',
          'conversation-list-item:first-child'
        ];
        let activeEl = null;
        for (const sel of activeSel) {
          activeEl = document.querySelector(sel);
          if (activeEl) break;
        }
        if (!activeEl) {
          // Fallback: find by current URL path
          const path = window.location.pathname;
          activeEl = document.querySelector(`a[href="${path}"], a[href*="${path.split('/').pop()}"]`);
        }
        if (!activeEl) { console.warn('[OmniGem Worker] Active conv not found for deletion'); return; }

        // Hover to reveal ⋮ button
        activeEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        activeEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(500);

        // Find the kebab / options button
        const container = activeEl.closest('li, [role="listitem"]') || activeEl;
        const optBtn =
          container.querySelector('button[aria-label*="option" i], button[aria-label*="tùy chọn" i], button[aria-label*="more" i], button[aria-label*="thêm" i]') ||
          container.querySelector('button.mat-mdc-icon-button, button[mat-icon-button]') ||
          container.querySelector('button');

        if (!optBtn) { console.warn('[OmniGem Worker] Options button not found'); return; }
        optBtn.click();
        await sleep(400);

        // Click delete / xóa in menu
        const menuItems = Array.from(document.querySelectorAll(
          '[role="menuitem"], [role="option"], mat-option, .mat-mdc-menu-item'
        ));
        const delBtn = menuItems.find(el =>
          /xóa|delete|remove/i.test(el.textContent || el.getAttribute('aria-label') || '')
        );
        if (!delBtn) { document.body.click(); return; }
        delBtn.click();
        await sleep(400);

        // Confirm dialog
        const confirmBtn = Array.from(document.querySelectorAll('button'))
          .find(el => /^(xóa|delete|xác nhận|confirm|ok)$/i.test((el.textContent || '').trim()));
        if (confirmBtn) {
          confirmBtn.click();
          console.log('[OmniGem Worker] Conversation deleted successfully');
        }
      } catch (e) {
        console.warn('[OmniGem Worker] deleteCurrentConversation (non-fatal):', e);
      }
    }

    // ── Main worker flow ──────────────────────────────────────────────
    async function runWorker() {
      let req = null;
      try {
        // 1. Read request
        req = await new Promise(r =>
          chrome.storage.local.get('omnigem_opt_req', d => r(d.omnigem_opt_req))
        );
        if (!req || req.status !== 'pending') {
          console.warn('[OmniGem Worker] No pending request'); window.close(); return;
        }
        console.log('[OmniGem Worker] Processing request id=', req.id);

        // 2. Switch to Flash
        await switchToFlash();

        // 3. Wait for input
        await waitUntil(() => !!getInput(), 20000, 300);
        await sleep(400);

        const input = getInput();
        if (!input) throw new Error('Input not found in popup');

        // 4. Fill & submit
        await fillInput(input, req.prompt);
        await submitInput(input);

        // 5. Wait for stable response
        await waitForStableResponse(90000);

        // 6. Capture
        const optimized = captureLastResponse();
        if (!optimized) throw new Error('Empty response captured');

        // 7. Write result
        await new Promise(r => chrome.storage.local.set({
          omnigem_opt_res: { id: req.id, status: 'success', optimized }
        }, r));
        console.log('[OmniGem Worker] Result written, len=', optimized.length);

        // 8. Delete conversation then close
        await deleteCurrentConversation();
        await sleep(500);
        window.close();

      } catch (err) {
        console.error('[OmniGem Worker] Fatal:', err);
        await new Promise(r => chrome.storage.local.set({
          omnigem_opt_res: { id: req?.id, status: 'error', error: err.message }
        }, r));
        await sleep(300);
        window.close();
      }
    }

    // Boot after minimal hydration wait
    const boot = () => setTimeout(runWorker, 2000);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    return; // ← STOP — parent code below does not run in popup
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PARENT ─ main Gemini chat tab
  // ═══════════════════════════════════════════════════════════════════
  if (window.self !== window.top) return;

  const OmniGemOptimize = {
    _originalPrompt: '',
    _optimizedPrompt: '',
    _state: 'idle',
    _popup: null,
    _storageListener: null,
    _timeoutTimer: null,

    // ── Inject Optimize button + live word count ─────────────────────
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
                title="Tối ưu prompt bằng Gemini Flash (cửa sổ riêng, tự xóa sau)">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
        <span class="omnigem-word-count" id="omnigem-word-count"></span>
      `;
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', () => this.runOptimize());
      left.prepend(wrapper);
      this._startWordCountPoller();
    },

    _startWordCountPoller() {
      setInterval(() => {
        if (this._state !== 'idle') return;
        const countEl = document.getElementById('omnigem-word-count');
        if (!countEl) return;
        const input = OmniGemDOM.getChatInput();
        if (!input) return;
        const text = (input.innerText || input.textContent || '').trim();
        countEl.textContent = text
          ? `${text.split(/\s+/).length} words / ${text.length} characters`
          : '';
      }, 500);
    },

    // ── Core optimize ────────────────────────────────────────────────
    runOptimize() {
      if (this._state !== 'idle') return;

      const input = OmniGemDOM.getChatInput();
      if (!input) return;

      const original = (input.innerText || input.textContent || '').trim();
      if (!original) { this._flashButton('rgba(242,139,130,0.8)'); return; }

      this._originalPrompt = original;

      const metaPrompt =
        `Rewrite the following prompt to be clearer, more specific, and more effective. ` +
        `Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ` +
        `Respond in the same language as the original prompt.\n\n` +
        `Original prompt:\n${original}`;

      // ── Open popup SYNCHRONOUSLY (before any await) ──
      // This keeps the user-gesture context alive so Chrome doesn't block it.
      const basePath = window.location.pathname.match(/^(\/u\/\d+)/)?.[1] || '';
      this._popup = window.open(
        `${window.location.origin}${basePath}/app`,
        'omnigem-opt-popup',
        'width=960,height=700,left=9999,top=9999,resizable=yes,scrollbars=yes'
      );

      this._state = 'loading';
      this._setLoadingUI(true);

      // Now safe to do async work
      this._startOptimize(metaPrompt);
    },

    async _startOptimize(metaPrompt) {
      try {
        const reqId = Date.now().toString();
        await new Promise(r => chrome.storage.local.set({
          omnigem_opt_req: { id: reqId, prompt: metaPrompt, status: 'pending' },
          omnigem_opt_res: null
        }, r));

        const optimized = await this._waitForResult(reqId, 110000);
        this._optimizedPrompt = optimized;

        const input = OmniGemDOM.getChatInput();
        if (input) OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize]', err);
        this._state = 'idle';
        this._setLoadingUI(false);
        this._flashButton('rgba(242,139,130,0.8)');
        this._cleanupPopup();
      }
    },

    _waitForResult(reqId, timeoutMs) {
      return new Promise((resolve, reject) => {
        this._cleanupListeners();

        const cleanup = () => {
          if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
          if (this._storageListener) {
            chrome.storage.onChanged.removeListener(this._storageListener);
            this._storageListener = null;
          }
        };

        this._storageListener = (changes, area) => {
          if (area !== 'local' || !changes.omnigem_opt_res?.newValue) return;
          const res = changes.omnigem_opt_res.newValue;
          if (!res || res.id !== reqId) return;
          cleanup();
          this._cleanupPopup();
          if (res.status === 'success') resolve(res.optimized);
          else reject(new Error(res.error || 'Worker error'));
        };

        chrome.storage.onChanged.addListener(this._storageListener);

        this._timeoutTimer = setTimeout(() => {
          cleanup();
          this._cleanupPopup();
          reject(new Error('Optimize timed out'));
        }, timeoutMs);
      });
    },

    _cleanupListeners() {
      if (this._storageListener) {
        chrome.storage.onChanged.removeListener(this._storageListener);
        this._storageListener = null;
      }
      if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    },

    _cleanupPopup() {
      if (this._popup && !this._popup.closed) {
        try { this._popup.close(); } catch (_) {}
      }
      this._popup = null;
    },

    // ── UI helpers ───────────────────────────────────────────────────
    _setLoadingUI(loading) {
      const btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      if (loading) { btn.classList.add('is-loading'); btn.disabled = true; }
      else { btn.classList.remove('is-loading'); btn.disabled = false; }
    },

    _setReviewUI() {
      const wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML = `
        <div class="omnigem-optimize-actions">
          <button class="omnigem-opt-reject-btn" id="omnigem-opt-reject" title="Khôi phục prompt gốc">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button class="omnigem-opt-accept-btn" id="omnigem-opt-accept" title="Giữ prompt đã tối ưu">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </button>
        </div>
        <span class="omnigem-word-count" id="omnigem-word-count"></span>
      `;
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', () => this.reject());
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', () => this.accept());
      this._updateWordCount(this._optimizedPrompt);
    },

    _restoreOptimizeButton() {
      const wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML = `
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn"
                title="Tối ưu prompt bằng Gemini Flash (cửa sổ riêng, tự xóa sau)">
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
      if (!countEl || !text) return;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = `${words} words / ${text.length} characters`;
    },

    accept() { this._restoreOptimizeButton(); },

    reject() {
      const input = OmniGemDOM.getChatInput();
      if (input) {
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._updateWordCount(this._originalPrompt);
      }
      this._restoreOptimizeButton();
    },

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
