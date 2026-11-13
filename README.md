# OmniGem 🚀

> An open-source, client-side productivity extension for Google Gemini (`gemini.google.com`), built with Manifest V3 and Vanilla JavaScript.

OmniGem enriches the Gemini web experience with wide-chat layouts, live quota tracking, conversation folders, reusable prompt templates, automated execution chains, message timestamps, and smart navigation controls.

---

## ✨ Features

- **↔️ Wide Chat Toggle**: Expands the reading and typing containers across the full viewport width while maintaining responsive typography and clean padding.
- **📊 Real-time Quota Tracker**: Displays live 5-hour rolling usage and weekly allowance percentages directly synchronized with Google's `/usage` surface.
- **📁 Conversation Folders & Organization**: Group chats into custom colored categories and subfolders with drag-and-drop support and a safe trash bin (`Alt + F`).
- **💡 Quick Prompt Library**: Save reusable templates, insert them inline with the `//` command, and support variables like `{{variable}}` (`Alt + L`).
- **⛓️ Automated Prompt Chains**: Run multi-step automated sequences triggered inline with `,,`, with progress tracking and automatic waiting for model generation.
- **⏱️ Response Timestamps**: Displays accurate generation timestamps next to every model message.
- **↕️ Smart Scroll Controls**: Dedicated chat-only scroll-to-top, scroll-to-bottom, and double-click Auto-Scroll that follows live generation.

---

## 🛠️ Tech Stack & Architecture

- **Manifest**: Chrome Extension Manifest V3
- **Languages**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Dependencies**: Zero external runtime libraries
- **Storage**: `chrome.storage.local` with multi-tab change synchronization
- **Lifecycle Management**: Native DOM `MutationObserver` and History API router listeners

---

## 🚀 Installation Guide

### Method: Load Unpacked Extension (Developer Mode)

1. Clone or download this repository to your local machine:
   ```bash
   git clone https://github.com/minh2007afk/OmniGem.git
   ```
2. Open any Chromium-based browser (Google Chrome, Brave, Microsoft Edge, Opera).
3. Navigate to the extensions manager page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
4. Toggle on **Developer mode** in the upper-right corner.
5. Click **Load unpacked** (Tải tiện ích đã giải nén).
6. Select the folder containing this repository (the folder containing `manifest.json`).
7. Open [Google Gemini](https://gemini.google.com) and start chatting!

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| `Alt + F` | Open / Close Folders Management Modal |
| `Alt + L` | Open Prompt Library |
| `//` | Trigger Prompt Autocomplete Popup in Chat Input |
| `,,` | Trigger Prompt Chain Autocomplete Popup in Chat Input |
| **Double-Click Down Arrow** | Toggle Live Auto-Scroll |

---

## 📂 Project Structure

```text
OmniGem/
├── assets/
│   └── icons/              # Extension icons (16px, 48px, 128px)
├── rules.json              # DeclarativeNetRequest header modification rules
├── manifest.json           # Manifest V3 extension configuration
├── styles/
│   ├── main.css            # Base tokens and shared variables
│   ├── wide-chat.css       # Full-width viewport layout styling
│   ├── timestamps.css      # Material 3 response timestamp badges
│   ├── sidebar-folders.css # Native sidebar integration and folder modals
│   ├── prompt-library.css  # Prompt library cards and inline autocomplete
│   ├── prompt-chains.css   # Multi-step execution HUD overlay
│   ├── scroll-buttons.css  # Chat-exclusive navigation buttons
│   └── usage-counter.css   # Input toolbar bar and floating quota panel
└── scripts/
    ├── content.js          # Master extension bootstrap script
    ├── utils/
    │   ├── dom-observer.js # SPA routing and mutation observer helpers
    │   └── storage.js      # chrome.storage.local Promise wrapper
    └── modules/
        ├── wide-chat.js    # Wide layout toggling and DOM unclamping
        ├── timestamps.js   # Response timestamp badges injection
        ├── sidebar-folders.js # Folders tree and drag-and-drop
        ├── prompt-library.js  # Templates and inline // completion
        ├── prompt-chains.js   # Automated multi-step prompt chains
        ├── scroll-buttons.js  # Scroll-to-top/bottom and auto-scroller
        └── usage-counter.js   # Live quota reader and input toolbar
```

---

## 🔒 Privacy & Permissions

OmniGem is designed with a strict privacy-first architecture:
- **No telemetry & No remote servers**: All prompt templates, folders, notes, and preferences are stored exclusively on your local machine using `chrome.storage.local`.
- **Domain Restricted**: Host permissions are limited strictly to `*://gemini.google.com/*`.
- **Open Source**: Full source code is transparent and auditable.

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
