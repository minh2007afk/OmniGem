/**
 * OmniGem Storage Utility
 * Promise-based wrapper around chrome.storage.local with defaults, initial seed data, and change listeners.
 */
(() => {
  'use strict';

  const DEFAULT_PROMPTS = [
    {
      id: 'p_ielts',
      title: 'IELTS Writing Coach',
      tag: 'Writing',
      content: 'Please act as an experienced IELTS examiner. Assess my writing on {{topic}} and provide a detailed band score breakdown (Task Achievement, Coherence, Lexical Resource, Grammar) with actionable improvements:\n\n{{my_text}}'
    },
    {
      id: 'p_code_explain',
      title: 'Code Explainer & Optimizer',
      tag: 'Development',
      content: 'Explain this {{language}} code step-by-step in simple terms, pointing out any algorithmic bottlenecks and providing an optimized version:\n\n```{{language}}\n{{code}}\n```'
    },
    {
      id: 'p_exec_summary',
      title: 'Executive Summary (3 Bullets)',
      tag: 'Productivity',
      content: 'Summarize the core takeaways of the following text into exactly 3 clear, high-impact bullet points:\n\n{{content}}'
    },
    {
      id: 'p_proofread',
      title: 'Polished Proofreader',
      tag: 'Writing',
      content: 'Proofread and polish the text below to make it sound professional and natural for a {{audience}} audience:\n\n{{draft}}'
    }
  ];

  const DEFAULT_CHAINS = [
    {
      id: 'chain_code_review',
      title: 'Deep Code Review & Test Generation',
      description: 'Step 1 audits code architecture -> Step 2 generates complete unit tests.',
      steps: [
        {
          id: 'step_1',
          name: 'Architecture & Vulnerability Audit',
          model: 'Pro',
          prompt: 'Please perform a comprehensive code review of this code snippet, highlighting potential memory/security vulnerabilities and time complexity:\n\n{{code}}'
        },
        {
          id: 'step_2',
          name: 'Generate Unit Tests',
          model: 'Flash',
          prompt: 'Based on the previous code review, write unit tests covering all edge cases, null inputs, and error scenarios.'
        }
      ]
    },
    {
      id: 'chain_blog_post',
      title: 'Full Blog Post Creation',
      description: 'Step 1 builds an outline -> Step 2 drafts the full post with engaging hooks.',
      steps: [
        {
          id: 'step_1',
          name: 'Generate Outline',
          model: 'Flash',
          prompt: 'Create a structured outline with 4 key sections and compelling subheadings for a blog post about: {{topic}}'
        },
        {
          id: 'step_2',
          name: 'Write Complete Article',
          model: 'Pro',
          prompt: 'Now write the full article following the outline above, maintaining an engaging and authoritative tone.'
        }
      ]
    }
  ];

  const DEFAULT_FOLDERS = [
    {
      id: 'folder_work',
      name: 'Work & Projects',
      color: '#4285f4',
      subfolders: [
        { id: 'sub_dev', name: 'Software Development', chatIds: [] },
        { id: 'sub_docs', name: 'Documentation', chatIds: [] }
      ],
      chatIds: []
    },
    {
      id: 'folder_study',
      name: 'Study & Research',
      color: '#34a853',
      subfolders: [],
      chatIds: []
    },
    {
      id: 'folder_daily',
      name: 'Daily & Ideas',
      color: '#fbbc05',
      subfolders: [],
      chatIds: []
    }
  ];

  const DEFAULT_SETTINGS = {
    wideChatEnabled: false,
    timestampsEnabled: true,
    chatNotes: {},
    folders: DEFAULT_FOLDERS,
    trash: [],
    customPrompts: DEFAULT_PROMPTS,
    promptChains: DEFAULT_CHAINS
  };

  const OmniGemStorage = {
    async get(key, defaultValue = null) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[OmniGem Storage] Get error:', chrome.runtime.lastError);
            resolve(defaultValue !== null ? defaultValue : DEFAULT_SETTINGS[key]);
            return;
          }
          if (result && result[key] !== undefined) {
            resolve(result[key]);
          } else {
            const fallback = defaultValue !== null ? defaultValue : DEFAULT_SETTINGS[key];
            if (DEFAULT_SETTINGS[key] !== undefined && (result[key] === undefined)) {
              chrome.storage.local.set({ [key]: fallback });
            }
            resolve(fallback);
          }
        });
      });
    },

    async set(key, value) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            console.error('[OmniGem Storage] Set error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    },

    async setMultiple(obj) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(obj, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    },

    onChanged(callback) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local') {
          callback(changes);
        }
      });
    }
  };

  window.OmniGemStorage = OmniGemStorage;
})();
