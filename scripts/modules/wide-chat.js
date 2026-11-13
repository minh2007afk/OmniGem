/**
 * OmniGem Wide Chat Module
 * Expands Gemini's chat interface from narrow centered column to full screen width.
 * Eliminates compounding nested margins and aligns text flush with 24px edge padding.
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

      // 4. Repeated check to ensure button stays mounted and response width stays enforced
      this.enforceInterval = setInterval(() => {
        if (!document.getElementById(this.buttonId)) {
          this.injectToggleButton();
        }
        if (this.isWide) {
          this.enforceWideStyles();
        }
      }, 1000);

      // 5. Hook into MutationObserver for newly streamed responses
      OmniGemDOM.onElementAdded(
        'model-response, .model-response, message-content, markdown, .presented-response',
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
     * Programmatically unclamp ancestor containers, side paddings, and inner response text
     */
    enforceWideStyles() {
      if (!this.isWide) return;

      // A. Walk UP from model-response to unclamp ancestor scroll/layout containers.
      //    Only strip padding/margin from SCROLL WRAPPERS (overflow:auto/scroll),
      //    never from flex/grid containers that hold inline layout primitives.
      const sampleResponse = document.querySelector('model-response, .model-response, response-container');
      if (sampleResponse) {
        let el = sampleResponse.parentElement;
        while (el && el !== document.body && el !== document.documentElement) {
          const tag = el.tagName.toLowerCase();
          // Stop at sidebars, headers, or the root app shell
          if (
            tag.includes('side') ||
            el.classList.contains('side-nav') ||
            tag === 'header' ||
            tag === 'top-nav' ||
            tag === 'chat-app' ||
            tag === 'main' ||
            el.getAttribute('role') === 'banner' ||
            el.classList.contains('top-container') ||
            el.classList.contains('trailing-actions') ||
            el.classList.contains('top-nav-actions')
          ) {
            break;
          }

          const cs = window.getComputedStyle(el);

          // Only unclamp max-width on elements that actually constrain width
          if (cs.maxWidth && cs.maxWidth !== 'none' && !cs.maxWidth.includes('100%')) {
            el.style.setProperty('max-width', '100%', 'important');
            this.modifiedElements.add(el);
          }

          // Only strip auto-centering margins (not padding — padding defines inner spacing)
          if (cs.marginLeft === 'auto') {
            el.style.setProperty('margin-left', '0px', 'important');
            this.modifiedElements.add(el);
          }
          if (cs.marginRight === 'auto') {
            el.style.setProperty('margin-right', '0px', 'important');
            this.modifiedElements.add(el);
          }

          el = el.parentElement;
        }
      }

      // B. Unclamp bottom input bar hierarchy (max-width only)
      const bottomArea = document.querySelector('.bottom-container, input-area, rich-textarea');
      if (bottomArea) {
        let bEl = bottomArea;
        while (bEl && bEl !== document.body) {
          if (bEl.tagName.toLowerCase().includes('side')) break;
          const bcs = window.getComputedStyle(bEl);
          if (bcs.maxWidth && bcs.maxWidth !== 'none' && !bcs.maxWidth.includes('100%')) {
            bEl.style.setProperty('max-width', '100%', 'important');
            this.modifiedElements.add(bEl);
          }
          bEl = bEl.parentElement;
        }
      }

      // C. Ensure per-turn message wrappers have 24px padding and 100% width
      document.querySelectorAll('model-response, user-query, .user-query-container, response-container, ms-chat-turn').forEach(turn => {
        turn.style.setProperty('max-width', '100%', 'important');
        turn.style.setProperty('width', '100%', 'important');
        turn.style.setProperty('box-sizing', 'border-box', 'important');
        turn.style.setProperty('padding-left', '24px', 'important');
        turn.style.setProperty('padding-right', '24px', 'important');
        turn.style.setProperty('margin-left', '0px', 'important');
        turn.style.setProperty('margin-right', '0px', 'important');
        this.modifiedElements.add(turn);
      });

      // D. Unclamp ONLY named text-block elements — never div or * (would break flex children)
      document.querySelectorAll('message-content, .presented-response, markdown, .markdown').forEach(el => {
        el.style.setProperty('max-width', '100%', 'important');
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('box-sizing', 'border-box', 'important');
        this.modifiedElements.add(el);
      });
    },

    /**
     * Clear all inline width & padding overrides when wide chat is disabled
     */
    clearWideStyles() {
      this.modifiedElements.forEach((el) => {
        if (el && el.style) {
          el.style.removeProperty('max-width');
          el.style.removeProperty('width');
          el.style.removeProperty('padding-left');
          el.style.removeProperty('padding-right');
          el.style.removeProperty('margin-left');
          el.style.removeProperty('margin-right');
          el.style.removeProperty('box-sizing');
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
