/**
 * OmniGem Optimize Prompt Module
 *
 * Architecture:
 *   PARENT (chat tab): injects hidden iframe → gemini.google.com/app (new conversation)
 *     → postMessage { OMNIGEM_OPTIMIZE_REQUEST, prompt }
 *   IFRAME (hidden, fresh chat): content script detects iframe mode
 *     → fills input, submits, waits for Gemini response
 *     → postMessage { OMNIGEM_OPTIMIZE_RESULT, optimized }
 *   PARENT: receives optimized text, fills input, removes iframe
 *     → shows × (reject) and ✓ (accept) buttons
 *
 * Chat history of the current conversation is never touched.
 */
(() => {
  'use strict';

  // ════════════════════════════════════════════════════════════════════
  //  IFRAME WORKER — runs inside the hidden optimization iframe
  // ════════════════════════════════════════════════════════════════════
  if (window.self !== window.top && window.name === 'omnigem-optimize-frame') {
    console.log('[OmniGem] Optimize iframe worker started');

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const waitUntil = (fn, timeoutMs = 30000, intervalMs = 300) =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const id = setInterval(() => {
          if (fn()) { clearInterval(id); resolve(); }
          else if (Date.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error('timeout')); }
        }, intervalMs);
      });

    const getInput = () =>
      document.querySelector('rich-textarea .ql-editor[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][data-placeholder]') ||
      document.querySelector('rich-textarea');

    const captureResponse = () => {
      const responses = document.querySelectorAll('model-response');
      if (!responses.length) return '';
      const last = responses[responses.length - 1];
      const paras = last.querySelectorAll('p, .markdown p, message-content p');
      if (paras.length) {
        return Array.from(paras).map(p => p.innerText || p.textContent || '').join('\n').trim();
      }
      return (last.innerText || last.textContent || '').trim();
    };

    const isGenerating = () =>
      !!document.querySelector(
        'model-response.in-progress, .response-in-progress, ' +
        '[aria-label*="stop"], button[aria-label*="Dừng"], ' +
        '.thinking-container:not(.done), .loading-indicator'
      );

    async function handleOptimizeRequest(prompt) {
      try {
        // Wait for Gemini's input to be ready
        await waitUntil(() => !!getInput(), 15000, 200);
        await sleep(800); // Extra hydration time

        const input = getInput();
        if (!input) throw new Error('Input not found in iframe');

        // Inject prompt text
        input.focus();
        // Clear existing content
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        // Type via insertText for Quill compatibility
        document.execCommand('insertText', false, prompt);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(150);

        // Submit via Enter key
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true
        }));

        // Fallback: click Send button
        await sleep(100);
        const sendBtn = document.querySelector(
          'button[aria-label*="Send"], button[aria-label*="Gửi"], ' +
          '.send-button, button.mat-mdc-icon-button[aria-label]'
        );
        if (sendBtn && !sendBtn.disabled) sendBtn.click();

        // Wait for generation to start (up to 5s)
        await waitUntil(() => isGenerating() || !!document.querySelector('model-response'), 5000, 150);

        // Wait for generation to complete (up to 90s)
        await waitUntil(() => !isGenerating(), 90000, 500);

        await sleep(300); // Let DOM settle

        const optimized = captureResponse();
        if (!optimized) throw new Error('Empty response from iframe');

        window.parent.postMessage({ type: 'OMNIGEM_OPTIMIZE_RESULT', optimized }, '*');
        console.log('[OmniGem] Optimize iframe: result sent to parent');

      } catch (err) {
        console.error('[OmniGem] Optimize iframe error:', err);
        window.parent.postMessage({ type: 'OMNIGEM_OPTIMIZE_ERROR', error: err.message }, '*');
      }
    }

    // Listen for requests from parent
    window.addEventListener('message', e => {
      if (e.data && e.data.type === 'OMNIGEM_OPTIMIZE_REQUEST') {
        handleOptimizeRequest(e.data.prompt);
      }
    });

    // Notify parent that iframe is ready
    const notifyReady = () => {
      window.parent.postMessage({ type: 'OMNIGEM_OPTIMIZE_READY' }, '*');
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', notifyReady);
    } else {
      notifyReady();
    }

    return; // Stop here — iframe worker doesn't need the rest
  }

  // ════════════════════════════════════════════════════════════════════
  //  PARENT — runs in the main Gemini tab
  // ════════════════════════════════════════════════════════════════════
  if (window.self !== window.top) return; // Skip non-optimize iframes

  const OmniGemOptimize = {
    _originalPrompt: '',
    _optimizedPrompt: '',
    _state: 'idle', // 'idle' | 'loading' | 'review'
    _iframeEl: null,
    _msgHandler: null,

    // ── Inject the Optimize button into the left side of the toolbar ──
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
                title="Tối ưu prompt bằng AI (gửi vào chat ẩn, không lưu lịch sử)">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
      `;

      wrapper.querySelector('#omnigem-optimize-btn').addEventListener('click', () => this.runOptimize());
      left.prepend(wrapper);
    },

    // ── Main flow ─────────────────────────────────────────────────────
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
        const optimized = await this._optimizeViaIframe(metaPrompt);
        this._optimizedPrompt = optimized;

        // Fill input with optimized text
        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize] Failed:', err);
        this._state = 'idle';
        this._setLoadingUI(false);
        this._flashButton('rgba(242,139,130,0.8)');
      } finally {
        this._destroyIframe();
      }
    },

    // ── Hidden iframe mechanism ───────────────────────────────────────
    _optimizeViaIframe(metaPrompt) {
      return new Promise((resolve, reject) => {
        this._destroyIframe(); // Clean up any stale iframe

        const iframe = document.createElement('iframe');
        iframe.name = 'omnigem-optimize-frame';
        iframe.style.cssText =
          'position:fixed;top:-9999px;left:-9999px;' +
          'width:1024px;height:768px;opacity:0;' +
          'pointer-events:none;border:none;z-index:-9999;';
        document.body.appendChild(iframe);
        this._iframeEl = iframe;

        const TIMEOUT_MS = 100000; // 100s overall timeout
        let timer = null;
        let iframeReady = false;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          window.removeEventListener('message', this._msgHandler);
          this._msgHandler = null;
        };

        this._msgHandler = (e) => {
          if (!e.data) return;

          if (e.data.type === 'OMNIGEM_OPTIMIZE_READY' && !iframeReady) {
            iframeReady = true;
            console.log('[OmniGem] Optimize iframe ready, sending request...');
            // Small delay for Gemini Angular to fully hydrate
            setTimeout(() => {
              iframe.contentWindow.postMessage(
                { type: 'OMNIGEM_OPTIMIZE_REQUEST', prompt: metaPrompt }, '*'
              );
            }, 2500);
          }

          if (e.data.type === 'OMNIGEM_OPTIMIZE_RESULT') {
            cleanup();
            resolve(e.data.optimized);
          }

          if (e.data.type === 'OMNIGEM_OPTIMIZE_ERROR') {
            cleanup();
            reject(new Error(e.data.error));
          }
        };

        window.addEventListener('message', this._msgHandler);

        timer = setTimeout(() => {
          cleanup();
          reject(new Error('Optimize iframe timed out'));
        }, TIMEOUT_MS);

        // Determine account prefix (/u/1/, etc.)
        const basePath = window.location.pathname.match(/^(\/u\/\d+)/)?.[1] || '';
        iframe.src = `${window.location.origin}${basePath}/app`;

        console.log('[OmniGem] Optimize iframe created, loading:', iframe.src);
      });
    },

    _destroyIframe() {
      if (this._iframeEl) {
        this._iframeEl.remove();
        this._iframeEl = null;
      }
      if (this._msgHandler) {
        window.removeEventListener('message', this._msgHandler);
        this._msgHandler = null;
      }
    },

    // ── UI helpers ────────────────────────────────────────────────────
    _setLoadingUI(loading) {
      const btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      if (loading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
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
                  title="Khôi phục prompt gốc">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button class="omnigem-opt-accept-btn" id="omnigem-opt-accept"
                  title="Giữ prompt đã tối ưu">
            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
          </button>
        </div>
      `;
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', () => this.reject());
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', () => this.accept());
    },

    _restoreOptimizeButton() {
      const wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML = `
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn"
                title="Tối ưu prompt bằng AI (gửi vào chat ẩn, không lưu lịch sử)">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
      `;
      wrapper.querySelector('#omnigem-optimize-btn').addEventListener('click', () => this.runOptimize());
      this._state = 'idle';
    },

    _flashButton(color) {
      const btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      btn.style.borderColor = color;
      setTimeout(() => { btn.style.borderColor = ''; }, 800);
    },

    _updateWordCount(text) {
      const countEl = document.getElementById('omnigem-word-count');
      if (!countEl) return;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = `${words} words / ${text.length} characters`;
    },

    // ── Accept / Reject ───────────────────────────────────────────────
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

    // ── Init ──────────────────────────────────────────────────────────
    init() {
      const tryInject = () => {
        if (document.getElementById('omnigem-input-toolbar')) {
          this.injectButton();
        }
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
