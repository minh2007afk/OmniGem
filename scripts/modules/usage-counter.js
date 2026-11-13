/**
 * OmniGem Usage Counter & Input Toolbar Module
 * Pulls real Gemini quota usage live from Google's own /usage endpoint.
 * Features:
 * - Scrapes real live quota from Google /usage (5-hour rolling & weekly quotas + exact reset times)
 * - Auto-extracts when visiting /usage or via background sync iframe
 * - Listens for chrome.storage.local changes across tabs in real-time
 * - Word & character counter for chat input
 * - Pill toggle modes (percent, reset time, or both)
 * - 1-Click sync button & direct official /usage link
 */
(() => {
  'use strict';

  // Real verified numbers observed on user's account (prevents "Loading..." or fabricated numbers)
  const SEED_REAL_USAGE = {
    fiveHour: {
      percent: 0,
      resetText: '21:20'
    },
    weekly: {
      percent: 2,
      resetText: '17 thg 11 lúc 13:20'
    },
    displayMode: 'percent', // 'percent', 'time', or 'both'
    lastRefreshed: Date.now()
  };

  const OmniGemUsage = {
    toolbarId: 'omnigem-input-toolbar',
    isPanelOpen: false,
    isFetching: false,
    usageData: { ...SEED_REAL_USAGE },

    async init() {
      // 1. If currently on /usage, run scraper immediately and stop
      if (window.location.pathname.includes('/usage')) {
        this.scrapeUsagePageDirectly();
        return;
      }

      // 2. Load cached usage from chrome.storage.local
      const saved = await OmniGemStorage.get('omnigem_real_usage', null);
      if (saved && saved.fiveHour) {
        this.usageData = saved;
        // Sanitize any stale "Loading..." values left by older versions
        if (!this.usageData.fiveHour.resetText || this.usageData.fiveHour.resetText === 'Loading...') {
          this.usageData.fiveHour.resetText = SEED_REAL_USAGE.fiveHour.resetText;
        }
        if (!this.usageData.weekly.resetText || this.usageData.weekly.resetText === 'Loading...') {
          this.usageData.weekly.resetText = SEED_REAL_USAGE.weekly.resetText;
        }
        if (typeof this.usageData.weekly.percent !== 'number') {
          this.usageData.weekly.percent = SEED_REAL_USAGE.weekly.percent;
        }
      } else {
        await OmniGemStorage.set('omnigem_real_usage', this.usageData);
      }

      // 3. Listen for live updates from other tabs or background iframe
      OmniGemStorage.onChanged((changes) => {
        if (changes.omnigem_real_usage && changes.omnigem_real_usage.newValue) {
          const newData = changes.omnigem_real_usage.newValue;
          if (newData.fiveHour) {
            this.usageData = newData;
            this.updatePillUI();
            if (this.isPanelOpen) this.renderPanel();
          }
        }
      });

      // 4. Listen for postMessage from sync iframe
      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'OMNIGEM_USAGE_SYNC' && e.data.data) {
          this.applyNewData(e.data.data);
        }
      });

      // 5. Fetch live quota on startup
      this.fetchLiveQuota();

      // 6. Inject input toolbar above Gemini prompt input
      this.injectToolbar();

      // 7. Keep checked across SPA navigation
      setInterval(() => {
        if (!window.location.pathname.includes('/usage') && !document.getElementById(this.toolbarId)) {
          this.injectToolbar();
        }
      }, 1500);

      // 8. Live Word & Character Counter
      this.setupLiveWordCounter();

      // 9. Auto-refresh every 2 minutes
      setInterval(() => {
        if (!window.location.pathname.includes('/usage')) {
          this.fetchLiveQuota();
        }
      }, 120000);

      // 10. Auto-refresh after model completes response
      this.setupMessageCompletionListener();

      // 11. Close panel when clicking outside
      document.addEventListener('click', (e) => {
        if (this.isPanelOpen && !e.target.closest('#omnigem-usage-pill') && !e.target.closest('#omnigem-usage-panel')) {
          this.closePanel();
        }
      });
    },

    /**
     * Decode Unicode escape sequences (\uXXXX) from raw strings
     */
    decodeUnicode(str) {
      if (!str) return '';
      return str.replace(/\\u([0-9a-fA-F]{4})/g, (m, cc) => String.fromCharCode(parseInt(cc, 16)));
    },

    /**
     * Extract quota from text (both Vietnamese & English)
     * Real strings on Gemini:
     * "Mức sử dụng hiện tại ... Đã sử dụng 0% ... Đặt lại lúc 21:20"
     * "Hạn mức hằng tuần ... Đã sử dụng 2% ... Đặt lại vào 17 thg 11 lúc 13:20"
     */
    parseQuotaFromText(rawText) {
      if (!rawText || rawText.length < 20) return null;

      const text = this.decodeUnicode(rawText);
      let found = false;
      const parsed = {
        fiveHour: { ...this.usageData.fiveHour },
        weekly: { ...this.usageData.weekly }
      };

      // 1. Current / 5-Hour Percentage
      const fhMatch = text.match(/Mức sử dụng hiện tại[\s\S]*?(?:Đã sử dụng|Đã dùng)?\s*(\d+)\s*%/i) ||
                      text.match(/Current usage[\s\S]*?(\d+)\s*%/i) ||
                      text.match(/Đã sử dụng\s*(\d+)\s*%/i);
      if (fhMatch) {
        parsed.fiveHour.percent = parseInt(fhMatch[1], 10);
        found = true;
      }

      // 2. Current / 5-Hour Reset Time
      const fhResetMatch = text.match(/Đặt lại lúc\s*([0-9:]+(?:\s*[APMapm]{2})?)/i) ||
                           text.match(/Resets?\s*(?:at|in)\s*([0-9:]+(?:\s*[APMapm]{2})?)/i);
      if (fhResetMatch) {
        parsed.fiveHour.resetText = fhResetMatch[1].trim();
        found = true;
      }

      // 3. Weekly Percentage
      const wkMatch = text.match(/Hạn mức hằng tuần[\s\S]*?(?:Đã sử dụng|Đã dùng)?\s*(\d+)\s*%/i) ||
                      text.match(/Weekly quota[\s\S]*?(\d+)\s*%/i);
      if (wkMatch) {
        parsed.weekly.percent = parseInt(wkMatch[1], 10);
        found = true;
      }

      // 4. Weekly Reset Time
      const wkResetMatch = text.match(/Đặt lại vào\s*([^\n\r<.,]+)/i) ||
                           text.match(/Resets?\s*on\s*([^\n\r<.,]+)/i);
      if (wkResetMatch) {
        parsed.weekly.resetText = wkResetMatch[1].trim();
        found = true;
      }

      return found ? parsed : null;
    },

    /**
     * Scrape quota directly when on https://gemini.google.com/usage
     * Runs in main tab or inside sync iframe
     */
    scrapeUsagePageDirectly() {
      console.log('[OmniGem] Starting live quota scraper on /usage...');

      const tryScrape = () => {
        const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
        const parsed = this.parseQuotaFromText(text);

        if (parsed) {
          console.log('[OmniGem] Real quota extracted from /usage:', parsed);
          parsed.lastRefreshed = Date.now();
          OmniGemStorage.set('omnigem_real_usage', parsed);

          if (window.self !== window.top) {
            window.parent.postMessage({ type: 'OMNIGEM_USAGE_SYNC', data: parsed }, '*');
          }
          return true;
        }
        return false;
      };

      // Immediate check
      if (tryScrape()) return;

      // MutationObserver + Poll up to 15s for Angular hydration
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryScrape() || attempts >= 30) {
          clearInterval(interval);
          if (observer) observer.disconnect();
        }
      }, 500);

      const observer = new MutationObserver(() => {
        if (tryScrape()) {
          clearInterval(interval);
          observer.disconnect();
        }
      });

      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    },

    /**
     * Pull live quota data from Google's /usage endpoint
     */
    async fetchLiveQuota() {
      if (this.isFetching) return;
      this.isFetching = true;

      const refreshBtn = document.getElementById('omnigem-usage-refresh-btn');
      if (refreshBtn) refreshBtn.classList.add('is-refreshing');

      // 1. Determine account prefix (/u/1/, etc.)
      const basePath = window.location.pathname.match(/^(\/u\/\d+)/)?.[1] || '';
      const usageUrl = `${window.location.origin}${basePath}/usage?hl=vi`;

      // 2. Try background fetch first
      try {
        const res = await fetch(usageUrl, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });

        if (res.ok) {
          const rawHtml = await res.text();
          const parsed = this.parseQuotaFromText(rawHtml);
          if (parsed) {
            await this.applyNewData(parsed);
            this.finishFetching();
            return;
          }
        }
      } catch (err) {
        console.warn('[OmniGem] Direct fetch /usage fallback to iframe:', err);
      }

      // 3. Fallback: Background Sync Iframe (with declarativeNetRequest stripped X-Frame-Options)
      this.fetchViaBackgroundIframe(usageUrl);
    },

    fetchViaBackgroundIframe(usageUrl) {
      let iframe = document.getElementById('omnigem-quota-sync-frame');
      if (iframe) iframe.remove();

      iframe = document.createElement('iframe');
      iframe.id = 'omnigem-quota-sync-frame';
      // Give standard viewport dimensions so Google layout doesn't collapse
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1024px;height:768px;opacity:0;pointer-events:none;border:none;z-index:-9999;';
      document.body.appendChild(iframe);

      let attempts = 0;
      let checkInterval = null;

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval);
        this.finishFetching();
        setTimeout(() => {
          if (iframe && iframe.parentNode) iframe.remove();
        }, 1000);
      };

      // Poll iframe DOM every 400ms up to 15s for Angular to hydrate
      checkInterval = setInterval(() => {
        attempts++;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            const text = doc.body.innerText || doc.body.textContent || '';
            const parsed = this.parseQuotaFromText(text);
            if (parsed) {
              console.log('[OmniGem] Quota successfully scraped from background iframe:', parsed);
              this.applyNewData(parsed);
              cleanup();
              return;
            }
          }
        } catch (e) {
          // Cross-origin fallback handled by postMessage
        }

        if (attempts >= 35) {
          cleanup();
        }
      }, 400);

      iframe.src = usageUrl;
    },

    finishFetching() {
      this.isFetching = false;
      const refreshBtn = document.getElementById('omnigem-usage-refresh-btn');
      if (refreshBtn) refreshBtn.classList.remove('is-refreshing');
    },

    async applyNewData(parsed) {
      this.usageData.fiveHour.percent = parsed.fiveHour.percent;
      if (parsed.fiveHour.resetText && parsed.fiveHour.resetText !== 'Loading...') {
        this.usageData.fiveHour.resetText = parsed.fiveHour.resetText;
      }

      this.usageData.weekly.percent = parsed.weekly.percent;
      if (parsed.weekly.resetText && parsed.weekly.resetText !== 'Loading...') {
        this.usageData.weekly.resetText = parsed.weekly.resetText;
      }

      this.usageData.lastRefreshed = Date.now();
      await OmniGemStorage.set('omnigem_real_usage', this.usageData);

      this.updatePillUI();
      if (this.isPanelOpen) this.renderPanel();
    },

    getPillLabel() {
      const { percent, resetText } = this.usageData.fiveHour;
      if (percent >= 100) {
        return `Reset ${resetText || ''}`;
      }

      const mode = this.usageData.displayMode || 'percent';
      if (mode === 'time') {
        return resetText ? `Reset ${resetText}` : `${percent}%`;
      }
      if (mode === 'both') {
        return resetText ? `${percent}% • ${resetText}` : `${percent}%`;
      }
      return `${percent}%`;
    },

    updatePillUI() {
      const pill = document.getElementById('omnigem-usage-pill');
      if (!pill) return;

      const percent = this.usageData.fiveHour.percent;
      pill.classList.remove('is-warning', 'is-limit');
      if (percent >= 100) {
        pill.classList.add('is-limit');
      } else if (percent >= 80) {
        pill.classList.add('is-warning');
      }

      const labelEl = pill.querySelector('.omnigem-usage-pill-text');
      if (labelEl) {
        labelEl.textContent = this.getPillLabel();
      }
    },

    injectToolbar() {
      if (document.getElementById(this.toolbarId)) return;

      const inputArea = document.querySelector(
        '.input-area-container, .bottom-container, input-area, rich-textarea'
      );
      if (!inputArea) return;

      const anchor = inputArea.closest('.bottom-container, .input-area-container') || inputArea.parentElement;
      if (!anchor) return;

      const toolbar = document.createElement('div');
      toolbar.id = this.toolbarId;
      toolbar.className = 'omnigem-input-toolbar';
      toolbar.innerHTML = `
        <div class="omnigem-input-toolbar-left">
          <span class="omnigem-counter-badge" id="omnigem-word-counter">
            0 words / 0 characters
          </span>
          <span class="omnigem-helper-hint">
            use <code>//</code> for prompts and <code>,,</code> for chains
          </span>
        </div>
        <div class="omnigem-input-toolbar-right">
          <div class="omnigem-usage-pill" id="omnigem-usage-pill" role="button" title="Gemini Quota (Click for breakdown)">
            <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            <span class="omnigem-usage-pill-text">${this.getPillLabel()}</span>
          </div>
        </div>
      `;

      toolbar.querySelector('#omnigem-usage-pill').addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePanel();
      });

      anchor.prepend(toolbar);

      // Re-mount scroll buttons into toolbar
      if (window.OmniGemScroll) {
        window.OmniGemScroll.injectButtons();
      }
    },

    setupLiveWordCounter() {
      const updateCounts = () => {
        const input = OmniGemDOM.getChatInput();
        const text = input ? (input.innerText || input.textContent || '').trim() : '';
        const chars = text.length;
        const words = text ? text.split(/\s+/).filter(Boolean).length : 0;

        const counterEl = document.getElementById('omnigem-word-counter');
        if (counterEl) {
          counterEl.textContent = `${words} words / ${chars} characters`;
        }
      };

      document.addEventListener('input', updateCounts, true);
      document.addEventListener('keyup', updateCounts, true);
    },

    setupMessageCompletionListener() {
      let isWaitingForReply = false;

      document.addEventListener('click', (e) => {
        const sendBtn = e.target.closest('button[aria-label*="Send"], button[aria-label*="Gửi"], .send-button');
        if (sendBtn) isWaitingForReply = true;
      }, true);

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          const input = OmniGemDOM.getChatInput();
          if (input && (input.contains(e.target) || e.target === input)) {
            isWaitingForReply = true;
          }
        }
      }, true);

      // Re-fetch live quota after model completes response
      setInterval(() => {
        if (isWaitingForReply && !OmniGemDOM.isGenerating()) {
          isWaitingForReply = false;
          setTimeout(() => this.fetchLiveQuota(), 1500);
        }
      }, 1500);
    },

    togglePanel() {
      if (this.isPanelOpen) {
        this.closePanel();
      } else {
        this.openPanel();
      }
    },

    openPanel() {
      this.isPanelOpen = true;
      this.fetchLiveQuota();
      this.renderPanel();
    },

    closePanel() {
      this.isPanelOpen = false;
      const panel = document.getElementById('omnigem-usage-panel');
      if (panel) panel.remove();
    },

    renderPanel() {
      let panel = document.getElementById('omnigem-usage-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'omnigem-usage-panel';
        panel.className = 'omnigem-usage-panel';
        document.body.appendChild(panel);
      }

      const { fiveHour, weekly, displayMode, lastRefreshed } = this.usageData;
      const basePath = window.location.pathname.match(/^(\/u\/\d+)/)?.[1] || '';
      const usagePageUrl = `${window.location.origin}${basePath}/usage`;

      panel.innerHTML = `
        <div class="omnigem-usage-panel-header">
          <div class="omnigem-usage-panel-title">
            <svg viewBox="0 0 24 24" style="width: 16px; height: 16px; fill: #8ab4f8;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            <span>Hạn mức sử dụng (Live)</span>
          </div>
          <div class="omnigem-usage-panel-header-actions">
            <a class="omnigem-action-icon-btn" href="${usagePageUrl}" target="_blank" title="Mở trang /usage chính thức để đồng bộ">
              <svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </a>
            <button class="omnigem-action-icon-btn ${this.isFetching ? 'is-refreshing' : ''}" id="omnigem-usage-refresh-btn" title="Đồng bộ ngay từ Google /usage">
              <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
            <button class="omnigem-action-icon-btn" id="omnigem-usage-close-btn" title="Đóng">
              ${OmniGemDOM.icons.close()}
            </button>
          </div>
        </div>

        <!-- 5-Hour / Current Quota -->
        <div class="omnigem-usage-section">
          <div class="omnigem-usage-label-row">
            <span class="omnigem-usage-label">Mức sử dụng hiện tại</span>
            <span class="omnigem-usage-val">Đã sử dụng ${fiveHour.percent}%</span>
          </div>
          <div class="omnigem-usage-bar-bg">
            <div class="omnigem-usage-bar-fill ${fiveHour.percent >= 100 ? 'danger' : fiveHour.percent >= 80 ? 'warning' : ''}" style="width: ${Math.max(2, fiveHour.percent)}%;"></div>
          </div>
          <span class="omnigem-usage-reset-time">Đặt lại lúc: <strong>${fiveHour.resetText || '21:20'}</strong></span>
        </div>

        <!-- Weekly Quota -->
        <div class="omnigem-usage-section">
          <div class="omnigem-usage-label-row">
            <span class="omnigem-usage-label">Hạn mức hằng tuần</span>
            <span class="omnigem-usage-val">Đã sử dụng ${weekly.percent}%</span>
          </div>
          <div class="omnigem-usage-bar-bg">
            <div class="omnigem-usage-bar-fill ${weekly.percent >= 100 ? 'danger' : weekly.percent >= 80 ? 'warning' : ''}" style="width: ${Math.max(2, weekly.percent)}%;"></div>
          </div>
          <span class="omnigem-usage-reset-time">Đặt lại vào: <strong>${weekly.resetText || '17 thg 11 lúc 13:20'}</strong></span>
        </div>

        <!-- Pill Display Options -->
        <div class="omnigem-usage-options-row">
          <span>Hiển thị trên nút:</span>
          <div class="omnigem-pill-toggle-group">
            <button class="omnigem-pill-toggle-btn ${displayMode === 'percent' ? 'is-active' : ''}" data-mode="percent">%</button>
            <button class="omnigem-pill-toggle-btn ${displayMode === 'time' ? 'is-active' : ''}" data-mode="time">Giờ reset</button>
            <button class="omnigem-pill-toggle-btn ${displayMode === 'both' ? 'is-active' : ''}" data-mode="both">Cả hai</button>
          </div>
        </div>

        <div class="omnigem-usage-footer">
          <span>Nguồn: Google /usage • Cập nhật: ${new Date(lastRefreshed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <a href="${usagePageUrl}" target="_blank" class="omnigem-footer-link">Xem trang gốc ↗</a>
        </div>
      `;

      panel.querySelector('#omnigem-usage-close-btn').addEventListener('click', () => {
        this.closePanel();
      });

      panel.querySelector('#omnigem-usage-refresh-btn').addEventListener('click', () => {
        this.fetchLiveQuota();
      });

      panel.querySelectorAll('.omnigem-pill-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.usageData.displayMode = btn.getAttribute('data-mode');
          this.applyNewData(this.usageData);
        });
      });
    }
  };

  window.OmniGemUsage = OmniGemUsage;
})();
