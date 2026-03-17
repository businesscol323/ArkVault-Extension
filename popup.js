// ArkVault Popup Script
// Handles all vault logic, local storage, and UI interactions

'use strict';

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────

async function getVaults() {
  return new Promise(resolve => {
    chrome.storage.local.get(['vaults'], result => {
      resolve(result.vaults || []);
    });
  });
}

async function saveVaults(vaults) {
  return new Promise(resolve => {
    chrome.storage.local.set({ vaults }, resolve);
  });
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────

function showStatus(msg, type = 'info', duration = 3000) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = `status-msg show ${type}`;
  if (duration) setTimeout(() => el.className = 'status-msg', duration);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function platformShort(platform) {
  const map = { ChatGPT: 'GPT', Claude: 'CLDE', Gemini: 'GEM', Copilot: 'CPLT', Grok: 'GROK' };
  return map[platform] || platform.substring(0, 4).toUpperCase();
}

// ─── RENDER VAULT LIST ────────────────────────────────────────────────────────

async function renderVaultList(listId = 'vaultList') {
  const vaults = await getVaults();
  const list = document.getElementById(listId);
  if (!list) return;

  if (vaults.length === 0) {
    list.innerHTML = '<div class="empty-vault">No vaults yet — vault your first conversation above</div>';
    return;
  }

  // Show most recent first
  const sorted = [...vaults].reverse();
  list.innerHTML = sorted.slice(0, 20).map((v, i) => `
    <div class="vault-item" data-index="${vaults.length - 1 - i}" title="${v.title}">
      <div class="vault-item-left">
        <div class="vault-title">${escapeHtml(v.title)}</div>
        <div class="vault-meta">${formatDate(v.timestamp)} · ${v.messageCount} msgs</div>
      </div>
      <div class="vault-platform-badge">${platformShort(v.platform)}</div>
    </div>
  `).join('');

  // Click to export individual vault
  list.querySelectorAll('.vault-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      exportSingleVault(vaults[idx]);
    });
  });
}

// ─── STATS ────────────────────────────────────────────────────────────────────

async function renderStats() {
  const vaults = await getVaults();
  const platforms = new Set(vaults.map(v => v.platform)).size;

  ['totalVaults', 'totalVaults2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = vaults.length;
  });

  ['totalPlatforms', 'totalPlatforms2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = platforms;
  });
}

// ─── ESCAPE HTML ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── EXPORT HELPERS ───────────────────────────────────────────────────────────

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadMarkdown(vaults, filename) {
  let md = `# ArkVault Export\n\nExported: ${new Date().toLocaleString()}\nTotal Conversations: ${vaults.length}\n\n---\n\n`;

  vaults.forEach((v, i) => {
    md += `## ${i + 1}. ${v.title}\n\n`;
    md += `**Platform:** ${v.platform}  \n`;
    md += `**Date:** ${formatDate(v.timestamp)}  \n`;
    md += `**Messages:** ${v.messageCount}  \n\n`;

    v.messages.forEach(m => {
      const role = m.role === 'user' ? '👤 **You**' : '🤖 **AI**';
      md += `${role}\n\n${m.content}\n\n---\n\n`;
    });
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSingleVault(vault) {
  const filename = `arkvault-${vault.platform.toLowerCase()}-${Date.now()}.json`;
  downloadJSON(vault, filename);
  showStatus(`↓ Downloaded: ${vault.title.substring(0, 30)}...`, 'ok', 3000);
}

async function exportAllVaults() {
  const vaults = await getVaults();
  if (vaults.length === 0) {
    showStatus('No vaults to export yet.', 'err', 3000);
    return;
  }

  const exportData = {
    exported_at: new Date().toISOString(),
    exported_by: 'ArkVault Chrome Extension v1.0.0',
    total_conversations: vaults.length,
    platforms: [...new Set(vaults.map(v => v.platform))],
    conversations: vaults
  };

  downloadJSON(exportData, `arkvault-full-export-${Date.now()}.json`);
  showStatus(`↓ Exported ${vaults.length} vault${vaults.length > 1 ? 's' : ''}`, 'ok', 3000);
}

// ─── VAULT ACTION ─────────────────────────────────────────────────────────────

async function vaultCurrentConversation(tab) {
  const btn = document.getElementById('vaultBtn');
  btn.disabled = true;
  btn.textContent = '⬡ Extracting...';
  showStatus('Reading conversation...', 'info', 0);

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'extract' }, resp => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    });

    if (!response || !response.success || !response.data) {
      throw new Error('Could not read conversation. Try scrolling to load all messages first.');
    }

    const data = response.data;

    if (!data.messages || data.messages.length === 0) {
      throw new Error('No messages found. Make sure the conversation is fully loaded.');
    }

    // Save to local storage
    const vaults = await getVaults();
    
    // Check for duplicate (same URL within last 60 seconds)
    const recent = vaults.find(v => v.url === data.url && 
      (Date.now() - new Date(v.timestamp).getTime()) < 60000);
    
    if (recent) {
      showStatus('Already vaulted this conversation recently.', 'info', 3000);
      btn.disabled = false;
      btn.textContent = '⬡ Vault This Conversation';
      return;
    }

    vaults.push(data);
    await saveVaults(vaults);

    // Update UI
    btn.className = 'vault-btn success';
    btn.textContent = `✓ Vaulted ${data.messageCount} Messages`;
    showStatus(`✓ Saved: "${data.title.substring(0, 40)}"`, 'ok', 4000);

    await renderStats();
    await renderVaultList('vaultList');

    setTimeout(() => {
      btn.className = 'vault-btn';
      btn.disabled = false;
      btn.textContent = '⬡ Vault This Conversation';
    }, 3000);

  } catch (err) {
    btn.className = 'vault-btn error';
    btn.textContent = '✕ Vault Failed';
    showStatus(err.message || 'Failed to extract conversation.', 'err', 5000);

    setTimeout(() => {
      btn.className = 'vault-btn';
      btn.disabled = false;
      btn.textContent = '⬡ Vault This Conversation';
    }, 3000);
  }
}

// ─── CLEAR VAULT ──────────────────────────────────────────────────────────────

async function clearAllVaults() {
  const vaults = await getVaults();
  if (vaults.length === 0) {
    showStatus('Vault is already empty.', 'info', 3000);
    return;
  }

  // Simple confirm
  const confirmed = confirm(`Clear all ${vaults.length} vaulted conversation${vaults.length > 1 ? 's' : ''}? This cannot be undone.`);
  if (!confirmed) return;

  await saveVaults([]);
  showStatus('Vault cleared.', 'ok', 3000);
  await renderStats();
  await renderVaultList('vaultList');
  await renderVaultList('vaultList2');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  const supportedDomains = [
    'chat.openai.com', 'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
    'copilot.microsoft.com', 'bing.com/chat',
    'grok.com', 'grok.x.ai', 'x.com/i/grok'
  ];

  const isSupported = supportedDomains.some(d => url.includes(d));

  // Detect platform name
  let platformName = 'Not Detected';
  let platformActive = false;

  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) {
    platformName = 'ChatGPT'; platformActive = true;
  } else if (url.includes('claude.ai')) {
    platformName = 'Claude'; platformActive = true;
  } else if (url.includes('gemini.google.com')) {
    platformName = 'Gemini'; platformActive = true;
  } else if (url.includes('copilot.microsoft.com') || url.includes('bing.com/chat')) {
    platformName = 'Copilot'; platformActive = true;
  } else if (url.includes('grok.com') || url.includes('grok.x.ai') || url.includes('x.com/i/grok')) {
    platformName = 'Grok'; platformActive = true;
  }

  // Update platform bar
  document.getElementById('platformName').textContent = platformName;
  if (platformActive) {
    document.getElementById('platformDot').className = 'platform-dot';
  }

  // Show correct view
  if (isSupported) {
    document.getElementById('supportedView').style.display = 'block';
    document.getElementById('notSupportedView').style.display = 'none';

    // Vault button
    document.getElementById('vaultBtn').addEventListener('click', () => {
      vaultCurrentConversation(tab);
    });

    // Export button
    document.getElementById('exportBtn').addEventListener('click', exportAllVaults);

    // Clear button
    document.getElementById('clearBtn').addEventListener('click', clearAllVaults);

    await renderVaultList('vaultList');
  } else {
    document.getElementById('supportedView').style.display = 'none';
    document.getElementById('notSupportedView').style.display = 'block';

    // Export button (not supported view)
    document.getElementById('exportBtn2').addEventListener('click', exportAllVaults);

    // Clear button (not supported view)
    document.getElementById('clearBtn2').addEventListener('click', clearAllVaults);

    await renderVaultList('vaultList2');
  }

  await renderStats();
}

document.addEventListener('DOMContentLoaded', init);
