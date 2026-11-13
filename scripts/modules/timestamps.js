/**
 * OmniGem Message Timestamps Module
 * Detects model responses and injects exact timestamps next to or below response blocks.
 * Stores timestamps in chrome.storage.local per conversation to preserve history.
 */
(() => {
  'use strict';

  const OmniGemTimestamps = {
    enabled: true,
    cache: {},
    checkInterval: null,

    async init() {
      this.enabled = await OmniGemStorage.get('timestampsEnabled', true);
      if (!this.enabled) return;

      const chatId = OmniGemDOM.getChatId();
      await this.loadChatTimestamps(chatId);

      // 1. Process all existing responses immediately
      this.processAllResponses();

      // 2. Set up DOM MutationObserver
      this.setupObserver();

      // 3. Periodic polling fallback for dynamic SPA streaming
      this.checkInterval = setInterval(() => {
        if (this.enabled) {
          this.processAllResponses();
        }
      }, 2000);

      // 4. Handle route changes (conversation switching)
      OmniGemDOM.onRouteChange(async () => {
        const newChatId = OmniGemDOM.getChatId();
        await this.loadChatTimestamps(newChatId);
        this.processAllResponses();
      });

      // 5. Handle settings changes
      OmniGemStorage.onChanged((changes) => {
        if (changes.timestampsEnabled !== undefined) {
          this.enabled = changes.timestampsEnabled.newValue;
          if (this.enabled) {
            this.processAllResponses();
          } else {
            this.removeAllTimestamps();
          }
        }
      });
    },

    async loadChatTimestamps(chatId) {
      const storageKey = `omnigem_timestamps_${chatId}`;
      const saved = await OmniGemStorage.get(storageKey, {});
      this.cache[chatId] = saved || {};
    },

    async saveTimestamp(chatId, messageKey, data) {
      if (!this.cache[chatId]) {
        this.cache[chatId] = {};
      }
      this.cache[chatId][messageKey] = data;
      const storageKey = `omnigem_timestamps_${chatId}`;
      await OmniGemStorage.set(storageKey, this.cache[chatId]);
    },

    formatTime(date) {
      return {
        timeStr: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fullDateStr: date.toLocaleString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      };
    },

    setupObserver() {
      OmniGemDOM.onElementAdded(
        'model-response, .model-response, response-container, ms-chat-turn, response-feedback',
        () => {
          if (!this.enabled) return;
          this.processAllResponses();
        },
        'data-omnigem-timestamp-scanned'
      );
    },

    /**
     * Process all model responses in current view
     */
    processAllResponses() {
      if (!this.enabled) return;

      // Primary: standard Gemini tags
      const candidates = new Set();
      document.querySelectorAll('model-response, .model-response, response-container, ms-chat-turn').forEach(el => {
        candidates.add(el);
      });

      // Secondary (Bulletproof): Find containers containing response feedback buttons (thumbs up / copy)
      const feedbackButtons = document.querySelectorAll(
        'button[aria-label*="Good response"], button[aria-label*="Câu trả lời hay"], button[aria-label*="hài lòng"], button[aria-label*="thích"]'
      );
      feedbackButtons.forEach(btn => {
        const turnContainer = btn.closest('model-response, .model-response, response-container, ms-chat-turn, .chat-turn, [data-message-id]') ||
                              btn.closest('.response-container') ||
                              btn.parentElement?.parentElement;
        if (turnContainer) {
          candidates.add(turnContainer);
        }
      });

      let idx = 0;
      candidates.forEach((el) => {
        this.processResponseElement(el, idx++);
      });
    },

    processResponseElement(responseEl, fallbackIndex = 0) {
      if (!responseEl || responseEl.querySelector('.omnigem-timestamp-badge')) return;

      const chatId = OmniGemDOM.getChatId();
      const messageId = responseEl.getAttribute('data-message-id') ||
                        responseEl.id ||
                        `msg_${fallbackIndex}_${(responseEl.textContent || '').slice(0, 35).trim().replace(/\s+/g, '_')}`;

      let timeData = this.cache[chatId] && this.cache[chatId][messageId];
      if (!timeData) {
        timeData = this.formatTime(new Date());
        this.saveTimestamp(chatId, messageId, timeData);
      }

      this.injectBadge(responseEl, timeData);
    },

    injectBadge(responseEl, timeData) {
      if (responseEl.querySelector('.omnigem-timestamp-badge')) return;

      const badge = document.createElement('span');
      badge.className = 'omnigem-timestamp-badge omnigem-tooltip';
      badge.setAttribute('data-tooltip', `Hoàn thành lúc: ${timeData.fullDateStr}`);
      badge.innerHTML = `
        ${OmniGemDOM.icons.clock()}
        <span>${timeData.timeStr}</span>
      `;

      // Try finding the action buttons toolbar (thumbs up, copy, etc.)
      const slot = responseEl.querySelector(
        'response-feedback, .response-feedback, [class*="feedback"], [class*="action-buttons"], [class*="response-footer"]'
      );

      // Or find via thumbs-up button directly
      const thumbsBtn = responseEl.querySelector(
        'button[aria-label*="Good response"], button[aria-label*="Câu trả lời hay"], button[aria-label*="thích"], button[aria-label*="Sao chép"]'
      );

      const targetBar = slot || (thumbsBtn ? thumbsBtn.parentElement : null);

      if (targetBar) {
        const container = document.createElement('div');
        container.className = 'omnigem-timestamp-container';
        container.appendChild(badge);
        targetBar.prepend(container);
      } else {
        const contentArea = responseEl.querySelector('.message-content') || responseEl;
        contentArea.appendChild(badge);
      }
    },

    removeAllTimestamps() {
      document.querySelectorAll('.omnigem-timestamp-badge, .omnigem-timestamp-container').forEach(el => el.remove());
    }
  };

  window.OmniGemTimestamps = OmniGemTimestamps;
})();
