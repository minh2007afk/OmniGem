/**
 * OmniGem Wide Chat Module
 * Mở rộng toàn bộ PHẦN KẾT QUẢ TRẢ VỀ (model-response, markdown) và KHUNG CHAT
 * sang toàn màn hình, không đụng tới sidebar hay làm vỡ danh sách số/flex items.
 */
(() => {
  'use strict';

  const OmniGemWideChat = {
    isWide: false,
    buttonId: 'omnigem-wide-toggle-btn',
    enforceInterval: null,
    modifiedElements: new Set(),

    async init() {
      // 1. Load saved state from chrome.storage.local
      this.isWide = await OmniGemStorage.get('wideChatEnabled', false);

      // 2. Apply layout class immediately
      this.applyLayout(this.isWide);

      // 3. Inject toggle button into Gemini's top navigation bar
      this.injectToggleButton();

      // 4. Periodically ensure button stays mounted and wide layout stays active
      this.enforceInterval = setInterval(() => {
        if (!document.getElementById(this.buttonId)) {
          this.injectToggleButton();
        }
        if (this.isWide) {
          this.enforceWideStyles();
        }
      }, 1200);

      // 5. Hook into MutationObserver for newly streamed responses
      OmniGemDOM.onElementAdded(
        'model-response, message-content, markdown, .presented-response',
        () => {
          if (this.isWide) {
            this.enforceWideStyles();
          }
        },
        'data-omnigem-wide-enforced'
      );

      // 6. Listen for storage changes
      OmniGemStorage.onChanged((changes) => {
        if (changes.wideChatEnabled !== undefined) {
          this.isWide = changes.wideChatEnabled.newValue;
          this.applyLayout(this.isWide);
          this.updateButtonState();
        }
      });
    },

    applyLayout(enable) {
      if (enable) {
        document.documentElement.classList.add('omnigem-wide-chat-active');
        document.body.classList.add('omnigem-wide-chat-active');
        this.enforceWideStyles();
      } else {
        document.documentElement.classList.remove('omnigem-wide-chat-active');
        document.body.classList.remove('omnigem-wide-chat-active');
        this.clearWideStyles();
      }
    },

    /**
     * Mở rộng phần kết quả trả về và khung chat bằng cách unclamp max-width.
     * TUYỆT ĐỐI KHÔNG set width: 100% để không làm vỡ các flex items con (như số thứ tự ① ② ③).
     */
    enforceWideStyles() {
      if (!this.isWide) return;

      const elements = document.querySelectorAll(
        'conversation-container, .conversation-container, infinite-scroller, ms-chat-turn, .chat-turn, response-container, .response-container, model-response, .model-response, message-content, .message-content, .presented-response, markdown, .markdown, .bottom-container, input-area, .input-area-container, rich-textarea, [class*="text-input-field"], [class*="input-box"]'
      );

      elements.forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.maxWidth && cs.maxWidth !== 'none' && !cs.maxWidth.includes('100%')) {
          el.style.setProperty('max-width', '100%', 'important');
          this.modifiedElements.add(el);
        }
      });
    },

    /**
     * Khôi phục kích thước ban đầu khi tắt chế độ
     */
    clearWideStyles() {
      this.modifiedElements.forEach((el) => {
        if (el && el.style) {
          el.style.removeProperty('max-width');
        }
      });
      this.modifiedElements.clear();
    },

    async toggle() {
      this.isWide = !this.isWide;
      this.applyLayout(this.isWide);
      this.updateButtonState();
      await OmniGemStorage.set('wideChatEnabled', this.isWide);
    },

    updateButtonState() {
      const btn = document.getElementById(this.buttonId);
      if (!btn) return;

      if (this.isWide) {
        btn.classList.add('is-active');
        btn.setAttribute('data-tooltip', 'Wide Chat: BẬT (↔ Toàn màn hình)');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('is-active');
        btn.setAttribute('data-tooltip', 'Wide Chat: TẮT (Click để mở rộng)');
        btn.setAttribute('aria-pressed', 'false');
      }
    },

    injectToggleButton() {
      if (document.getElementById(this.buttonId)) return;

      const btn = document.createElement('button');
      btn.id = this.buttonId;
      btn.className = 'omnigem-btn omnigem-tooltip';
      btn.setAttribute('type', 'button');
      btn.innerHTML = OmniGemDOM.icons.wideToggle();

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });

      // Target top-right menu container or 3-dots button (⋮)
      const moreBtn = document.querySelector(
        'button[aria-label*="More"], button[aria-label*="Thêm"], button[aria-label*="tùy chọn"], button[aria-label*="Options"], [data-test-id="more-menu-button"], button[aria-haspopup="menu"]'
      );

      const headerContainer = document.querySelector(
        'header .trailing-actions, header .top-nav-actions, .top-container, top-nav, div[role="banner"]'
      );

      if (moreBtn && moreBtn.parentElement) {
        moreBtn.parentElement.insertBefore(btn, moreBtn);
      } else if (headerContainer) {
        headerContainer.appendChild(btn);
      } else {
        btn.classList.add('omnigem-floating-anchor');
        document.body.appendChild(btn);
      }

      this.updateButtonState();
    }
  };

  window.OmniGemWideChat = OmniGemWideChat;
})();
