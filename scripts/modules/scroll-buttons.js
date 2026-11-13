/**
 * OmniGem Scroll Buttons Module
 * Provides scroll-to-top and scroll-to-bottom buttons exclusively for the chat conversation.
 * Targets only chat message elements and conversation scrollers (never touches the sidebar).
 * Supports double-click on the down arrow to toggle real-time Auto-Scroll.
 */
(() => {
  'use strict';

  const OmniGemScroll = {
    groupClass: 'omnigem-scroll-buttons-inline',
    isAutoScroll: false,
    autoScrollObserver: null,
    clickTimeout: null,

    init() {
      this.injectButtons();

      setInterval(() => {
        if (!document.querySelector(`.${this.groupClass}`)) {
          this.injectButtons();
        }
      }, 1500);

      // User manual scroll up pauses auto-scroll
      window.addEventListener('wheel', (e) => {
        if (this.isAutoScroll && e.deltaY < -15) {
          this.setAutoScroll(false);
        }
      }, { passive: true });
    },

    /**
     * Locate the conversation scroller by walking UP strictly from chat messages
     * (strictly excluding the sidebar/navigation).
     */
    getChatScrollContainers() {
      const chatScrollers = new Set();

      // 1. Walk up from any visible chat message to find its scrollable parent
      const messageEl = document.querySelector('model-response, user-query, ms-chat-turn, message-content, rich-textarea');
      if (messageEl) {
        let parent = messageEl.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
          if (!parent.closest('bard-sidenav, side-nav, [role="navigation"]')) {
            const style = window.getComputedStyle(parent);
            const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight;
            if (isScrollable) {
              chatScrollers.add(parent);
            }
          }
          parent = parent.parentElement;
        }
      }

      // 2. Also check common Gemini chat scroll elements (explicitly excluding navigation/sidebar)
      const explicit = document.querySelectorAll(
        'infinite-scroller, chat-window .conversation-container, .conversation-container, chat-window .chat-history, mat-sidenav-content, main'
      );
      explicit.forEach(el => {
        if (!el.closest('bard-sidenav, side-nav, [role="navigation"]') && el.scrollHeight > el.clientHeight) {
          chatScrollers.add(el);
        }
      });

      return Array.from(chatScrollers);
    },

    scrollToTop() {
      // 1. Direct element scrollIntoView on the first message turn
      const firstTurn = document.querySelector('user-query, model-response, ms-chat-turn, .chat-turn');
      if (firstTurn) {
        firstTurn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      // 2. Scroll conversation scroller containers
      const scrollers = this.getChatScrollContainers();
      scrollers.forEach(s => s.scrollTo({ top: 0, behavior: 'smooth' }));

      // 3. Fallback window scroll
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    scrollToBottom(smooth = true) {
      const behavior = smooth ? 'smooth' : 'auto';

      // 1. Direct element scrollIntoView on the latest message or bottom input
      const turns = document.querySelectorAll('model-response, user-query, ms-chat-turn');
      const latestTurn = turns.length > 0 ? turns[turns.length - 1] : document.querySelector('rich-textarea, .bottom-container');
      if (latestTurn) {
        latestTurn.scrollIntoView({ behavior, block: 'end' });
      }

      // 2. Scroll conversation scroller containers
      const scrollers = this.getChatScrollContainers();
      scrollers.forEach(s => s.scrollTo({ top: s.scrollHeight, behavior }));

      // 3. Fallback window scroll
      window.scrollTo({ top: document.body.scrollHeight, behavior });
    },

    toggleAutoScroll() {
      this.setAutoScroll(!this.isAutoScroll);
    },

    setAutoScroll(enable) {
      this.isAutoScroll = enable;
      const downBtn = document.getElementById('omnigem-scroll-down-btn');
      if (downBtn) {
        if (this.isAutoScroll) {
          downBtn.classList.add('is-autoscroll-active');
          downBtn.setAttribute('data-tooltip', 'Auto-Scroll: BẬT (Nhấn đúp để tắt)');
          this.scrollToBottom(true);
          this.startAutoScrollObserver();
        } else {
          downBtn.classList.remove('is-autoscroll-active');
          downBtn.setAttribute('data-tooltip', 'Cuộn xuống cuối (Nhấn đúp: Auto-scroll)');
          this.stopAutoScrollObserver();
        }
      }
    },

    startAutoScrollObserver() {
      this.stopAutoScrollObserver();
      this.autoScrollObserver = new MutationObserver(() => {
        if (this.isAutoScroll) {
          this.scrollToBottom(false);
        }
      });

      const observeTarget = document.querySelector('chat-window, main, infinite-scroller, .conversation-container') || document.body;
      this.autoScrollObserver.observe(observeTarget, {
        childList: true,
        subtree: true,
        characterData: true
      });
    },

    stopAutoScrollObserver() {
      if (this.autoScrollObserver) {
        this.autoScrollObserver.disconnect();
        this.autoScrollObserver = null;
      }
    },

    injectButtons() {
      if (document.querySelector(`.${this.groupClass}`)) return;

      // Prefer inserting into the right side of OmniGem's input toolbar
      const toolbarRight = document.querySelector('.omnigem-input-toolbar-right');
      if (!toolbarRight) return;

      const group = document.createElement('div');
      group.className = this.groupClass;
      group.innerHTML = `
        <button class="omnigem-scroll-btn omnigem-tooltip" id="omnigem-scroll-up-btn" type="button" data-tooltip="Cuộn lên đầu chat">
          <svg viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
        </button>
        <button class="omnigem-scroll-btn omnigem-tooltip" id="omnigem-scroll-down-btn" type="button" data-tooltip="Cuộn xuống cuối (Nhấn đúp: Auto-scroll)">
          <svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      `;

      group.querySelector('#omnigem-scroll-up-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.scrollToTop();
      });

      const downBtn = group.querySelector('#omnigem-scroll-down-btn');
      downBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.clickTimeout) {
          clearTimeout(this.clickTimeout);
          this.clickTimeout = null;
          this.toggleAutoScroll();
        } else {
          this.clickTimeout = setTimeout(() => {
            this.clickTimeout = null;
            this.scrollToBottom(true);
          }, 260);
        }
      });

      // Insert before the usage pill in the toolbar
      toolbarRight.prepend(group);
    }
  };

  window.OmniGemScroll = OmniGemScroll;
})();
