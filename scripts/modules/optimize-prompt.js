/**
 * OmniGem Optimize Prompt Module
 *
 * Calls Gemini API directly via fetch() — completely silent,
 * no popup, no chat history, no visible trace.
 *
 * First use: prompts for a free Gemini API key (aistudio.google.com/apikey)
 * Stored in chrome.storage.local — never leaves the device.
 */
(() => {
  'use strict';

  if (window.self !== window.top) return;

  const API_KEY_STORAGE  = 'omnigem_gemini_api_key';
  const API_MODEL        = 'gemini-2.0-flash';
  const API_URL          = `https://generativelanguage.googleapis.com/v1beta/models/${API_MODEL}:generateContent`;

  const OmniGemOptimize = {
    _originalPrompt:  '',
    _optimizedPrompt: '',
    _state: 'idle', // 'idle' | 'loading' | 'review'

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
                title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">
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

    // ── Core: run optimize ───────────────────────────────────────────
    async runOptimize() {
      if (this._state !== 'idle') return;

      const input = OmniGemDOM.getChatInput();
      if (!input) return;

      const original = (input.innerText || input.textContent || '').trim();
      if (!original) { this._flashButton('rgba(242,139,130,0.8)'); return; }

      // Check API key
      const apiKey = await OmniGemStorage.get(API_KEY_STORAGE, null);
      if (!apiKey) {
        this._promptForApiKey();
        return;
      }

      this._originalPrompt = original;
      this._state = 'loading';
      this._setLoadingUI(true);

      try {
        const optimized = await this._callGeminiAPI(apiKey, original);
        this._optimizedPrompt = optimized;

        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize]', err);

        // If API key is invalid, clear it and re-prompt
        if (err.message.includes('API_KEY') || err.message.includes('401') || err.message.includes('403')) {
          await OmniGemStorage.set(API_KEY_STORAGE, null);
          this._state = 'idle';
          this._setLoadingUI(false);
          this._promptForApiKey('API key không hợp lệ. Nhập lại:');
        } else {
          this._state = 'idle';
          this._setLoadingUI(false);
          this._flashButton('rgba(242,139,130,0.8)');
        }
      }
    },

    // ── Call Gemini API silently ─────────────────────────────────────
    async _callGeminiAPI(apiKey, originalPrompt) {
      const metaPrompt =
        `Rewrite the following prompt to be clearer, more specific, and more effective. ` +
        `Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ` +
        `Respond in the same language as the original prompt.\n\n` +
        `Original prompt:\n${originalPrompt}`;

      const res = await fetch(`${API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: metaPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            candidateCount: 1
          }
        })
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini API');
      return text.trim();
    },

    // ── API key prompt (inline, not popup) ───────────────────────────
    _promptForApiKey(message) {
      // Remove any existing prompt
      document.getElementById('omnigem-apikey-modal')?.remove();

      const modal = document.createElement('div');
      modal.id = 'omnigem-apikey-modal';
      modal.className = 'omnigem-apikey-modal';
      modal.innerHTML = `
        <div class="omnigem-apikey-box">
          <div class="omnigem-apikey-title">
            <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#8ab4f8;flex-shrink:0">
              <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
            </svg>
            <span>Gemini API Key</span>
          </div>
          <p class="omnigem-apikey-desc">
            ${message || 'Optimize dùng Gemini API — miễn phí, ẩn hoàn toàn, không lưu lịch sử.'}
            <br>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">
              Lấy API key miễn phí tại đây ↗
            </a>
          </p>
          <div class="omnigem-apikey-row">
            <input type="password" id="omnigem-apikey-input"
                   placeholder="AIza..." autocomplete="off" spellcheck="false"/>
            <button class="omnigem-apikey-save-btn" id="omnigem-apikey-save">Lưu</button>
          </div>
          <button class="omnigem-apikey-close-btn" id="omnigem-apikey-close" title="Đóng">×</button>
        </div>
      `;
      document.body.appendChild(modal);

      const input = modal.querySelector('#omnigem-apikey-input');
      const saveBtn = modal.querySelector('#omnigem-apikey-save');
      const closeBtn = modal.querySelector('#omnigem-apikey-close');

      input.focus();

      const save = async () => {
        const key = input.value.trim();
        if (!key) return;
        await OmniGemStorage.set(API_KEY_STORAGE, key);
        modal.remove();
        // Auto-run optimize now
        this.runOptimize();
      };

      saveBtn.addEventListener('click', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
      closeBtn.addEventListener('click', () => modal.remove());

      // Click outside to close
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.remove();
      });
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
                title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">
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
