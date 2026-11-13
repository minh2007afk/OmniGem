/**
 * OmniGem Optimize Prompt Module
 *
 * Flow (100% in current tab, no popup/iframe):
 *   1. Read user's prompt from input
 *   2. Inject meta-prompt → submit to Gemini (current chat)
 *   3. Wait for stop-button to appear → disappear (generation done)
 *   4. Capture last model-response text
 *   5. Put optimized text back into input
 *   6. Auto-delete the last user-query + model-response pair from chat
 *   7. Show × (reject) and ✓ (accept) buttons
 */
(() => {
  'use strict';

  if (window.self !== window.top) return; // Skip iframes

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const waitUntil = (fn, timeoutMs = 30000, intervalMs = 300) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        if (fn()) { clearInterval(id); resolve(); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error('waitUntil timeout')); }
      }, intervalMs);
    });

  const OmniGemOptimize = {
    _originalPrompt: '',
    _optimizedPrompt: '',
    _state: 'idle', // 'idle' | 'loading' | 'review'

    // ── Inject Optimize button + live word count ───────────────────
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
                title="Tối ưu prompt bằng AI (tự xóa sau khi xong)">
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

    // ── Core optimize flow (all in current tab) ────────────────────
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
        // 1. Inject meta-prompt and submit
        OmniGemDOM.simulateInput(input, metaPrompt, true);
        await sleep(150);
        this._submit(input);

        // 2. Wait for Gemini to start generating (stop-btn appears, up to 6s)
        await waitUntil(
          () => OmniGemDOM.isGenerating() || !!document.querySelector('model-response'),
          6000, 150
        );

        // 3. Wait for generation to finish (stop-btn disappears, up to 90s)
        if (OmniGemDOM.isGenerating()) {
          await waitUntil(() => !OmniGemDOM.isGenerating(), 90000, 400);
        }
        await sleep(500); // DOM settle

        // 4. Capture last response
        const optimized = this._captureLastResponse();
        if (!optimized) throw new Error('No response text captured');

        this._optimizedPrompt = optimized;

        // 5. Fill input with optimized text
        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        // 6. Auto-delete the last exchange from chat
        await this._deleteLastExchange();

        // 7. Show accept / reject
        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize]', err);
        // Restore original on failure
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._state = 'idle';
        this._setLoadingUI(false);
        this._flashButton('rgba(242,139,130,0.8)');
      }
    },

    // ── Submit the input (Enter key + fallback click) ──────────────
    _submit(input) {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
      setTimeout(() => {
        const sendBtn = OmniGemDOM.getSendButton();
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
      }, 100);
    },

    // ── Capture the last model-response text ──────────────────────
    _captureLastResponse() {
      const all = document.querySelectorAll('model-response');
      if (!all.length) return '';
      const last = all[all.length - 1];

      // Prefer inline paragraphs from markdown renderer
      const paras = last.querySelectorAll('p, .markdown p, message-content p');
      if (paras.length) {
        return Array.from(paras)
          .map(p => (p.innerText || p.textContent || '').trim())
          .filter(Boolean)
          .join('\n')
          .trim();
      }

      return (last.innerText || last.textContent || '').trim();
    },

    // ── Auto-delete last user-query + model-response pair ─────────
    async _deleteLastExchange() {
      try {
        // Find the last user-query element
        const userQueries = document.querySelectorAll('user-query');
        if (!userQueries.length) return;
        const lastQuery = userQueries[userQueries.length - 1];

        // Hover to reveal action buttons
        lastQuery.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        lastQuery.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await sleep(400);

        // Try to find an edit / options button on the user message
        const optCandidates = [
          // Within the query itself
          ...Array.from(lastQuery.querySelectorAll(
            'button[aria-label], mat-icon-button, [role="button"]'
          )),
          // Sibling action bar (Gemini sometimes puts actions outside)
          ...Array.from(lastQuery.closest('turn-container, [class*="turn"]')?.querySelectorAll(
            'button[aria-label]'
          ) || [])
        ];

        // Look for a "more options" / kebab button
        let optBtn = optCandidates.find(el => {
          const lbl = (el.getAttribute('aria-label') || el.title || '').toLowerCase();
          return lbl.includes('option') || lbl.includes('tùy chọn') ||
                 lbl.includes('more') || lbl.includes('thêm') ||
                 lbl.includes('menu');
        });

        // Fallback: any button inside the last turn that's small and icon-shaped
        if (!optBtn) {
          optBtn = lastQuery.querySelector(
            'button.mat-mdc-icon-button, button[mat-icon-button], button[matIconButton]'
          );
        }

        if (optBtn) {
          optBtn.click();
          await sleep(350);

          // Find "Xóa" / "Delete" in the opened menu
          const menuItems = Array.from(document.querySelectorAll(
            '[role="menuitem"], [role="option"], mat-option, .mat-menu-item'
          ));
          const delItem = menuItems.find(el => {
            const txt = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
            return txt.includes('xóa') || txt.includes('delete') || txt.includes('remove');
          });

          if (delItem) {
            delItem.click();
            await sleep(400);

            // Confirm dialog ("Xóa" button in modal)
            const allBtns = Array.from(document.querySelectorAll('button'));
            const confirmBtn = allBtns.find(el => {
              const txt = (el.textContent || '').trim().toLowerCase();
              return txt === 'xóa' || txt === 'delete' ||
                     txt === 'xác nhận' || txt === 'confirm';
            });
            if (confirmBtn) {
              confirmBtn.click();
              await sleep(300);
            }
          } else {
            // Close menu if delete not found
            document.body.click();
          }

        } else {
          // ── Fallback: try the message-level delete via right-click menu ──
          // Some Gemini versions expose delete via context menu or dedicated icon
          console.warn('[OmniGem Optimize] Could not find options button on last query.');
        }

      } catch (e) {
        console.warn('[OmniGem Optimize] deleteLastExchange (non-fatal):', e);
      }
    },

    // ── UI helpers ─────────────────────────────────────────────────
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
          <button class="omnigem-opt-reject-btn" id="omnigem-opt-reject"
                  title="Khôi phục prompt gốc">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button class="omnigem-opt-accept-btn" id="omnigem-opt-accept"
                  title="Giữ prompt đã tối ưu">
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
                title="Tối ưu prompt bằng AI (tự xóa sau khi xong)">
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

    // ── Accept / Reject ────────────────────────────────────────────
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

    // ── Init ───────────────────────────────────────────────────────
    init() {
      const tryInject = () => {
        if (document.getElementById('omnigem-input-toolbar')) this.injectButton();
      };
      tryInject();
      setInterval(() => {
        const toolbar = document.getElementById('omnigem-input-toolbar');
        if (toolbar && !toolbar.querySelector('.omnigem-optimize-wrapper')) {
          this.injectButton();
        }
      }, 1500);
    }
  };

  window.OmniGemOptimize = OmniGemOptimize;
})();
