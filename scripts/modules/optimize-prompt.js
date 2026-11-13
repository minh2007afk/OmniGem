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

  const API_KEY_STORAGE = 'omnigem_gemini_api_key';
  const API_MODEL       = 'gemini-2.0-flash';
  const API_URL         = 'https://generativelanguage.googleapis.com/v1beta/models/' + API_MODEL + ':generateContent';

  const OmniGemOptimize = {
    _originalPrompt:  '',
    _optimizedPrompt: '',
    _state: 'idle',

    // ── Inject Optimize button + live word count ─────────────────────
    injectButton() {
      const toolbar = document.getElementById('omnigem-input-toolbar');
      if (!toolbar) return;
      if (toolbar.querySelector('.omnigem-optimize-wrapper')) return;

      const left = toolbar.querySelector('.omnigem-input-toolbar-left');
      if (!left) return;

      const wrapper = document.createElement('span');
      wrapper.className = 'omnigem-optimize-wrapper';
      wrapper.innerHTML =
        '<button class="omnigem-optimize-btn" id="omnigem-optimize-btn" ' +
        'title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>' +
        '<span class="omnigem-optimize-label">Optimize</span>' +
        '</button>' +
        '<span class="omnigem-word-count" id="omnigem-word-count"></span>';

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
          ? text.split(/\s+/).length + ' words / ' + text.length + ' characters'
          : '';
      }, 500);
    },

    // ── Core: run optimize ───────────────────────────────────────────
    async runOptimize() {
      try {
        if (this._state !== 'idle') return;

        const input = OmniGemDOM.getChatInput();
        if (!input) {
          console.warn('[OmniGem Optimize] Chat input not found');
          return;
        }

        const original = (input.innerText || input.textContent || '').trim();
        if (!original) {
          this._flashButton('rgba(242,139,130,0.8)');
          return;
        }

        // Check API key
        let apiKey = null;
        try {
          apiKey = await OmniGemStorage.get(API_KEY_STORAGE, null);
        } catch (e) {
          console.warn('[OmniGem Optimize] Storage read error:', e);
        }

        if (!apiKey) {
          console.log('[OmniGem Optimize] No API key found, showing prompt modal');
          this._promptForApiKey();
          return;
        }

        this._originalPrompt = original;
        this._state = 'loading';
        this._setLoadingUI(true);

        const optimized = await this._callGeminiAPI(apiKey, original);
        this._optimizedPrompt = optimized;

        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize] Error:', err);

        // If API key is invalid → clear and re-prompt
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('api_key') || msg.includes('401') || msg.includes('403') || msg.includes('invalid')) {
          try { await OmniGemStorage.set(API_KEY_STORAGE, null); } catch (_) {}
          this._state = 'idle';
          this._setLoadingUI(false);
          this._promptForApiKey('API key không hợp lệ hoặc hết hạn. Vui lòng nhập lại:');
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
        'Rewrite the following prompt to be clearer, more specific, and more effective. ' +
        'Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ' +
        'Respond in the same language as the original prompt.\n\n' +
        'Original prompt:\n' + originalPrompt;

      const res = await fetch(API_URL + '?key=' + apiKey, {
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
        throw new Error('HTTP ' + res.status + ': ' + errBody.slice(0, 200));
      }

      const data = await res.json();
      const text = data && data.candidates && data.candidates[0] &&
                   data.candidates[0].content && data.candidates[0].content.parts &&
                   data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) throw new Error('Empty response from Gemini API');
      return text.trim();
    },

    // ── API key prompt — all inline styles for max reliability ────────
    _promptForApiKey(message) {
      // Remove existing
      var existing = document.getElementById('omnigem-apikey-modal');
      if (existing) existing.remove();

      // Build modal with pure inline styles (immune to Gemini CSS interference)
      var overlay = document.createElement('div');
      overlay.id = 'omnigem-apikey-modal';
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;' +
        'background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);' +
        'z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
        'font-family:"Google Sans",Roboto,sans-serif;';

      var box = document.createElement('div');
      box.style.cssText =
        'position:relative;background:#1e2029;' +
        'border:1px solid rgba(138,180,248,0.3);border-radius:14px;' +
        'padding:24px 28px 20px;width:420px;max-width:90vw;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5);color:#e8eaed;';

      // Title
      var title = document.createElement('div');
      title.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;margin-bottom:12px;';
      title.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#8ab4f8;flex-shrink:0">' +
        '<path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>' +
        '</svg>' +
        '<span>Gemini API Key</span>';
      box.appendChild(title);

      // Description
      var desc = document.createElement('p');
      desc.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6;margin:0 0 14px;';
      desc.innerHTML =
        (message || 'Optimize dùng Gemini API — miễn phí, ẩn hoàn toàn, không lưu lịch sử.') +
        '<br><a href="https://aistudio.google.com/apikey" target="_blank" ' +
        'style="color:#8ab4f8;text-decoration:none;">Lấy API key miễn phí tại đây ↗</a>';
      box.appendChild(desc);

      // Input row
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;';

      var keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.id = 'omnigem-apikey-input';
      keyInput.placeholder = 'Paste API key (AIza...)';
      keyInput.autocomplete = 'off';
      keyInput.spellcheck = false;
      keyInput.style.cssText =
        'flex:1;background:rgba(255,255,255,0.08);' +
        'border:1px solid rgba(138,180,248,0.35);border-radius:8px;' +
        'padding:10px 12px;color:#e8eaed;font-size:13px;font-family:monospace;' +
        'outline:none;';

      var saveBtn = document.createElement('button');
      saveBtn.textContent = 'Lưu';
      saveBtn.style.cssText =
        'background:rgba(138,180,248,0.18);' +
        'border:1px solid rgba(138,180,248,0.45);border-radius:8px;' +
        'color:#8ab4f8;font-size:13px;padding:10px 18px;cursor:pointer;white-space:nowrap;';

      row.appendChild(keyInput);
      row.appendChild(saveBtn);
      box.appendChild(row);

      // Close button
      var closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText =
        'position:absolute;top:12px;right:14px;background:none;border:none;' +
        'color:rgba(255,255,255,0.45);font-size:22px;cursor:pointer;padding:2px 6px;line-height:1;';

      box.appendChild(closeBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      console.log('[OmniGem Optimize] API key modal injected into DOM');

      // Focus input after a tick (Gemini sometimes steals focus)
      setTimeout(function() { keyInput.focus(); }, 100);

      // Save handler
      var self = this;
      var doSave = async function() {
        var key = keyInput.value.trim();
        if (!key) { keyInput.style.borderColor = '#f28b82'; return; }
        await OmniGemStorage.set(API_KEY_STORAGE, key);
        overlay.remove();
        console.log('[OmniGem Optimize] API key saved, re-running optimize...');
        self.runOptimize();
      };

      saveBtn.addEventListener('click', doSave);
      keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSave(); });
      closeBtn.addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    },

    // ── UI helpers ───────────────────────────────────────────────────
    _setLoadingUI(loading) {
      var btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      if (loading) { btn.classList.add('is-loading'); btn.disabled = true; }
      else { btn.classList.remove('is-loading'); btn.disabled = false; }
    },

    _setReviewUI() {
      var wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML =
        '<div class="omnigem-optimize-actions">' +
        '<button class="omnigem-opt-reject-btn" id="omnigem-opt-reject" title="Khôi phục prompt gốc">' +
        '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
        '</button>' +
        '<button class="omnigem-opt-accept-btn" id="omnigem-opt-accept" title="Giữ prompt đã tối ưu">' +
        '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' +
        '</button>' +
        '</div>' +
        '<span class="omnigem-word-count" id="omnigem-word-count"></span>';
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', () => this.reject());
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', () => this.accept());
      this._updateWordCount(this._optimizedPrompt);
    },

    _restoreOptimizeButton() {
      var wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML =
        '<button class="omnigem-optimize-btn" id="omnigem-optimize-btn" ' +
        'title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>' +
        '<span class="omnigem-optimize-label">Optimize</span>' +
        '</button>' +
        '<span class="omnigem-word-count" id="omnigem-word-count"></span>';
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', () => this.runOptimize());
      this._state = 'idle';
    },

    _flashButton(color) {
      var btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      var orig = btn.style.borderColor;
      btn.style.borderColor = color;
      setTimeout(function() { btn.style.borderColor = orig; }, 800);
    },

    _updateWordCount(text) {
      var countEl = document.getElementById('omnigem-word-count');
      if (!countEl || !text) return;
      var words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = words + ' words / ' + text.length + ' characters';
    },

    accept() { this._restoreOptimizeButton(); },

    reject() {
      var input = OmniGemDOM.getChatInput();
      if (input) {
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._updateWordCount(this._originalPrompt);
      }
      this._restoreOptimizeButton();
    },

    init() {
      var self = this;
      var tryInject = function() {
        if (document.getElementById('omnigem-input-toolbar')) self.injectButton();
      };
      tryInject();
      setInterval(function() {
        var toolbar = document.getElementById('omnigem-input-toolbar');
        if (toolbar && !toolbar.querySelector('.omnigem-optimize-wrapper')) self.injectButton();
      }, 1500);
    }
  };

  window.OmniGemOptimize = OmniGemOptimize;
})();
