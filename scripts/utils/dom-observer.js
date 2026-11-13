/**
 * OmniGem DOM & MutationObserver Utility
 * Specialized for Google Gemini's dynamic Single Page Application (SPA).
 */
(() => {
  'use strict';

  const OmniGemDOM = {
    waitForElement(selector, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) return resolve(existing);

        const timer = setTimeout(() => {
          observer.disconnect();
          reject(new Error(`[OmniGem] Timeout waiting for element: ${selector}`));
        }, timeout);

        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(el);
          }
        });

        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true
        });
      });
    },

    onElementAdded(selector, callback, processedAttr = 'data-omnigem-processed') {
      document.querySelectorAll(selector).forEach((el) => {
        if (!el.hasAttribute(processedAttr)) {
          el.setAttribute(processedAttr, 'true');
          callback(el);
        }
      });

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(selector) && !node.hasAttribute(processedAttr)) {
                node.setAttribute(processedAttr, 'true');
                callback(node);
              }
              const descendants = node.querySelectorAll(selector);
              descendants.forEach((child) => {
                if (!child.hasAttribute(processedAttr)) {
                  child.setAttribute(processedAttr, 'true');
                  callback(child);
                }
              });
            }
          }
        }
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      return observer;
    },

    onRouteChange(callback) {
      let lastUrl = location.href;
      const triggerIfChanged = () => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          callback(currentUrl);
        }
      };

      const originalPush = history.pushState;
      history.pushState = function (...args) {
        const res = originalPush.apply(this, args);
        triggerIfChanged();
        return res;
      };

      const originalReplace = history.replaceState;
      history.replaceState = function (...args) {
        const res = originalReplace.apply(this, args);
        triggerIfChanged();
        return res;
      };

      window.addEventListener('popstate', triggerIfChanged);
      setInterval(triggerIfChanged, 1000);
    },

    getChatId() {
      const match = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : 'new-chat';
    },

    getChatInput() {
      return document.querySelector('rich-textarea [contenteditable="true"]') ||
             document.querySelector('rich-textarea') ||
             document.querySelector('[contenteditable="true"]') ||
             document.querySelector('textarea');
    },

    getSendButton() {
      return document.querySelector('button[aria-label*="Send"]') ||
             document.querySelector('button[aria-label*="Gửi"]') ||
             document.querySelector('.send-button') ||
             document.querySelector('[data-test-id="send-button"]') ||
             document.querySelector('button.send-button-container');
    },

    getStopButton() {
      return document.querySelector('button[aria-label*="Stop"]') ||
             document.querySelector('button[aria-label*="Dừng"]') ||
             document.querySelector('[data-test-id="stop-button"]') ||
             document.querySelector('.stop-button');
    },

    isGenerating() {
      return Boolean(this.getStopButton());
    },

    clickSendButton() {
      const btn = this.getSendButton();
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
      return false;
    },

    simulateInput(target, text, replaceAll = false) {
      if (!target) {
        target = this.getChatInput();
      }

      if (!target) {
        console.warn('[OmniGem] Chat input target not found.');
        return false;
      }

      const editable = target.getAttribute('contenteditable') === 'true'
        ? target
        : (target.querySelector('[contenteditable="true"]') || target);

      editable.focus();

      if (replaceAll) {
        // Clear existing content
        const range = document.createRange();
        range.selectNodeContents(editable);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      }

      let success = false;
      try {
        success = document.execCommand('insertText', false, text);
      } catch (err) {
        console.warn('[OmniGem] execCommand fallback triggered', err);
      }

      if (!success) {
        if (replaceAll) {
          editable.textContent = text;
        } else {
          editable.textContent = (editable.textContent || '') + text;
        }
        editable.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
        editable.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Move cursor to end
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(editable);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      return true;
    },

    icons: {
      wideToggle() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l4-4v3h8V8l4 4-4 4v-3H8v3l-4-4zm-2-8h20v2H2V4zm0 14h20v2H2v-2z"/></svg>`;
      },
      clock() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`;
      },
      folder() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
      },
      bolt() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/></svg>`;
      },
      gear() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;
      },
      chain() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;
      },
      plus() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
      },
      trash() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
      },
      close() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
      },
      play() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
      }
    }
  };

  window.OmniGemDOM = OmniGemDOM;
})();
