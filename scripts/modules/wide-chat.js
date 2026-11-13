/**
 * OmniGem Wide Chat Module
 * Mở rộng KHUNG CHAT (ô soạn thảo/nhập tin nhắn ở dưới) sang toàn màn hình,
 * giữ nguyên khung lịch sử đọc tin nhắn ở giữa dễ đọc và chuẩn mực.
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

      // 5. Listen for storage changes
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
     * Mở rộng riêng khung chat (ô soạn thảo tin nhắn ở dưới).
     * Tuyệt đối không can thiệp vào khung lịch sử tin nhắn ở trên.
     */
    enforceWideStyles() {
      if (!this.isWide) return;

      // 1. Tìm ô soạn thảo rich-textarea và unclamp toàn bộ các thẻ bọc nó lên tới bottom-container
      const inputEl = document.querySelector('rich-textarea');
      if (inputEl) {
        let el = inputEl;
        while (el && el !== document.body) {
          const tag = el.tagName.toLowerCase();
          if (tag.includes('side') || tag === 'header' || tag === 'main' || tag === 'chat-app') {
            break;
          }
          const cs = window.getComputedStyle(el);
          if (cs.maxWidth && cs.maxWidth !== 'none' && !cs.maxWidth.includes('100%')) {
            el.style.setProperty('max-width', '100%', 'important');
            this.modifiedElements.add(el);
          }
          el = el.parentElement;
        }
      }

      // 2. Unclamp các class/thẻ chứa khung chat ở dưới
      const inputContainers = document.querySelectorAll(
        '.bottom-container, input-area, .input-area-container, rich-textarea, [class*="text-input-field"], [class*="input-box"], [class*="text-area-container"]'
      );
      inputContainers.forEach(el => {
        el.style.setProperty('max-width', '100%', 'important');
        el.style.setProperty('width', '100%', 'important');
        this.modifiedElements.add(el);
      });
    },

    /**
     * Khôi phục kích thước khung chat khi tắt chế độ
     */
    clearWideStyles() {
      this.modifiedElements.forEach((el) => {
        if (el && el.style) {
          el.style.removeProperty('max-width');
          el.style.removeProperty('width');
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
        btn.setAttribute('data-tooltip', 'Khung chat rộng: BẬT (↔ Toàn màn hình)');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('is-active');
        btn.setAttribute('data-tooltip', 'Khung chat rộng: TẮT (Click để mở rộng)');
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
