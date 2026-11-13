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
  const API_MODEL       = 'gemini-3.8-flash';
  const API_URL         = 'https://generativelanguage.googleapis.com/v1beta/models/' + API_MODEL + ':generateContent';

  // No hardcoded key — user enters via Settings or modal prompt

  const OmniGemOptimize = {
    _originalPrompt:  '',
    _optimizedPrompt: '',
    _state: 'idle',

    // ── Inject Optimize button ──────────────────────────────────────
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
        '</button>';

      var self = this;
      wrapper.querySelector('#omnigem-optimize-btn')
        .addEventListener('click', function() {
          console.log('[OmniGem Optimize] Button clicked');
          self.runOptimize();
        });
      left.prepend(wrapper);
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
      var startTime = Date.now();

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

        // Natural delay of ~2.5s (between 2 and 3 seconds) for a realistic, thoughtful feel
        var elapsed = Date.now() - startTime;
        var minDelay = 2500;
        if (elapsed < minDelay) {
          await new Promise(function(resolve) { setTimeout(resolve, minDelay - elapsed); });
        }

        this._optimizedPrompt = optimized;

        OmniGemDOM.simulateInput(input, optimized, true);

        this._state = 'review';
        this._setReviewUI();

      } catch (err) {
        console.error('[OmniGem Optimize] Error:', err);

        this._state = 'idle';
        this._setLoadingUI(false);

        var msg = (err.message || '').toLowerCase();
        // Only show API key modal if it's an authentication error
        if (msg.includes('401') || msg.includes('unauthenticated') || msg.includes('api key not valid')) {
          this._promptForApiKey('API key không hợp lệ hoặc đã hết hạn.');
        } else {
          // For 503 high demand or network errors, do NOT ask for API key!
          this._flashButton('rgba(242,139,130,0.9)');
          this._showToast('Máy chủ Google đang quá tải (503). Hãy bấm thử lại sau vài giây!');
        }
      }
    },

    // ── Call Gemini API silently with auto-retry & fallback ─────────
    async _callGeminiAPI(apiKey, originalPrompt) {
      var metaPrompt =
        'Rewrite the following prompt to be clearer, more specific, and more effective. ' +
        'Reply with ONLY the improved prompt text — no explanations, no commentary, no quotes. ' +
        'Respond in the same language as the original prompt.\n\n' +
        'Original prompt:\n' + originalPrompt;

      // Try high-throughput Flash-Lite first (rarely hits 503), then 3.8-Flash, then flash-latest
      var models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
      var lastErr = null;

      for (var m = 0; m < models.length; m++) {
        var model = models[m];
        var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
        var url = endpoint;
        if (apiKey.startsWith('AIza')) {
          url += '?key=' + apiKey;
        }

        console.log('[OmniGem Optimize] Calling model:', model);

        for (var attempt = 1; attempt <= 2; attempt++) {
          try {
            var res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: metaPrompt }] }],
                generationConfig: {
                  temperature: 0.7,
                  maxOutputTokens: 2048,
                  candidateCount: 1
                }
              })
            });

            console.log('[OmniGem Optimize] Model:', model, 'Response status:', res.status);

            if (res.status === 503 && attempt === 1) {
              console.warn('[OmniGem Optimize] 503 Service Unavailable, retrying in 1.5s...');
              await new Promise(function(resolve) { setTimeout(resolve, 1500); });
              continue;
            }

            if (!res.ok) {
              var errBody = await res.text();
              console.error('[OmniGem Optimize] API error body:', errBody.slice(0, 300));
              throw new Error('HTTP ' + res.status + ': ' + errBody.slice(0, 150));
            }

            var data = await res.json();
            var text = '';
            if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
              text = data.candidates[0].content.parts[0].text;
            }
            if (text && text.trim()) {
              console.log('[OmniGem Optimize] Success with model:', model);
              return text.trim();
            }
            throw new Error('Empty response from model ' + model);
          } catch (e) {
            lastErr = e;
            console.warn('[OmniGem Optimize] Error on ' + model + ' (attempt ' + attempt + '):', e.message);
            if (attempt === 1 && e.message.includes('503')) {
              await new Promise(function(resolve) { setTimeout(resolve, 1500); });
            }
          }
        }
      }

      throw lastErr || new Error('Không thể kết nối đến máy chủ Gemini API (503)');
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
        (message || 'Vui lòng nhập API key từ Google AI Studio.') +
        '<br><a href="https://aistudio.google.com/apikey" target="_blank" ' +
        'style="color:#8ab4f8 !important;text-decoration:none !important;">Mở trang API Keys tại Google AI Studio ↗</a>';
      box.appendChild(desc);

      var row = document.createElement('div');
      row.setAttribute('style', 'display:flex !important;gap:8px !important;');

      var keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.placeholder = 'Dán API key vào đây (AQ... hoặc AIza...)';
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
        '</div>';
      var self = this;
      wrapper.querySelector('#omnigem-opt-reject').addEventListener('click', function() { self.reject(); });
      wrapper.querySelector('#omnigem-opt-accept').addEventListener('click', function() { self.accept(); });
    },

    _restoreOptimizeButton: function() {
      var wrapper = document.querySelector('.omnigem-optimize-wrapper');
      if (!wrapper) return;
      wrapper.innerHTML =
        '<button class="omnigem-optimize-btn" id="omnigem-optimize-btn" ' +
        'title="Tối ưu prompt bằng Gemini API (ẩn, không lưu lịch sử)">' +
        '<svg viewBox="0 0 24 24"><path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61z"/></svg>' +
        '<span class="omnigem-optimize-label">Optimize</span>' +
        '</button>';
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

    _showToast: function(msg) {
      var existing = document.getElementById('omnigem-opt-toast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.id = 'omnigem-opt-toast';
      toast.setAttribute('style',
        'position:fixed !important;bottom:84px !important;left:50% !important;transform:translateX(-50%) !important;' +
        'background:#2d3039 !important;color:#f28b82 !important;border:1px solid rgba(242,139,130,0.4) !important;' +
        'border-radius:8px !important;padding:8px 16px !important;font-size:13px !important;' +
        'z-index:2147483647 !important;box-shadow:0 4px 16px rgba(0,0,0,0.4) !important;' +
        'pointer-events:none !important;transition:opacity 0.3s ease !important;');
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 300);
      }, 3500);
    },

    accept: function() { this._restoreOptimizeButton(); },

    reject: function() {
      var input = OmniGemDOM.getChatInput();
      if (input) {
        OmniGemDOM.simulateInput(input, this._originalPrompt, true);
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
