// ArkVault Content Script
// Detects which AI platform we're on and extracts conversation

(function() {
  'use strict';

  function detectPlatform() {
    const url = window.location.href;
    if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'ChatGPT';
    if (url.includes('claude.ai')) return 'Claude';
    if (url.includes('gemini.google.com')) return 'Gemini';
    if (url.includes('copilot.microsoft.com') || url.includes('bing.com/chat')) return 'Copilot';
    if (url.includes('grok.com') || url.includes('grok.x.ai') || url.includes('x.com/i/grok')) return 'Grok';
    return null;
  }

  function extractChatGPT() {
    const messages = [];
    // ChatGPT uses article elements for messages
    const articleEls = document.querySelectorAll('article[data-testid*="conversation-turn"]');
    
    if (articleEls.length > 0) {
      articleEls.forEach(el => {
        const roleEl = el.querySelector('[data-message-author-role]');
        const role = roleEl ? roleEl.getAttribute('data-message-author-role') : null;
        const textEl = el.querySelector('.markdown, .whitespace-pre-wrap, [class*="prose"]');
        const text = textEl ? textEl.innerText.trim() : el.innerText.trim();
        if (text && role) {
          messages.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
        }
      });
    } else {
      // Fallback selectors
      const turns = document.querySelectorAll('[data-testid*="conversation-turn"]');
      turns.forEach(turn => {
        const text = turn.innerText.trim();
        const isUser = turn.querySelector('img[alt*="User"]') || turn.querySelector('[data-message-author-role="user"]');
        if (text) {
          messages.push({ role: isUser ? 'user' : 'assistant', content: text });
        }
      });
    }
    return messages;
  }

  function extractClaude() {
    const messages = [];
    // Claude uses specific class patterns
    const humanEls = document.querySelectorAll('[data-testid="human-turn"], .human-turn, [class*="HumanTurn"]');
    const assistantEls = document.querySelectorAll('[data-testid="ai-turn"], .ai-turn, [class*="AssistantTurn"]');

    // Try newer Claude selectors
    const allTurns = document.querySelectorAll('[class*="ConversationItem"], [class*="Message"], .font-claude-message');
    
    if (allTurns.length > 0) {
      allTurns.forEach(turn => {
        const text = turn.innerText.trim();
        if (text.length > 0) {
          const isHuman = turn.closest('[data-testid="human-turn"]') || 
                          turn.className.includes('human') ||
                          turn.closest('[class*="Human"]');
          messages.push({ role: isHuman ? 'user' : 'assistant', content: text });
        }
      });
    } else {
      // Broad fallback
      const containers = document.querySelectorAll('div[class*="message"], div[class*="Message"]');
      containers.forEach(c => {
        const text = c.innerText.trim();
        if (text.length > 10) {
          messages.push({ role: 'unknown', content: text });
        }
      });
    }
    return messages;
  }

  function extractGemini() {
    const messages = [];
    const userEls = document.querySelectorAll('.user-query, [class*="user-query"], .query-text');
    const responseEls = document.querySelectorAll('.response-container, [class*="response"], .model-response-text');

    userEls.forEach(el => {
      const text = el.innerText.trim();
      if (text) messages.push({ role: 'user', content: text });
    });

    responseEls.forEach(el => {
      const text = el.innerText.trim();
      if (text) messages.push({ role: 'assistant', content: text });
    });

    // Sort by DOM order if we have both
    if (messages.length === 0) {
      const all = document.querySelectorAll('[class*="turn"], [class*="message"], [class*="Message"]');
      all.forEach(el => {
        const text = el.innerText.trim();
        if (text.length > 10) {
          messages.push({ role: 'unknown', content: text });
        }
      });
    }

    return messages;
  }

  function extractCopilot() {
    const messages = [];
    const userEls = document.querySelectorAll('[class*="user"], [data-testid*="user"]');
    const botEls = document.querySelectorAll('[class*="bot"], [class*="assistant"], [data-testid*="bot"]');

    userEls.forEach(el => {
      const text = el.innerText.trim();
      if (text.length > 5) messages.push({ role: 'user', content: text });
    });

    botEls.forEach(el => {
      const text = el.innerText.trim();
      if (text.length > 5) messages.push({ role: 'assistant', content: text });
    });

    return messages;
  }

  function extractGrok() {
    const messages = [];

    // Grok uses message bubbles with specific roles
    const turns = document.querySelectorAll('[class*="message"], [class*="Message"], [class*="bubble"], [class*="Bubble"]');

    if (turns.length > 0) {
      turns.forEach(turn => {
        const text = turn.innerText.trim();
        if (text.length < 5) return;
        const isUser = turn.closest('[class*="human"]') ||
                       turn.closest('[class*="user"]') ||
                       turn.closest('[class*="Human"]') ||
                       turn.closest('[class*="User"]') ||
                       turn.getAttribute('data-author') === 'human';
        messages.push({ role: isUser ? 'user' : 'assistant', content: text });
      });
    }

    // Fallback — grab all visible text blocks
    if (messages.length === 0) {
      const blocks = document.querySelectorAll('p, [class*="prose"], [class*="text"]');
      blocks.forEach(b => {
        const text = b.innerText.trim();
        if (text.length > 10) {
          messages.push({ role: 'unknown', content: text });
        }
      });
    }

    return messages;
  }

  function extractConversation() {
    const platform = detectPlatform();
    if (!platform) return null;

    let messages = [];

    switch(platform) {
      case 'ChatGPT': messages = extractChatGPT(); break;
      case 'Claude': messages = extractClaude(); break;
      case 'Gemini': messages = extractGemini(); break;
      case 'Copilot': messages = extractCopilot(); break;
      case 'Grok': messages = extractGrok(); break;
    }

    // Get page title for conversation name
    const title = document.title.replace(' - ChatGPT', '').replace(' | Claude', '').replace(' - Gemini', '').replace(' - Grok', '').replace(' | Grok', '').trim();

    return {
      platform,
      title: title || 'Untitled Conversation',
      url: window.location.href,
      timestamp: new Date().toISOString(),
      messageCount: messages.length,
      messages
    };
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract') {
      const data = extractConversation();
      sendResponse({ success: true, data });
    }
    if (request.action === 'ping') {
      sendResponse({ platform: detectPlatform() });
    }
    return true;
  });

})();
