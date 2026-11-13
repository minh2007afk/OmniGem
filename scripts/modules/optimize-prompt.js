/**
 * OmniGem Optimize Prompt Module
 *
 * Adds a "✨ Optimize" button to the input toolbar.
 * Flow:
 *   1. Read the current prompt from Gemini's input field.
 *   2. Build a meta-prompt asking Gemini to rewrite it.
 *   3. Submit silently, capture the generated output via MutationObserver.
 *   4. Place the optimized text back into the input field.
 *   5. Show × (reject) and ✓ (accept) buttons.
 *   6. On accept: keep optimized text, restore Optimize button.
 *      On reject: restore original text, restore Optimize button.
 */
(() => {
  'use strict';

  const OmniGemOptimize = {
    _originalPrompt: '',
    _optimizedPrompt: '',
    _state: 'idle', // 'idle' | 'loading' | 'review'

    // ── Inject the Optimize button into the left side of the toolbar ──────────
    injectButton() {
      const toolbar = document.getElementById('omnigem-input-toolbar');
      if (!toolbar) return;

      // Avoid double injection
      if (toolbar.querySelector('.omnigem-optimize-wrapper')) return;

      const left = toolbar.querySelector('.omnigem-input-toolbar-left');
      if (!left) return;

      const wrapper = document.createElement('span');
      wrapper.className = 'omnigem-optimize-wrapper';
      wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-right:6px;';

      wrapper.innerHTML = `
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn" title="Tối ưu prompt bằng AI">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
      `;

      wrapper.querySelector('#omnigem-optimize-btn').addEventListener('click', () => {
        this.runOptimize();
      });

      // Insert before the hint text
      left.prepend(wrapper);
    },

    // ── Main optimization flow ────────────────────────────────────────────────
    async runOptimize() {
      if (this._state !== 'idle') return;

      const input = OmniGemDOM.getChatInput();
      if (!input) return;

      const original = (input.innerText || input.textContent || '').trim();
      if (!original) {
        // Flash the button to signal empty input
        const btn = document.getElementById('omnigem-optimize-btn');
        if (btn) {
          btn.style.borderColor = 'rgba(242,139,130,0.8)';
          setTimeout(() => { btn.style.borderColor = ''; }, 800);
        }
        return;
      }

      this._originalPrompt = original;
      this._state = 'loading';
      this._setLoadingUI(true);

      // Build meta-prompt
      const metaPrompt =
        `Rewrite the following prompt to be clearer, more specific, and more effective. ` +
        `Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ` +
        `Respond in the same language as the original prompt.\n\n` +
        `Original prompt:\n${original}`;

      try {
        // 1. Inject meta-prompt into Gemini's input
        OmniGemDOM.simulateInput(input, metaPrompt, true);

        // 2. Wait one tick then submit
        await this._sleep(120);
        this._submitInput();

        // 3. Wait for Gemini to start generating (up to 4s)
        await this._waitUntil(() => OmniGemDOM.isGenerating(), 4000, 100);

        // 4. Wait for Gemini to finish generating (up to 60s)
        await this._waitUntil(() => !OmniGemDOM.isGenerating(), 60000, 500);

        // 5. Capture the last model response
        const optimized = this._captureLastResponse();
        if (!optimized) throw new Error('No response captured');

        this._optimizedPrompt = optimized;

        // 6. Put optimized text back into input
        OmniGemDOM.simulateInput(input, optimized, true);

        // 7. Update word/char count in toolbar if visible
        this._updateWordCount(optimized);

        // 8. Show accept/reject UI
        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize] Error:', err);
        // Restore original on failure
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._state = 'idle';
        this._setLoadingUI(false);
      }
    },

    // ── Submit the current input (simulate Enter / click Send) ────────────────
    _submitInput() {
      // Try keyboard Enter first (most reliable)
      const input = OmniGemDOM.getChatInput();
      if (input) {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true
        });
        input.dispatchEvent(enterEvent);
      }

      // Fallback: click the Send button
      setTimeout(() => {
        const sendBtn = document.querySelector(
          'button[aria-label*="Send"], button[aria-label*="Gửi"], ' +
          'button.send-button, [data-mat-icon-name="send"], ' +
          'button[mattooltip*="Send"], button[mattooltip*="Gửi"]'
        );
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 80);
    },

    // ── Capture the last model response text ─────────────────────────────────
    _captureLastResponse() {
      // Collect all model-response elements, pick the last one
      const responses = document.querySelectorAll('model-response, .model-response-text, .response-container');
      if (!responses.length) return '';

      const last = responses[responses.length - 1];

      // Try the markdown paragraph content first
      const paragraphs = last.querySelectorAll(
        'p, .markdown p, message-content p, .response-text p'
      );
      if (paragraphs.length) {
        return Array.from(paragraphs).map(p => p.innerText || p.textContent || '').join('\n').trim();
      }

      // Fallback: innerText of the whole response
      return (last.innerText || last.textContent || '').trim();
    },

    // ── UI helpers ────────────────────────────────────────────────────────────
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
        <div class="omnigem-optimize-actions" id="omnigem-optimize-actions">
          <button class="omnigem-opt-reject-btn" id="omnigem-opt-reject" title="Hoàn tác — khôi phục prompt gốc">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
          <button class="omnigem-opt-accept-btn" id="omnigem-opt-accept" title="Chấp nhận — giữ prompt đã tối ưu">
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
        <button class="omnigem-optimize-btn" id="omnigem-optimize-btn" title="Tối ưu prompt bằng AI">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>
          <span class="omnigem-optimize-label">Optimize</span>
        </button>
      `;

      wrapper.querySelector('#omnigem-optimize-btn').addEventListener('click', () => this.runOptimize());
      this._state = 'idle';
    },

    _updateWordCount(text) {
      const countEl = document.getElementById('omnigem-word-count');
      if (!countEl) return;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      countEl.textContent = `${words} words / ${chars} characters`;
    },

    // ── Accept / Reject ───────────────────────────────────────────────────────
    accept() {
      // The optimized text is already in the input — just restore the button
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

    // ── Utility helpers ───────────────────────────────────────────────────────
    _sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    _waitUntil(conditionFn, timeoutMs = 30000, intervalMs = 300) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (conditionFn()) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(timer);
            reject(new Error('waitUntil timeout'));
          }
        }, intervalMs);
      });
    },

    // ── Init ──────────────────────────────────────────────────────────────────
    init() {
      // Inject button once toolbar is available
      const tryInject = () => {
        if (document.getElementById('omnigem-input-toolbar')) {
          this.injectButton();
        }
      };

      tryInject();

      // Keep checking — toolbar may re-mount on SPA navigation
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
