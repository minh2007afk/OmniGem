/**
 * OmniGem Prompt Chains Automation Engine
 * Triggers multi-step sequential workflows via ",," inline trigger or Prompt Library.
 * Waits for Gemini to complete generation before automatically proceeding to next step.
 */
(() => {
  'use strict';

  const OmniGemChains = {
    chains: [],
    autocompleteEl: null,
    selectedIndex: 0,
    filteredChains: [],
    currentExecution: null, // { chain, stepIndex, isRunning, isPaused }
    hudEl: null,

    async init() {
      // 1. Load chains from storage
      this.chains = await OmniGemStorage.get('promptChains', []);

      // 2. Setup ",," inline trigger in chat input
      this.setupInlineTrigger();

      // 3. Listen for storage changes
      OmniGemStorage.onChanged((changes) => {
        if (changes.promptChains) {
          this.chains = changes.promptChains.newValue || [];
        }
      });
    },

    /**
     * Listen for ",," trigger inside Gemini's chat input with zero typing delay.
     * Skips during IME composition (Vietnamese typing) and avoids forced layout reflows.
     */
    setupInlineTrigger() {
      let debounceTimer = null;

      document.addEventListener('input', (e) => {
        // Fast path: skip if IME composition is in progress
        if (e.isComposing) return;

        const target = e.target;
        if (!target || (!target.isContentEditable && target.tagName !== 'TEXTAREA')) return;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const input = OmniGemDOM.getChatInput();
          if (!input) return;

          // Use textContent to avoid expensive layout thrashing
          const text = input.textContent || '';
          const match = text.match(/,,([a-zA-Z0-9_\s]*)$/);
          if (match) {
            const filter = match[1].toLowerCase().trim();
            this.showAutocomplete(input, filter);
          } else {
            if (this.autocompleteEl) this.closeAutocomplete();
          }
        }, 35);
      }, false);

      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (!this.autocompleteEl) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.filteredChains.length);
          this.updateAutocompleteSelection();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex - 1 + this.filteredChains.length) % Math.max(1, this.filteredChains.length);
          this.updateAutocompleteSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (this.filteredChains[this.selectedIndex]) {
            e.preventDefault();
            this.startChain(this.filteredChains[this.selectedIndex]);
          }
        } else if (e.key === 'Escape') {
          this.closeAutocomplete();
        }
      }, true);
    },

    showAutocomplete(inputEl, filter = '') {
      this.filteredChains = this.chains.filter(c =>
        !filter || c.title.toLowerCase().includes(filter) || (c.description || '').toLowerCase().includes(filter)
      );

      if (this.filteredChains.length === 0) {
        this.closeAutocomplete();
        return;
      }

      this.selectedIndex = 0;

      if (!this.autocompleteEl) {
        this.autocompleteEl = document.createElement('div');
        this.autocompleteEl.className = 'omnigem-autocomplete-menu';
        document.body.appendChild(this.autocompleteEl);
      }

      const rect = inputEl.getBoundingClientRect();
      const menuHeight = Math.min(300, this.filteredChains.length * 60 + 40);
      this.autocompleteEl.style.left = `${Math.max(20, rect.left)}px`;
      this.autocompleteEl.style.top = `${Math.max(10, rect.top - menuHeight - 12)}px`;

      this.autocompleteEl.innerHTML = `
        <div class="omnigem-autocomplete-header">
          <span>🔗 Prompt Chains (${this.filteredChains.length})</span>
          <span>[↑↓ Enter]</span>
        </div>
        <div class="omnigem-autocomplete-list">
          ${this.filteredChains.map((c, idx) => `
            <div class="omnigem-autocomplete-item ${idx === 0 ? 'is-selected' : ''}" data-index="${idx}">
              <div class="omnigem-autocomplete-item-title">
                ${c.title}
                <span class="omnigem-chain-badge">${c.steps.length} Steps</span>
              </div>
              <div class="omnigem-autocomplete-item-desc">${c.description || ''}</div>
            </div>
          `).join('')}
        </div>
      `;

      this.autocompleteEl.querySelectorAll('.omnigem-autocomplete-item').forEach((item) => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.getAttribute('data-index'), 10);
          if (this.filteredChains[idx]) {
            this.startChain(this.filteredChains[idx]);
          }
        });
      });
    },

    updateAutocompleteSelection() {
      if (!this.autocompleteEl) return;
      const items = this.autocompleteEl.querySelectorAll('.omnigem-autocomplete-item');
      items.forEach((item, idx) => {
        if (idx === this.selectedIndex) {
          item.classList.add('is-selected');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('is-selected');
        }
      });
    },

    closeAutocomplete() {
      if (this.autocompleteEl) {
        this.autocompleteEl.remove();
        this.autocompleteEl = null;
      }
    },

    /**
     * Start chain execution workflow
     */
    async startChain(chain) {
      this.closeAutocomplete();

      // Clear any ,, trigger text in input box
      const input = OmniGemDOM.getChatInput();
      if (input) {
        const text = input.innerText || input.textContent || '';
        if (text.includes(',,')) {
          OmniGemDOM.simulateInput(input, text.replace(/,,([a-zA-Z0-9_\s]*)$/, '').trim(), true);
        }
      }

      this.currentExecution = {
        chain,
        stepIndex: 0,
        isRunning: true,
        isPaused: false
      };

      this.renderHUD();
      this.runNextStep();
    },

    renderHUD() {
      if (!this.currentExecution) {
        if (this.hudEl) this.hudEl.remove();
        this.hudEl = null;
        return;
      }

      const { chain, stepIndex } = this.currentExecution;
      const currentStep = chain.steps[stepIndex] || {};
      const totalSteps = chain.steps.length;
      const progressPercent = Math.round(((stepIndex) / totalSteps) * 100);

      if (!this.hudEl) {
        this.hudEl = document.createElement('div');
        this.hudEl.className = 'omnigem-chain-hud';
        document.body.appendChild(this.hudEl);
      }

      this.hudEl.innerHTML = `
        <div class="omnigem-chain-hud-header">
          <div class="omnigem-chain-hud-title">
            ${OmniGemDOM.icons.chain()}
            <span>${chain.title}</span>
          </div>
          <span class="omnigem-chain-badge">Step ${stepIndex + 1}/${totalSteps}</span>
        </div>
        <div class="omnigem-chain-step-info">
          <strong>Current:</strong> ${currentStep.name || `Step ${stepIndex + 1}`}
          ${currentStep.model ? `<span class="omnigem-chain-badge" style="margin-left: 6px;">AI: ${currentStep.model}</span>` : ''}
        </div>
        <div class="omnigem-chain-progress-bar">
          <div class="omnigem-chain-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
        <div class="omnigem-chain-status-bar" id="omnigem-chain-status">
          ⏳ Executing step ${stepIndex + 1}...
        </div>
        <div class="omnigem-chain-hud-actions">
          <button class="omnigem-chain-btn" id="omnigem-chain-skip-btn">Skip Step</button>
          <button class="omnigem-chain-btn danger" id="omnigem-chain-cancel-btn">Stop Chain</button>
        </div>
      `;

      this.hudEl.querySelector('#omnigem-chain-cancel-btn').addEventListener('click', () => {
        this.stopChain();
      });

      this.hudEl.querySelector('#omnigem-chain-skip-btn').addEventListener('click', () => {
        this.skipStep();
      });
    },

    updateHUDStatus(text) {
      const statusEl = document.getElementById('omnigem-chain-status');
      if (statusEl) statusEl.textContent = text;
    },

    async runNextStep() {
      if (!this.currentExecution || !this.currentExecution.isRunning) return;

      const { chain, stepIndex } = this.currentExecution;
      if (stepIndex >= chain.steps.length) {
        this.updateHUDStatus('✅ All chain steps completed!');
        setTimeout(() => this.stopChain(), 2500);
        return;
      }

      const step = chain.steps[stepIndex];
      this.renderHUD();
      this.updateHUDStatus(`🚀 Sending Step ${stepIndex + 1}: ${step.name || ''}...`);

      // 1. Check for variables in step prompt
      let promptText = step.prompt;
      if (window.OmniGemPrompts) {
        promptText = window.OmniGemPrompts.resolvePromptReferences(promptText);
      }

      const variables = window.OmniGemPrompts ? window.OmniGemPrompts.extractVariables(promptText) : [];
      if (variables.length > 0) {
        window.OmniGemPrompts.showVariableModal(step.name || `Step ${stepIndex + 1}`, variables, async (values) => {
          let resolved = promptText;
          for (const [key, val] of Object.entries(values)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            resolved = resolved.replace(regex, val || `[${key}]`);
          }
          await this.executePromptStep(resolved);
        });
      } else {
        await this.executePromptStep(promptText);
      }
    },

    async executePromptStep(promptText) {
      const input = OmniGemDOM.getChatInput();
      if (!input) {
        this.updateHUDStatus('⚠️ Error: Chat input not found.');
        return;
      }

      // Input prompt
      OmniGemDOM.simulateInput(input, promptText, true);

      // Brief delay to allow Gemini's internal framework to register the change
      await new Promise(r => setTimeout(r, 600));

      // Click Send
      const sent = OmniGemDOM.clickSendButton();
      if (!sent) {
        // Fallback: press Enter on input
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }

      this.updateHUDStatus('⏳ Waiting for Gemini to finish generating response...');

      // Wait until Gemini starts & completes generating
      await this.waitForGenerationComplete();

      // Proceed to next step
      if (this.currentExecution && this.currentExecution.isRunning) {
        this.currentExecution.stepIndex++;
        this.updateHUDStatus('✨ Response complete! Moving to next step in 2s...');
        setTimeout(() => this.runNextStep(), 2000);
      }
    },

    /**
     * Poll / Observe Gemini DOM until model response generation completes
     */
    waitForGenerationComplete() {
      return new Promise((resolve) => {
        let hasStarted = false;
        let checksAfterFinish = 0;

        const checkInterval = setInterval(() => {
          if (!this.currentExecution || !this.currentExecution.isRunning) {
            clearInterval(checkInterval);
            return resolve();
          }

          const generating = OmniGemDOM.isGenerating();

          if (generating) {
            hasStarted = true;
            checksAfterFinish = 0;
            this.updateHUDStatus('✍️ Gemini is generating response...');
          } else {
            if (hasStarted) {
              // Wait for 2 consecutive non-generating checks to ensure streaming is truly done
              checksAfterFinish++;
              if (checksAfterFinish >= 2) {
                clearInterval(checkInterval);
                resolve();
              }
            }
          }
        }, 1000);

        // Safety timeout (max 3 minutes per step)
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 180000);
      });
    },

    skipStep() {
      if (!this.currentExecution) return;
      this.currentExecution.stepIndex++;
      this.runNextStep();
    },

    stopChain() {
      this.currentExecution = null;
      this.renderHUD();
    }
  };

  window.OmniGemChains = OmniGemChains;
})();
