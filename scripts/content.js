/**
 * OmniGem - Main Content Script Coordinator
 * Orchestrates Wide Chat, Timestamps, Folders, Prompt Library, Chains, Scroll Controls & Usage Counter.
 */
(() => {
  'use strict';

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

      // 3. Initialize Wide Chat
      if (window.OmniGemWideChat) {
        await window.OmniGemWideChat.init();
      }

      // 4. Initialize Timestamps
      if (window.OmniGemTimestamps) {
        await window.OmniGemTimestamps.init();
      }

      // 5. Initialize Folders & Sidebar Navigation
      if (window.OmniGemFolders) {
        await window.OmniGemFolders.init();
      }

      // 6. Initialize Prompt Library & "//" Autocomplete
      if (window.OmniGemPrompts) {
        await window.OmniGemPrompts.init();
      }

      // 7. Initialize Prompt Chains & ",," Multi-Step Workflows
      if (window.OmniGemChains) {
        await window.OmniGemChains.init();
      }

      // 8. Initialize Floating Scroll Buttons & Auto-Scroll
      if (window.OmniGemScroll) {
        window.OmniGemScroll.init();
      }

      // 9. Initialize Usage Counter & Input Toolbar
      if (window.OmniGemUsage) {
        await window.OmniGemUsage.init();
      }

      // 10. SPA Route Change Listener
      if (window.OmniGemDOM) {
        window.OmniGemDOM.onRouteChange(() => {
          if (window.location.pathname.includes('/usage')) {
            if (window.OmniGemUsage && window.OmniGemUsage.scrapeUsagePageDirectly) {
              window.OmniGemUsage.scrapeUsagePageDirectly();
            }
            return;
          }

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
