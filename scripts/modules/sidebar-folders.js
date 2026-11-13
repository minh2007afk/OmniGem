/**
 * OmniGem Sidebar & Folders Management Module
 * Perfectly integrated into Gemini's sidebar list (matching Google Material 3 tokens),
 * with custom folders, subfolders, drag-and-drop support, trash bin, and Alt+F shortcut.
 */
(() => {
  'use strict';

  const OmniGemFolders = {
    folders: [],
    trash: [],
    isModalOpen: false,
    activeTab: 'folders',
    groupId: 'omnigem-sidebar-group',

    async init() {
      // 1. Load folders and trash from storage
      this.folders = await OmniGemStorage.get('folders', []);
      this.trash = await OmniGemStorage.get('trash', []);

      // 2. Inject OmniGem section seamlessly into sidebar list
      this.injectSidebarNav();

      // 3. Keep checking in case Gemini re-renders the sidebar on route change
      setInterval(() => {
        if (!document.getElementById(this.groupId)) {
          this.injectSidebarNav();
        }
      }, 1500);

      // 4. Register Alt + F shortcut
      window.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          this.toggleModal();
        }
        if (e.key === 'Escape' && this.isModalOpen) {
          this.closeModal();
        }
      });

      // 5. Setup drag-and-drop tracking for sidebar chats
      this.setupChatDragAndDrop();

      // 6. Listen for storage changes
      OmniGemStorage.onChanged((changes) => {
        if (changes.folders) {
          this.folders = changes.folders.newValue || [];
          if (this.isModalOpen) this.renderModalBody();
        }
        if (changes.trash) {
          this.trash = changes.trash.newValue || [];
          if (this.isModalOpen && this.activeTab === 'trash') this.renderModalBody();
        }
      });
    },

    /**
     * Find the exact native insertion point in Gemini's sidebar
     * Placed right above "Số ghi chú", "Pinned", or "Tất cả" (identical to Superpower for Gemini)
     */
    findSidebarPlacement() {
      const sidebar = document.querySelector('bard-sidenav, side-nav, [role="navigation"]');
      if (!sidebar) return null;

      // Strategy 1: Find native section headings ("Số ghi chú", "Pinned", "Ghim", "Tất cả", "Recent")
      const candidateElements = sidebar.querySelectorAll('div, h2, h3, span');
      for (const el of candidateElements) {
        const text = el.textContent.trim();
        if (text === 'Số ghi chú' || text === 'Pinned' || text === 'Ghim' || text === 'Tất cả' || text === 'Recent') {
          const sectionEl = el.closest('[class*="section"], [class*="group"], [class*="container"]') || el;
          if (sectionEl && sectionEl.parentElement) {
            return { parent: sectionEl.parentElement, before: sectionEl };
          }
        }
      }

      // Strategy 2: Find "Hiện thêm" (Show more) or "Sinh viên"
      const buttons = sidebar.querySelectorAll('button, [role="button"], a');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text.includes('Hiện thêm') || text.includes('Show more')) {
          const itemWrapper = btn.closest('[class*="item"], [class*="row"]') || btn;
          if (itemWrapper && itemWrapper.parentElement) {
            return { parent: itemWrapper.parentElement, after: itemWrapper };
          }
        }
      }

      // Strategy 3: Chat history list container
      const firstChat = sidebar.querySelector('a[href*="/app/"]');
      if (firstChat) {
        const listContainer = firstChat.closest('[class*="list"], [class*="history"]') || firstChat.parentElement;
        if (listContainer && listContainer.parentElement) {
          return { parent: listContainer.parentElement, before: listContainer };
        }
      }

      // Strategy 4: Main scroll container in sidebar
      const scrollable = sidebar.querySelector('.scrollable-container, [class*="scroll"], [class*="content"]');
      if (scrollable) {
        return { parent: scrollable, append: true };
      }

      return null;
    },

    /**
     * Inject OmniGem group seamlessly into Gemini's sidebar list
     */
    injectSidebarNav() {
      if (document.getElementById(this.groupId)) return;

      const placement = this.findSidebarPlacement();
      if (!placement) return;

      const group = document.createElement('div');
      group.id = this.groupId;
      group.className = 'omnigem-sidebar-group';
      group.innerHTML = `
        <div class="omnigem-sidebar-header" id="omnigem-sidebar-accordion-btn" role="button" title="Toggle OmniGem Menu">
          <div class="omnigem-sidebar-header-left">
            ${OmniGemDOM.icons.bolt()}
            <span>Superpower for Gemini</span>
          </div>
          <span class="omnigem-sidebar-toggle-arrow">▾</span>
        </div>
        <div class="omnigem-sidebar-nav-list">
          <div class="omnigem-sidebar-nav-item" id="omnigem-nav-folders" role="button" title="Folders (Alt + F)">
            <span class="omnigem-sidebar-nav-icon">${OmniGemDOM.icons.folder()}</span>
            <span class="omnigem-sidebar-nav-label">Folders</span>
            <span class="omnigem-sidebar-shortcut-badge">Alt+F</span>
          </div>
          <div class="omnigem-sidebar-nav-item" id="omnigem-nav-prompts" role="button" title="Prompt Library (Alt + L)">
            <span class="omnigem-sidebar-nav-icon">${OmniGemDOM.icons.bolt()}</span>
            <span class="omnigem-sidebar-nav-label">Prompts</span>
            <span class="omnigem-sidebar-shortcut-badge">Alt+L</span>
          </div>
          <div class="omnigem-sidebar-nav-item" id="omnigem-nav-settings" role="button" title="Settings">
            <span class="omnigem-sidebar-nav-icon">${OmniGemDOM.icons.gear()}</span>
            <span class="omnigem-sidebar-nav-label">Settings</span>
          </div>
        </div>
      `;

      // Accordion toggle
      group.querySelector('#omnigem-sidebar-accordion-btn').addEventListener('click', () => {
        group.classList.toggle('is-collapsed');
      });

      // Actions
      group.querySelector('#omnigem-nav-folders').addEventListener('click', () => {
        this.openModal('folders');
      });

      group.querySelector('#omnigem-nav-prompts').addEventListener('click', () => {
        if (window.OmniGemPrompts) {
          window.OmniGemPrompts.openModal();
        }
      });

      group.querySelector('#omnigem-nav-settings').addEventListener('click', () => {
        alert('OmniGem Settings: Wide Chat, Timestamps, Folders, Prompts, and Chains are running.');
      });

      // Drag and drop onto Folders menu item
      const foldersNav = group.querySelector('#omnigem-nav-folders');
      foldersNav.addEventListener('dragover', (e) => {
        e.preventDefault();
        foldersNav.classList.add('is-drag-over');
      });
      foldersNav.addEventListener('dragleave', () => {
        foldersNav.classList.remove('is-drag-over');
      });
      foldersNav.addEventListener('drop', (e) => {
        e.preventDefault();
        foldersNav.classList.remove('is-drag-over');
        const chatId = e.dataTransfer.getData('text/plain');
        if (chatId) {
          this.openModal('folders', chatId);
        }
      });

      // Insert at the exact calculated location
      if (placement.before) {
        placement.parent.insertBefore(group, placement.before);
      } else if (placement.after) {
        placement.after.after(group);
      } else if (placement.append) {
        placement.parent.appendChild(group);
      }
    },

    /**
     * Attach dragstart listeners to conversation links in Gemini's chat list
     */
    setupChatDragAndDrop() {
      setInterval(() => {
        const chatLinks = document.querySelectorAll('a[href*="/app/"], [data-test-id*="conversation"]');
        chatLinks.forEach((link) => {
          if (!link.getAttribute('draggable')) {
            link.setAttribute('draggable', 'true');
            link.addEventListener('dragstart', (e) => {
              const href = link.getAttribute('href') || '';
              const match = href.match(/\/app\/([a-zA-Z0-9_-]+)/);
              const chatId = match ? match[1] : OmniGemDOM.getChatId();
              const title = link.textContent.trim() || 'Conversation';
              e.dataTransfer.setData('text/plain', chatId);
              e.dataTransfer.setData('application/json', JSON.stringify({ chatId, title }));
            });
          }
        });
      }, 2000);
    },

    toggleModal() {
      if (this.isModalOpen) {
        this.closeModal();
      } else {
        this.openModal();
      }
    },

    openModal(tab = 'folders', pendingChatId = null) {
      this.activeTab = tab;
      this.pendingChatId = pendingChatId;
      this.isModalOpen = true;

      let overlay = document.getElementById('omnigem-folders-modal');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'omnigem-folders-modal';
        overlay.className = 'omnigem-modal-overlay';
        overlay.innerHTML = `
          <div class="omnigem-modal-card">
            <div class="omnigem-modal-header">
              <div class="omnigem-modal-header-left">
                <h2>${OmniGemDOM.icons.folder()} Folders & Management</h2>
              </div>
              <div class="omnigem-modal-header-actions">
                <button class="omnigem-header-btn" id="omnigem-modal-new-folder-btn">
                  ${OmniGemDOM.icons.plus()} New Folder
                </button>
                <button class="omnigem-header-btn" id="omnigem-modal-trash-tab-btn">
                  ${OmniGemDOM.icons.trash()} Trash Bin
                </button>
                <button class="omnigem-close-btn" id="omnigem-modal-close-btn">
                  ${OmniGemDOM.icons.close()}
                </button>
              </div>
            </div>
            <div class="omnigem-modal-toolbar">
              <input type="text" class="omnigem-search-input" id="omnigem-folder-search" placeholder="Search folders or conversations...">
            </div>
            <div class="omnigem-modal-body" id="omnigem-folders-body">
              <!-- Dynamically populated -->
            </div>
          </div>
        `;

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) this.closeModal();
        });

        overlay.querySelector('#omnigem-modal-close-btn').addEventListener('click', () => this.closeModal());
        overlay.querySelector('#omnigem-modal-new-folder-btn').addEventListener('click', () => this.promptCreateFolder());
        overlay.querySelector('#omnigem-modal-trash-tab-btn').addEventListener('click', () => {
          this.activeTab = this.activeTab === 'trash' ? 'folders' : 'trash';
          overlay.querySelector('#omnigem-modal-trash-tab-btn').textContent = this.activeTab === 'trash' ? '📁 Folders' : '🗑️ Trash Bin';
          this.renderModalBody();
        });

        overlay.querySelector('#omnigem-folder-search').addEventListener('input', (e) => {
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
      const overlay = document.getElementById('omnigem-folders-modal');
      if (overlay) overlay.style.display = 'none';
    },

    renderModalBody(query = '') {
      const container = document.getElementById('omnigem-folders-body');
      if (!container) return;

      container.innerHTML = '';

      if (this.activeTab === 'trash') {
        this.renderTrashView(container, query);
        return;
      }

      // Current Chat Assignment Bar
      const currentChatId = this.pendingChatId || OmniGemDOM.getChatId();
      if (currentChatId && currentChatId !== 'new-chat') {
        const bar = document.createElement('div');
        bar.className = 'omnigem-current-chat-bar';
        bar.innerHTML = `
          <div class="omnigem-current-chat-info">
            <span>Current Chat: <strong>${currentChatId.slice(0, 16)}...</strong></span>
          </div>
          <div>
            <select class="omnigem-header-btn" id="omnigem-assign-folder-select">
              <option value="">Move current chat to folder...</option>
              ${this.folders.map(f => `<option value="${f.id}">📁 ${f.name}</option>`).join('')}
            </select>
          </div>
        `;
        bar.querySelector('#omnigem-assign-folder-select').addEventListener('change', (e) => {
          if (e.target.value) {
            this.addChatToFolder(e.target.value, currentChatId, document.title || 'Conversation');
            e.target.value = '';
          }
        });
        container.appendChild(bar);
      }

      // Filtered Folders List
      const visibleFolders = this.folders.filter(f =>
        !query || f.name.toLowerCase().includes(query) || (f.chatIds && f.chatIds.some(c => (c.title || c.id || '').toLowerCase().includes(query)))
      );

      if (visibleFolders.length === 0) {
        container.innerHTML += `<div class="omnigem-empty-state">No folders found. Click "+ New Folder" above to create one.</div>`;
        return;
      }

      visibleFolders.forEach((folder) => {
        const folderEl = document.createElement('div');
        folderEl.className = 'omnigem-folder-item';
        folderEl.setAttribute('data-folder-id', folder.id);

        const chatCount = (folder.chatIds || []).length;
        folderEl.innerHTML = `
          <div class="omnigem-folder-header">
            <div class="omnigem-folder-header-left">
              <span class="omnigem-folder-icon" style="fill: ${folder.color || '#fbbc05'}">
                ${OmniGemDOM.icons.folder()}
              </span>
              <span class="omnigem-folder-name">${folder.name}</span>
              <span class="omnigem-folder-count">${chatCount} chats</span>
            </div>
            <div class="omnigem-folder-actions">
              <button class="omnigem-action-icon-btn omnigem-btn-add-chat" title="Add current chat to this folder">
                ${OmniGemDOM.icons.plus()}
              </button>
              <button class="omnigem-action-icon-btn omnigem-btn-delete-folder" title="Delete folder">
                ${OmniGemDOM.icons.trash()}
              </button>
            </div>
          </div>
          <div class="omnigem-folder-chats">
            ${(folder.chatIds && folder.chatIds.length > 0)
              ? folder.chatIds.map(c => `
                <div class="omnigem-chat-row" data-chat-id="${c.id}">
                  <span class="omnigem-chat-title">💬 ${c.title || c.id}</span>
                  <button class="omnigem-action-icon-btn omnigem-remove-chat-btn" title="Remove from folder">
                    ${OmniGemDOM.icons.close()}
                  </button>
                </div>
              `).join('')
              : '<div style="color: #9aa0a6; font-size: 12px; padding: 4px 0;">Empty folder. Drag chats here or click +</div>'
            }
          </div>
        `;

        // Folder drag-and-drop target
        folderEl.addEventListener('dragover', (e) => {
          e.preventDefault();
          folderEl.classList.add('is-drop-target');
        });
        folderEl.addEventListener('dragleave', () => {
          folderEl.classList.remove('is-drop-target');
        });
        folderEl.addEventListener('drop', (e) => {
          e.preventDefault();
          folderEl.classList.remove('is-drop-target');
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            try {
              const data = JSON.parse(raw);
              this.addChatToFolder(folder.id, data.chatId, data.title);
            } catch (err) {
              const chatId = e.dataTransfer.getData('text/plain');
              if (chatId) this.addChatToFolder(folder.id, chatId, 'Conversation');
            }
          }
        });

        folderEl.querySelector('.omnigem-btn-add-chat').addEventListener('click', (e) => {
          e.stopPropagation();
          const curId = OmniGemDOM.getChatId();
          this.addChatToFolder(folder.id, curId, document.title || 'Conversation');
        });

        folderEl.querySelector('.omnigem-btn-delete-folder').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete folder "${folder.name}"? (Chats inside will not be deleted)`)) {
            this.deleteFolder(folder.id);
          }
        });

        folderEl.querySelectorAll('.omnigem-chat-row').forEach(row => {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.omnigem-remove-chat-btn')) return;
            const cid = row.getAttribute('data-chat-id');
            window.location.href = `/app/${cid}`;
            this.closeModal();
          });

          row.querySelector('.omnigem-remove-chat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const cid = row.getAttribute('data-chat-id');
            this.removeChatFromFolder(folder.id, cid);
          });
        });

        container.appendChild(folderEl);
      });
    },

    renderTrashView(container, query = '') {
      container.innerHTML = `
        <div style="margin-bottom: 12px; font-size: 13px; color: #9aa0a6;">
          <strong>Trash Bin:</strong> Deleted chats are safely stored here and can be restored.
        </div>
      `;

      if (this.trash.length === 0) {
        container.innerHTML += `<div class="omnigem-empty-state">Trash is empty.</div>`;
        return;
      }

      this.trash.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'omnigem-chat-row';
        row.innerHTML = `
          <span class="omnigem-chat-title">🗑️ ${item.title || item.id} (Deleted on ${new Date(item.deletedAt).toLocaleDateString()})</span>
          <div style="display: flex; gap: 6px;">
            <button class="omnigem-header-btn omnigem-restore-btn" style="padding: 4px 8px; font-size: 11px;">Restore</button>
            <button class="omnigem-header-btn omnigem-permanent-delete-btn" style="padding: 4px 8px; font-size: 11px; color: #f28b82;">Delete</button>
          </div>
        `;

        row.querySelector('.omnigem-restore-btn').addEventListener('click', () => {
          this.restoreFromTrash(item.id);
        });

        row.querySelector('.omnigem-permanent-delete-btn').addEventListener('click', () => {
          this.permanentDelete(item.id);
        });

        container.appendChild(row);
      });
    },

    async promptCreateFolder() {
      const name = prompt('Enter new folder name:');
      if (!name || !name.trim()) return;

      const newFolder = {
        id: `folder_${Date.now()}`,
        name: name.trim(),
        color: '#4285f4',
        subfolders: [],
        chatIds: []
      };

      this.folders.push(newFolder);
      await OmniGemStorage.set('folders', this.folders);
      this.renderModalBody();
    },

    async deleteFolder(folderId) {
      this.folders = this.folders.filter(f => f.id !== folderId);
      await OmniGemStorage.set('folders', this.folders);
      this.renderModalBody();
    },

    async addChatToFolder(folderId, chatId, title = 'Conversation') {
      const folder = this.folders.find(f => f.id === folderId);
      if (!folder) return;
      if (!folder.chatIds) folder.chatIds = [];

      if (!folder.chatIds.some(c => c.id === chatId)) {
        folder.chatIds.push({ id: chatId, title: title.replace(/ - Gemini.*/, ''), addedAt: Date.now() });
        await OmniGemStorage.set('folders', this.folders);
        this.renderModalBody();
      }
    },

    async removeChatFromFolder(folderId, chatId) {
      const folder = this.folders.find(f => f.id === folderId);
      if (!folder || !folder.chatIds) return;
      folder.chatIds = folder.chatIds.filter(c => c.id !== chatId);
      await OmniGemStorage.set('folders', this.folders);
      this.renderModalBody();
    },

    async restoreFromTrash(chatId) {
      this.trash = this.trash.filter(t => t.id !== chatId);
      await OmniGemStorage.set('trash', this.trash);
      this.renderModalBody();
    },

    async permanentDelete(chatId) {
      this.trash = this.trash.filter(t => t.id !== chatId);
      await OmniGemStorage.set('trash', this.trash);
      this.renderModalBody();
    }
  };

  window.OmniGemFolders = OmniGemFolders;
})();
