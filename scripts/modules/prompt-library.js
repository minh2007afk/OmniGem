/**
 * OmniGem Prompt Library & Autocomplete Engine
 * Reusable templates, Alt+L shortcut, "//" inline autocomplete trigger,
 * dynamic variable extraction ({{var}}), and prompt referencing ([[prompt name]]).
 */
(() => {
  'use strict';

  const OmniGemPrompts = {
    prompts: [],
    isModalOpen: false,
    autocompleteEl: null,
    selectedIndex: 0,
    filteredPrompts: [],

    async init() {
      // 1. Load prompts from storage
      this.prompts = await OmniGemStorage.get('customPrompts', []);

      // 2. Register Alt + L shortcut
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'l' || e.key === 'L')) {
          e.preventDefault();
          this.toggleModal();
        }
        if (e.key === 'Escape') {
          if (this.autocompleteEl) this.closeAutocomplete();
          if (this.isModalOpen) this.closeModal();
        }
      });

      // 3. Setup "//" inline trigger in Gemini chat input
      this.setupInlineTrigger();

      // 4. Listen for storage changes
      OmniGemStorage.onChanged((changes) => {
        if (changes.customPrompts) {
          this.prompts = changes.customPrompts.newValue || [];
          if (this.isModalOpen) this.renderModalBody();
        }
      });
    },

    /**
     * Listen for "//" input inside Gemini's rich-textarea
     */
    setupInlineTrigger() {
      document.addEventListener('input', (e) => {
        const input = OmniGemDOM.getChatInput();
        if (!input) return;

        const text = input.innerText || input.textContent || '';
        // Check if text ends with "//" (not matching URLs like https://)
        const match = text.match(/(?:^|\s)\/\/([a-zA-Z0-9_\s]*)$/);
        if (match) {
          const filter = match[1].toLowerCase().trim();
          this.showAutocomplete(input, filter);
        } else {
          if (this.autocompleteEl) this.closeAutocomplete();
        }
      }, true);

      // Keyboard navigation inside chat input when autocomplete is open
      document.addEventListener('keydown', (e) => {
        if (!this.autocompleteEl) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.filteredPrompts.length);
          this.updateAutocompleteSelection();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.selectedIndex = (this.selectedIndex - 1 + this.filteredPrompts.length) % Math.max(1, this.filteredPrompts.length);
          this.updateAutocompleteSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (this.filteredPrompts[this.selectedIndex]) {
            e.preventDefault();
            this.selectPrompt(this.filteredPrompts[this.selectedIndex]);
          }
        } else if (e.key === 'Escape') {
          this.closeAutocomplete();
        }
      }, true);
    },

    showAutocomplete(inputEl, filter = '') {
      this.filteredPrompts = this.prompts.filter(p =>
        !filter || p.title.toLowerCase().includes(filter) || (p.tag || '').toLowerCase().includes(filter)
      );

      if (this.filteredPrompts.length === 0) {
        this.closeAutocomplete();
        return;
      }

      this.selectedIndex = 0;

      if (!this.autocompleteEl) {
        this.autocompleteEl = document.createElement('div');
        this.autocompleteEl.className = 'omnigem-autocomplete-menu';
        document.body.appendChild(this.autocompleteEl);
      }

      // Position right above Gemini's input bar
      const rect = inputEl.getBoundingClientRect();
      const menuHeight = Math.min(300, this.filteredPrompts.length * 60 + 40);
      this.autocompleteEl.style.left = `${Math.max(20, rect.left)}px`;
      this.autocompleteEl.style.top = `${Math.max(10, rect.top - menuHeight - 12)}px`;

      this.autocompleteEl.innerHTML = `
        <div class="omnigem-autocomplete-header">
          <span>⚡ Prompts Library (${this.filteredPrompts.length})</span>
          <span>[↑↓ Enter]</span>
        </div>
        <div class="omnigem-autocomplete-list">
          ${this.filteredPrompts.map((p, idx) => `
            <div class="omnigem-autocomplete-item ${idx === 0 ? 'is-selected' : ''}" data-index="${idx}">
              <div class="omnigem-autocomplete-item-title">
                ${p.title}
                ${p.tag ? `<span class="omnigem-prompt-tag">${p.tag}</span>` : ''}
              </div>
              <div class="omnigem-autocomplete-item-desc">${p.content.slice(0, 80).replace(/\n/g, ' ')}...</div>
            </div>
          `).join('')}
        </div>
      `;

      this.autocompleteEl.querySelectorAll('.omnigem-autocomplete-item').forEach((item) => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.getAttribute('data-index'), 10);
          if (this.filteredPrompts[idx]) {
            this.selectPrompt(this.filteredPrompts[idx]);
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
     * Resolves nested prompt references [[prompt name]]
     */
    resolvePromptReferences(content, depth = 0) {
      if (depth > 5) return content; // prevent circular references
      return content.replace(/\[\[(.*?)\]\]/g, (match, promptName) => {
        const found = this.prompts.find(p => p.title.toLowerCase() === promptName.trim().toLowerCase());
        return found ? this.resolvePromptReferences(found.content, depth + 1) : match;
      });
    },

    /**
     * Extract dynamic variables {{variable_name}}
     */
    extractVariables(content) {
      const matches = content.match(/\{\{([a-zA-Z0-9_-]+)\}\}/g);
      if (!matches) return [];
      return [...new Set(matches.map(m => m.replace(/[\{\}]/g, '').trim()))];
    },

    /**
     * Select and use a prompt template
     */
    async selectPrompt(promptItem) {
      this.closeAutocomplete();

      // 1. Resolve [[prompt references]]
      let content = this.resolvePromptReferences(promptItem.content);

      // 2. Check for dynamic {{variables}}
      const variables = this.extractVariables(content);

      if (variables.length > 0) {
        // Prompt user to fill variables
        this.showVariableModal(promptItem.title, variables, (values) => {
          let resolved = content;
          for (const [key, val] of Object.entries(values)) {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            resolved = resolved.replace(regex, val || `[${key}]`);
          }
          this.pasteIntoChat(resolved);
        });
      } else {
        this.pasteIntoChat(content);
      }
    },

    /**
     * Pastes text into Gemini's chat input, replacing any trigger text
     */
    pasteIntoChat(text) {
      const input = OmniGemDOM.getChatInput();
      if (!input) return;

      const currentText = input.innerText || input.textContent || '';
      // If starts or ends with "//" (or legacy "/ /"), replace it cleanly
      if (/(?:^|\s)(\/\/|\/ \/)([a-zA-Z0-9_\s]*)$/.test(currentText)) {
        const cleaned = currentText.replace(/(?:^|\s)(\/\/|\/ \/)([a-zA-Z0-9_\s]*)$/, '').trim();
        const finalText = cleaned ? `${cleaned} ${text}` : text;
        OmniGemDOM.simulateInput(input, finalText, true);
      } else {
        OmniGemDOM.simulateInput(input, text, false);
      }
    },

    /**
     * Show modal to prompt user for variable values
     */
    showVariableModal(title, variables, onConfirm) {
      const overlay = document.createElement('div');
      overlay.className = 'omnigem-modal-overlay';
      overlay.innerHTML = `
        <div class="omnigem-modal-card" style="width: min(90vw, 480px);">
          <div class="omnigem-modal-header">
            <h3>⚡ Fill Variables: ${title}</h3>
            <button class="omnigem-close-btn" id="omnigem-var-close">${OmniGemDOM.icons.close()}</button>
          </div>
          <div class="omnigem-modal-body omnigem-var-dialog">
            ${variables.map(v => `
              <div class="omnigem-var-field">
                <label class="omnigem-var-label">{{${v}}}</label>
                <input type="text" class="omnigem-search-input" data-var="${v}" placeholder="Enter value for ${v}...">
              </div>
            `).join('')}
          </div>
          <div class="omnigem-modal-header" style="justify-content: flex-end; gap: 8px;">
            <button class="omnigem-header-btn" id="omnigem-var-cancel">Cancel</button>
            <button class="omnigem-use-btn" id="omnigem-var-submit">Insert Prompt</button>
          </div>
        </div>
      `;

      const close = () => overlay.remove();
      overlay.querySelector('#omnigem-var-close').addEventListener('click', close);
      overlay.querySelector('#omnigem-var-cancel').addEventListener('click', close);

      overlay.querySelector('#omnigem-var-submit').addEventListener('click', () => {
        const values = {};
        overlay.querySelectorAll('input[data-var]').forEach(inp => {
          values[inp.getAttribute('data-var')] = inp.value.trim();
        });
        close();
        onConfirm(values);
      });

      document.body.appendChild(overlay);
      const firstInp = overlay.querySelector('input[data-var]');
      if (firstInp) firstInp.focus();
    },

    toggleModal() {
      if (this.isModalOpen) this.closeModal();
      else this.openModal();
    },

    openModal() {
      this.isModalOpen = true;
      let overlay = document.getElementById('omnigem-prompts-modal');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'omnigem-prompts-modal';
        overlay.className = 'omnigem-modal-overlay';
        overlay.innerHTML = `
          <div class="omnigem-modal-card" style="width: min(92vw, 840px);">
            <div class="omnigem-modal-header">
              <div class="omnigem-modal-header-left">
                <h2>${OmniGemDOM.icons.bolt()} Prompts Library</h2>
              </div>
              <div class="omnigem-modal-header-actions">
                <button class="omnigem-header-btn" id="omnigem-new-prompt-btn">
                  ${OmniGemDOM.icons.plus()} New Prompt
                </button>
                <button class="omnigem-close-btn" id="omnigem-prompts-close-btn">
                  ${OmniGemDOM.icons.close()}
                </button>
              </div>
            </div>
            <div class="omnigem-modal-toolbar">
              <input type="text" class="omnigem-search-input" id="omnigem-prompt-search" placeholder="Search templates by title, tag, or content...">
            </div>
            <div class="omnigem-modal-body" id="omnigem-prompts-body">
              <!-- Dynamically populated -->
            </div>
          </div>
        `;

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) this.closeModal();
        });

        overlay.querySelector('#omnigem-prompts-close-btn').addEventListener('click', () => this.closeModal());
        overlay.querySelector('#omnigem-new-prompt-btn').addEventListener('click', () => this.promptCreate());
        overlay.querySelector('#omnigem-prompt-search').addEventListener('input', (e) => {
          this.renderModalBody(e.target.value.toLowerCase().trim());
        });

        document.body.appendChild(overlay);
      } else {
        overlay.style.display = 'flex';
      }

      this.renderModalBody();
    },

    closeModal() {
      this.isModalOpen = false;
      const overlay = document.getElementById('omnigem-prompts-modal');
      if (overlay) overlay.style.display = 'none';
    },

    renderModalBody(query = '') {
      const container = document.getElementById('omnigem-prompts-body');
      if (!container) return;

      const visible = this.prompts.filter(p =>
        !query || p.title.toLowerCase().includes(query) || (p.tag || '').toLowerCase().includes(query) || p.content.toLowerCase().includes(query)
      );

      if (visible.length === 0) {
        container.innerHTML = `<div class="omnigem-empty-state">No prompt templates found. Click "+ New Prompt" to create one.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="omnigem-prompt-grid">
          ${visible.map(p => {
            // Highlight {{variables}} in preview
            const highlighted = p.content.replace(/\{\{(.*?)\}\}/g, '<span class="omnigem-var-highlight">{{$1}}</span>');
            return `
              <div class="omnigem-prompt-card" data-prompt-id="${p.id}">
                <div>
                  <div class="omnigem-prompt-header">
                    <h4 class="omnigem-prompt-title">${p.title}</h4>
                    ${p.tag ? `<span class="omnigem-prompt-tag">${p.tag}</span>` : ''}
                  </div>
                  <div class="omnigem-prompt-preview">${highlighted}</div>
                </div>
                <div class="omnigem-prompt-footer">
                  <div style="display: flex; gap: 4px;">
                    <button class="omnigem-action-icon-btn omnigem-btn-edit-prompt" title="Edit template">
                      ${OmniGemDOM.icons.gear()}
                    </button>
                    <button class="omnigem-action-icon-btn omnigem-btn-delete-prompt" title="Delete template">
                      ${OmniGemDOM.icons.trash()}
                    </button>
                  </div>
                  <button class="omnigem-use-btn omnigem-btn-use-prompt">
                    ${OmniGemDOM.icons.bolt()} Use
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      container.querySelectorAll('.omnigem-prompt-card').forEach(card => {
        const id = card.getAttribute('data-prompt-id');
        const promptItem = this.prompts.find(p => p.id === id);

        card.querySelector('.omnigem-btn-use-prompt').addEventListener('click', () => {
          this.closeModal();
          this.selectPrompt(promptItem);
        });

        card.querySelector('.omnigem-btn-delete-prompt').addEventListener('click', () => {
          if (confirm(`Delete prompt "${promptItem.title}"?`)) {
            this.deletePrompt(id);
          }
        });

        card.querySelector('.omnigem-btn-edit-prompt').addEventListener('click', () => {
          this.promptEdit(promptItem);
        });
      });
    },

    async promptCreate() {
      const title = prompt('Enter Prompt Title:');
      if (!title || !title.trim()) return;
      const tag = prompt('Enter Tag (e.g. Writing, Coding, Summarize):', 'General');
      const content = prompt('Enter Prompt Content (use {{variable}} for dynamic placeholders):');
      if (!content || !content.trim()) return;

      const newPrompt = {
        id: `prompt_${Date.now()}`,
        title: title.trim(),
        tag: (tag || 'General').trim(),
        content: content.trim()
      };

      this.prompts.push(newPrompt);
      await OmniGemStorage.set('customPrompts', this.prompts);
      this.renderModalBody();
    },

    async promptEdit(item) {
      const title = prompt('Edit Title:', item.title);
      if (!title || !title.trim()) return;
      const tag = prompt('Edit Tag:', item.tag || 'General');
      const content = prompt('Edit Content:', item.content);
      if (!content || !content.trim()) return;

      item.title = title.trim();
      item.tag = tag.trim();
      item.content = content.trim();

      await OmniGemStorage.set('customPrompts', this.prompts);
      this.renderModalBody();
    },

    async deletePrompt(id) {
      this.prompts = this.prompts.filter(p => p.id !== id);
      await OmniGemStorage.set('customPrompts', this.prompts);
      this.renderModalBody();
    }
  };

  window.OmniGemPrompts = OmniGemPrompts;
})();
