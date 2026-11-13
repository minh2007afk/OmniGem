/**
 * OmniGem - Main Content Script Coordinator
 * Orchestrates Wide Chat, Timestamps, Folders, Prompt Library, Chains, Scroll Controls & Usage Counter.
 */
(() => {
  'use strict';

  /**
   * Hide the "Gemini là một AI và có thể mắc sai sót." disclaimer bar.
   * Gemini uses dynamically generated class names so we match by text content.
   */
  function hideDisclaimer() {
    const DISCLAIMER_TEXTS = [
      'Gemini là một AI',
      'Gemini is an AI',
      'mắc sai sót',
      'may make mistakes',
      'may display inaccurate',
      'Review its outputs carefully'
    ];

    document.querySelectorAll('p, span, div, footer').forEach(el => {
      const text = el.textContent || '';
      if (DISCLAIMER_TEXTS.some(t => text.includes(t))) {
        // Only hide leaf-level or small containers — not the whole chat window
        if (el.children.length <= 3 && text.length < 200) {
          el.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }

  async function bootstrapOmniGem() {
    try {
      // 1. If currently on /usage page (either in main tab or inside background sync iframe)
      if (window.location.pathname.includes('/usage')) {
        console.log('[OmniGem] Detected /usage page -> Activating direct quota extractor...');
        if (window.OmniGemUsage && window.OmniGemUsage.scrapeUsagePageDirectly) {
          window.OmniGemUsage.scrapeUsagePageDirectly();
        }
        return;
      }

      // 2. If inside a non-usage subframe, do not inject main UI
      if (window.self !== window.top) {
        return;
      }

      console.log('[OmniGem] Superpower suite loading on chat UI:', window.location.href);

      // 3. Hide disclaimer immediately and keep watching for it on SPA navigation
      hideDisclaimer();
      const disclaimerObserver = new MutationObserver(() => hideDisclaimer());
      disclaimerObserver.observe(document.body, { childList: true, subtree: true });

      // 4. Initialize Wide Chat
      if (window.OmniGemWideChat) {
        await window.OmniGemWideChat.init();
      }

      // 5. Initialize Timestamps
      if (window.OmniGemTimestamps) {
        await window.OmniGemTimestamps.init();
      }

      // 6. Initialize Folders & Sidebar Navigation
      if (window.OmniGemFolders) {
        await window.OmniGemFolders.init();
      }

      // 7. Initialize Prompt Library & "//" Autocomplete
      if (window.OmniGemPrompts) {
        await window.OmniGemPrompts.init();
      }

      // 8. Initialize Prompt Chains & ",," Multi-Step Workflows
      if (window.OmniGemChains) {
        await window.OmniGemChains.init();
      }

      // 9. Initialize Floating Scroll Buttons & Auto-Scroll
      if (window.OmniGemScroll) {
        window.OmniGemScroll.init();
      }

      // 10. Initialize Usage Counter & Input Toolbar
      if (window.OmniGemUsage) {
        await window.OmniGemUsage.init();
      }

      // 11. SPA Route Change Listener
      if (window.OmniGemDOM) {
        window.OmniGemDOM.onRouteChange(() => {
          if (window.location.pathname.includes('/usage')) {
            if (window.OmniGemUsage && window.OmniGemUsage.scrapeUsagePageDirectly) {
              window.OmniGemUsage.scrapeUsagePageDirectly();
            }
            return;
          }

          hideDisclaimer();

          if (window.OmniGemWideChat) {
            window.OmniGemWideChat.injectToggleButton();
          }
          if (window.OmniGemFolders) {
            window.OmniGemFolders.injectSidebarNav();
          }
          if (window.OmniGemScroll) {
            window.OmniGemScroll.injectButtons();
          }
          if (window.OmniGemUsage) {
            window.OmniGemUsage.injectToolbar();
          }
        });
      }

      console.log('[OmniGem] All modules initialized successfully!');
    } catch (err) {
      console.error('[OmniGem] Bootstrap error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapOmniGem);
  } else {
    bootstrapOmniGem();
  }
})();

