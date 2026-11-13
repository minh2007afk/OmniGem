/**
 * OmniGem Wide Chat Module
 * Mở rộng toàn bộ PHẦN KẾT QUẢ TRẢ VỀ của AI:
 * - Đoạn văn, tiêu đề, bảng biểu, code
 * - Danh sách số (1, 2, 3), các bước quy trình (①, ②, ③)
 * - Khung chat ở dưới đáy
 * TUYỆT ĐỐI KHÔNG CHẠM VÀO THANH LỊCH SỬ CHAT (SIDEBAR) BÊN TRÁI.
 */
(() => {
  'use strict';

  const OmniGemWideChat = {
    isWide: false,
    buttonId: 'omnigem-wide-toggle-btn',
    enforceInterval: null,
    modifiedElements: new Set(),

    async init() {
      // 1. Load saved state from chrome.storage.local (mặc định BẬT để tiện dụng)
      this.isWide = await OmniGemStorage.get('wideChatEnabled', true);

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
        'model-response, message-content, markdown, model-response ol, model-response ul, model-response li',
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
     * Mở rộng phần kết quả trả về của AI và khung chat.
     * TUYỆT ĐỐI BỎ QUA TOÀN BỘ CÁC PHẦN TỬ THUỘC SIDEBAR / LỊCH SỬ CHAT BÊN TRÁI.
     */
    enforceWideStyles() {
      if (!this.isWide) return;

      const elements = document.querySelectorAll(
        'conversation-container, .conversation-container, infinite-scroller, ms-chat-turn, response-container, model-response, message-content, .presented-response, markdown, model-response ol, model-response ul, model-response li, markdown ol, markdown ul, markdown li, model-response [class*="stepper"], model-response [class*="timeline"], model-response [class*="structured-list"], model-response [class*="step-content"], model-response [class*="step-body"], .bottom-container, input-area, .input-area-container, rich-textarea, [class*="text-input-field"], [class*="input-box"]'
      );

      elements.forEach(el => {
        // BẢO VỆ TUYỆT ĐỐI: Không bao giờ chạm vào thanh lịch sử chat bên trái
        if (el.closest('bard-sidenav, side-nav, [role="navigation"], .side-nav, .bard-sidenav')) {
          return;
        }

        const tag = el.tagName.toLowerCase();
        const cs = window.getComputedStyle(el);

        // Mở rộng max-width nếu bị giới hạn
        if (cs.maxWidth && cs.maxWidth !== 'none' && !cs.maxWidth.includes('100%')) {
          // Bỏ qua các icon / huy hiệu số tròn nhỏ (< 50px) để không méo hình
          if (el.offsetWidth > 50 || tag === 'ol' || tag === 'ul' || tag === 'li') {
            el.style.setProperty('max-width', '100%', 'important');
            this.modifiedElements.add(el);
          }
        }

        // Với thẻ ol, ul trong model-response: mở rộng 100% width và xóa margin auto
        if (tag === 'ol' || tag === 'ul') {
          if (cs.marginLeft === 'auto' || cs.marginRight === 'auto' || cs.width !== '100%') {
            el.style.setProperty('width', '100%', 'important');
            el.style.setProperty('margin-left', '0px', 'important');
            el.style.setProperty('margin-right', '0px', 'important');
            this.modifiedElements.add(el);
          }
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
          el.style.removeProperty('width');
          el.style.removeProperty('margin-left');
          el.style.removeProperty('margin-right');
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
