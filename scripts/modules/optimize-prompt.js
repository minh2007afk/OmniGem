/**
 * OmniGem Optimize Prompt Module
 *
 * Calls Gemini API directly via fetch() — completely silent,
 * no popup, no chat history, no visible trace.
 *
 * API key stored in chrome.storage.local, with hardcoded fallback.
 */
(() => {
  'use strict';

  if (window.self !== window.top) return;

  const API_KEY_STORAGE = 'omnigem_gemini_api_key';
  const API_MODEL       = 'gemini-2.5-flash';
  const API_URL         = 'https://generativelanguage.googleapis.com/v1beta/models/' + API_MODEL + ':generateContent';

  // No hardcoded key — user enters via Settings or modal prompt

  const OmniGemOptimize = {
    _originalPrompt:  '',
    _optimizedPrompt: '',
    _state: 'idle',

    // ── Inject Optimize button + live word count ─────────────────────
    injectButton() {
      var toolbar = document.getElementById('omnigem-input-toolbar');
      if (!toolbar) return;
      if (toolbar.querySelector('.omnigem-optimize-wrapper')) return;

      var left = toolbar.querySelector('.omnigem-input-toolbar-left');
      if (!left) return;

      var wrapper = document.createElement('span');
      wrapper.className = 'omnigem-optimize-wrapper';
      wrapper.innerHTML =
        '<button class="omnigem-optimize-btn" id="omnigem-optimize-btn" ' +
        'title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>' +
        '<span class="omnigem-optimize-label">Optimize</span>' +
        '</button>' +
        '<span class="omnigem-word-count" id="omnigem-word-count"></span>';

      var self = this;
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', function() {
          console.log('[OmniGem Optimize] Button clicked');
          self.runOptimize();
        });
      left.prepend(wrapper);
      this._startWordCountPoller();
    },

    _startWordCountPoller() {
      var self = this;
      setInterval(function() {
        if (self._state !== 'idle') return;
        var countEl = document.getElementById('omnigem-word-count');
        if (!countEl) return;
        var input = OmniGemDOM.getChatInput();
        if (!input) return;
        var text = (input.innerText || input.textContent || '').trim();
        countEl.textContent = text
          ? text.split(/\s+/).length + ' words / ' + text.length + ' characters'
          : '';
      }, 500);
    },

    // ── Get API key (storage only — no fallback) ────────────────────
    async _getApiKey() {
      try {
        var stored = await OmniGemStorage.get(API_KEY_STORAGE, null);
        if (stored && typeof stored === 'string' && stored.length > 10) {
          console.log('[OmniGem Optimize] Using stored API key');
          return stored;
        }
      } catch (e) {
        console.warn('[OmniGem Optimize] Storage read failed:', e);
      }
      return null;
    },

    // ── Core: run optimize ───────────────────────────────────────────
    async runOptimize() {
      console.log('[OmniGem Optimize] runOptimize() called, state=', this._state);

      if (this._state !== 'idle') {
        console.log('[OmniGem Optimize] Not idle, skipping');
        return;
      }

      var input = OmniGemDOM.getChatInput();
      if (!input) {
        console.warn('[OmniGem Optimize] Chat input not found');
        return;
      }

      var original = (input.innerText || input.textContent || '').trim();
      console.log('[OmniGem Optimize] Original prompt length:', original.length);

      if (!original) {
        this._flashButton('rgba(242,139,130,0.8)');
        return;
      }

      this._originalPrompt = original;
      this._state = 'loading';
      this._setLoadingUI(true);

      try {
        var apiKey = await this._getApiKey();
        if (!apiKey) {
          console.log('[OmniGem Optimize] No API key, showing prompt');
          this._state = 'idle';
          this._setLoadingUI(false);
          this._promptForApiKey();
          return;
        }
        console.log('[OmniGem Optimize] Got API key, calling Gemini API...');

        var optimized = await this._callGeminiAPI(apiKey, original);
        console.log('[OmniGem Optimize] Got optimized text, length:', optimized.length);

        this._optimizedPrompt = optimized;

        OmniGemDOM.simulateInput(input, optimized, true);
        this._updateWordCount(optimized);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize] Error:', err);

        var msg = (err.message || '').toLowerCase();
        if (msg.includes('api_key') || msg.includes('401') || msg.includes('403') || msg.includes('invalid')) {
          // Key invalid → show prompt to enter new one
          this._state = 'idle';
          this._setLoadingUI(false);
          this._promptForApiKey('API key không hợp lệ: ' + err.message);
        } else {
          this._state = 'idle';
          this._setLoadingUI(false);
          this._flashButton('rgba(242,139,130,0.8)');
          // Show error as tooltip on button
          var btn = document.getElementById('omnigem-optimize-btn');
          if (btn) btn.title = 'Lỗi: ' + (err.message || 'Unknown error');
        }
      }
    },

    // ── Call Gemini API silently ─────────────────────────────────────
    async _callGeminiAPI(apiKey, originalPrompt) {
      var metaPrompt =
        'Rewrite the following prompt to be clearer, more specific, and more effective. ' +
        'Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ' +
        'Respond in the same language as the original prompt.\n\n' +
        'Original prompt:\n' + originalPrompt;

      console.log('[OmniGem Optimize] Sending to:', API_URL);

      var res = await fetch(API_URL + '?key=' + apiKey, {
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

      console.log('[OmniGem Optimize] Response status:', res.status);

      if (!res.ok) {
        var errBody = await res.text();
        console.error('[OmniGem Optimize] API error body:', errBody.slice(0, 300));
        throw new Error('HTTP ' + res.status + ': ' + errBody.slice(0, 200));
      }

      var data = await res.json();
      console.log('[OmniGem Optimize] API response received');

      var text = '';
      try {
        text = data.candidates[0].content.parts[0].text;
      } catch (e) {
        console.error('[OmniGem Optimize] Cannot parse response:', JSON.stringify(data).slice(0, 300));
        throw new Error('Cannot parse API response');
      }
      if (!text) throw new Error('Empty response from Gemini API');
      return text.trim();
    },

    // ── API key prompt (inline, all inline styles) ───────────────────
    _promptForApiKey(message) {
      var existing = document.getElementById('omnigem-apikey-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'omnigem-apikey-modal';
      overlay.setAttribute('style',
        'position:fixed !important;top:0 !important;left:0 !important;right:0 !important;bottom:0 !important;' +
        'background:rgba(0,0,0,0.6) !important;z-index:2147483647 !important;' +
        'display:flex !important;align-items:center !important;justify-content:center !important;' +
        'font-family:"Google Sans",Roboto,sans-serif !important;');

      var box = document.createElement('div');
      box.setAttribute('style',
        'position:relative !important;background:#1e2029 !important;' +
        'border:1px solid rgba(138,180,248,0.3) !important;border-radius:14px !important;' +
        'padding:24px 28px 20px !important;width:440px !important;max-width:90vw !important;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5) !important;color:#e8eaed !important;');

      var title = document.createElement('div');
      title.setAttribute('style', 'display:flex !important;align-items:center !important;gap:8px !important;font-size:15px !important;font-weight:600 !important;margin-bottom:12px !important;');
      title.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:#8ab4f8;flex-shrink:0">' +
        '<path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>' +
        '</svg><span>Nhập Gemini API Key mới</span>';
      box.appendChild(title);

      var desc = document.createElement('p');
      desc.setAttribute('style', 'font-size:13px !important;color:rgba(255,255,255,0.6) !important;line-height:1.6 !important;margin:0 0 14px !important;');
      desc.innerHTML =
        (message || 'Key hiện tại không hoạt động.') +
        '<br><a href="https://aistudio.google.com/apikey" target="_blank" ' +
        'style="color:#8ab4f8 !important;text-decoration:none !important;">Lấy API key (bắt đầu bằng AIza...) tại đây ↗</a>';
      box.appendChild(desc);

      var row = document.createElement('div');
      row.setAttribute('style', 'display:flex !important;gap:8px !important;');

      var keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.placeholder = 'AIzaSy...';
      keyInput.autocomplete = 'off';
      keyInput.setAttribute('style',
        'flex:1 !important;background:rgba(255,255,255,0.08) !important;' +
        'border:1px solid rgba(138,180,248,0.35) !important;border-radius:8px !important;' +
        'padding:10px 12px !important;color:#e8eaed !important;font-size:13px !important;' +
        'font-family:monospace !important;outline:none !important;');

      var saveBtn = document.createElement('button');
      saveBtn.textContent = 'Lưu';
      saveBtn.setAttribute('style',
        'background:rgba(138,180,248,0.18) !important;' +
        'border:1px solid rgba(138,180,248,0.45) !important;border-radius:8px !important;' +
        'color:#8ab4f8 !important;font-size:13px !important;padding:10px 18px !important;' +
        'cursor:pointer !important;white-space:nowrap !important;');

      row.appendChild(keyInput);
      row.appendChild(saveBtn);
      box.appendChild(row);

      var closeBtn = document.createElement('button');
      closeBtn.textContent = '\u00d7';
      closeBtn.setAttribute('style',
        'position:absolute !important;top:12px !important;right:14px !important;' +
        'background:none !important;border:none !important;color:rgba(255,255,255,0.45) !important;' +
        'font-size:22px !important;cursor:pointer !important;padding:2px 6px !important;line-height:1 !important;');

      box.appendChild(closeBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      setTimeout(function() { keyInput.focus(); }, 100);

      var self = this;
      var doSave = async function() {
        var key = keyInput.value.trim();
        if (!key) return;
        await OmniGemStorage.set(API_KEY_STORAGE, key);
        overlay.remove();
        self.runOptimize();
      };

      saveBtn.addEventListener('click', doSave);
      keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doSave(); });
      closeBtn.addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    },

    // ── UI helpers ───────────────────────────────────────────────────
    _setLoadingUI: function(loading) {
      var btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      if (loading) { btn.classList.add('is-loading'); btn.disabled = true; }
      else { btn.classList.remove('is-loading'); btn.disabled = false; }
    },

    _setReviewUI: function() {
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
      var self = this;
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', function() { self.reject(); });
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', function() { self.accept(); });
      this._updateWordCount(this._optimizedPrompt);
    },

    _restoreOptimizeButton: function() {
      var wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML =
        '<button class="omnigem-optimize-btn" id="omnigem-optimize-btn" ' +
        'title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>' +
        '<span class="omnigem-optimize-label">Optimize</span>' +
        '</button>' +
        '<span class="omnigem-word-count" id="omnigem-word-count"></span>';
      var self = this;
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', function() { self.runOptimize(); });
      this._state = 'idle';
    },

    _flashButton: function(color) {
      var btn = document.getElementById('omnigem-optimize-btn');
      if (!btn) return;
      var orig = btn.style.borderColor;
      btn.style.borderColor = color;
      setTimeout(function() { btn.style.borderColor = orig; }, 800);
    },

    _updateWordCount: function(text) {
      var countEl = document.getElementById('omnigem-word-count');
      if (!countEl || !text) return;
      var words = text.trim() ? text.trim().split(/\s+/).length : 0;
      countEl.textContent = words + ' words / ' + text.length + ' characters';
    },

    accept: function() { this._restoreOptimizeButton(); },

    reject: function() {
      var input = OmniGemDOM.getChatInput();
      if (input) {
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
        this._updateWordCount(this._originalPrompt);
      }
      this._restoreOptimizeButton();
    },

    init: function() {
      var self = this;

      var tryInject = function() {
        if (document.getElementById('omnigem-input-toolbar')) self.injectButton();
      };
      tryInject();
      setInterval(function() {
        var toolbar = document.getElementById('omnigem-input-toolbar');
        if (toolbar && !toolbar.querySelector('.omnigem-optimize-wrapper')) self.injectButton();
      }, 1500);

      console.log('[OmniGem Optimize] Module initialized');
    }
  };

  window.OmniGemOptimize = OmniGemOptimize;
})();
