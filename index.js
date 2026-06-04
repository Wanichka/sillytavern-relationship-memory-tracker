// Relationship Memory Tracker v0.9
// Full replacement file.
// Prompt injection now treats percentages as authoritative,
// but statuses, comments, and Current Dynamic as flexible reference notes.
// Universal parser: no hardcoded user names, no hardcoded character names.
// Handles special spacing character "ㅤ".
// Memory is now stored per chat (keyed by current chat id), with a
// fallback to the old global key when no chat id is available.

import {
    eventSource,
    event_types,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../script.js';

const STORAGE_KEY = 'rm_tracker_memory_v1';
const INJECTION_KEY = 'relationship_memory_tracker_injection';
const DEBUG = false;

function log(...args) {
    if (!DEBUG) return;
    console.log('[Relationship Memory Tracker]', ...args);
}

function getContextSafe() {
    return window.SillyTavern?.getContext?.() || null;
}

function getStorageKey() {
    const context = getContextSafe();
    let chatId = null;

    try {
        chatId = context?.getCurrentChatId?.() ?? context?.chatId ?? null;
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to read chat id:', error);
        chatId = null;
    }

    // No chat id available: fall back to the old global key so nothing breaks.
    if (!chatId) {
        return STORAGE_KEY;
    }

    return `${STORAGE_KEY}::${chatId}`;
}

function getMemory() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to read memory:', error);
        return {};
    }
}

function saveMemory(memory) {
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to save memory:', error);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function stripHtml(value) {
    const div = document.createElement('div');
    div.innerHTML = value ?? '';
    return div.textContent || div.innerText || '';
}

function normalizeText(text) {
    return stripHtml(text)
        .replace(/\r/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/\u3164/g, ' ')
        .replace(/ㅤ/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractRelationshipBlock(text) {
    const plain = normalizeText(text);

    log('Message text snippet:', plain.slice(0, 2200));

    const xmlMatch = plain.match(/<relationship>([\s\S]*?)<\/relationship>/i);
    if (xmlMatch) {
        log('Found XML <relationship> block.');
        return xmlMatch[1].trim();
    }

    const relationshipMatch = plain.match(
        /Relationship(?:\/Friendship)?\s+with\s+.+?\s*=\s*[\s\S]*?(?=\n\s*(CHAR OUTFIT|CHAR_OUTFIT|OUTFIT|MOOD|THOUGHTS|AROUSAL|FATIGUE|PAIN|CYCLE|REGULAR LIKES|LIKES|DISLIKES|SKILLS|STATE)\b|$)/i
    );

    if (relationshipMatch) {
        log('Found Relationship with ... block.');
        return relationshipMatch[0].trim();
    }

    const renderedMatch = plain.match(
        /RELATIONSHIPS([\s\S]*?)(?=\n\s*(CHAR OUTFIT|CHAR_OUTFIT|OUTFIT|MOOD|THOUGHTS|AROUSAL|FATIGUE|PAIN|CYCLE|REGULAR LIKES|LIKES|DISLIKES|SKILLS|STATE)\b|$)/i
    );

    if (renderedMatch) {
        log('Found rendered RELATIONSHIPS block.');
        return renderedMatch[1].trim();
    }

    log('No relationship block found in message.');
    return null;
}

function removeRelationshipPrefix(text) {
    return text
        .replace(/^Relationship(?:\/Friendship)?\s+with\s+.+?\s*=\s*/i, '')
        .trim();
}

function parseAxis(text, axisName) {
    const escapedAxis = axisName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const regex = new RegExp(
        `${escapedAxis}:\\s*\\[?(\\d{1,3})%\\]?\\s*-\\s*\\[?([^\\]\\n\\(]+)\\]?\\s*\\(([^\\)]*)\\)`,
        'i'
    );

    const match = text.match(regex);

    if (!match) return null;

    return {
        value: `${Math.min(Number(match[1]), 100)}%`,
        status: match[2].trim(),
        comment: match[3].trim()
    };
}

function parseCharacterBlock(name, block) {
    const trust = parseAxis(block, 'Trust/Friendship');
    const romance = parseAxis(block, 'Romance/Attraction');
    const hostility = parseAxis(block, 'Hostility/Conflict');

    if (!trust) {
        return null;
    }

    const dynamicMatch = block.match(/Current\s+Dynamic:\s*([^\n]+)/i);

    return {
        name: name.trim(),
        trust: trust?.value || '0%',
        trustStatus: trust?.status || 'Unknown',
        trustComment: trust?.comment || 'No trust comment parsed.',
        romance: romance?.value || '0%',
        romanceStatus: romance?.status || 'Unknown',
        romanceComment: romance?.comment || 'No romance comment parsed.',
        hostility: hostility?.value || '0%',
        hostilityStatus: hostility?.status || 'Unknown',
        hostilityComment: hostility?.comment || 'No hostility comment parsed.',
        dynamic: dynamicMatch ? dynamicMatch[1].trim() : 'No current dynamic parsed.',
        status: 'present',
        lastUpdated: new Date().toISOString()
    };
}

function parseRelationshipBlock(block) {
    const normalized = removeRelationshipPrefix(normalizeText(block));

    log('Relationship block to parse:', normalized);

    const results = [];

    const headerRegex = /(?:^|\n\s*;\s*|\n)([^\n:;]+):\s*(?=\n\s*Trust\/Friendship:)/g;

    const headers = [];
    let match;

    while ((match = headerRegex.exec(normalized)) !== null) {
        headers.push({
            name: match[1].trim(),
            start: match.index,
            contentStart: headerRegex.lastIndex
        });
    }

    log('Detected headers:', headers);

    for (let i = 0; i < headers.length; i++) {
        const current = headers[i];
        const next = headers[i + 1];

        const contentEnd = next ? next.start : normalized.length;
        const characterText = normalized.slice(current.contentStart, contentEnd).trim();

        const parsed = parseCharacterBlock(current.name, characterText);

        if (parsed) {
            results.push(parsed);
        }
    }

    if (results.length === 0 && normalized.includes('Trust/Friendship')) {
        log('Header parser failed. Trying emergency parser.');

        const emergencyRegex = /(?:^|\n\s*;\s*|\n)([^\n:;]+):\s*\n(Trust\/Friendship:[\s\S]*?Current\s+Dynamic:[^\n]*)(?=\n\s*;\s*[^\n:;]+:\s*\nTrust\/Friendship:|\n[^\n:;]+:\s*\nTrust\/Friendship:|$)/g;

        let emergencyMatch;

        while ((emergencyMatch = emergencyRegex.exec(normalized)) !== null) {
            const name = emergencyMatch[1].trim();
            const characterText = emergencyMatch[2].trim();

            const parsed = parseCharacterBlock(name, characterText);

            if (parsed) {
                results.push(parsed);
            }
        }
    }

    log('Parsed characters:', results);
    return results;
}

function updateMemoryFromText(messageText, showAlerts = false) {
    const block = extractRelationshipBlock(messageText);

    if (!block) {
        if (showAlerts) {
            alert('Relationship block was not found. Check Console logs.');
        }
        return false;
    }

    const parsedCharacters = parseRelationshipBlock(block);

    if (parsedCharacters.length === 0) {
        if (showAlerts) {
            alert('Relationship block was found, but no characters were parsed. Check Console logs.');
        }
        return false;
    }

    const memory = getMemory();

    for (const name of Object.keys(memory)) {
        memory[name].status = 'offscreen';
    }

    for (const character of parsedCharacters) {
        memory[character.name] = {
            ...(memory[character.name] || {}),
            ...character
        };
    }

    saveMemory(memory);
    renderPanel();
    updatePromptInjection();

    log(`Updated ${parsedCharacters.length} character(s):`, parsedCharacters.map(x => x.name));
    return true;
}

function getLastAssistantMessageFromContext() {
    const context = getContextSafe();
    const chat = context?.chat;

    if (!Array.isArray(chat) || chat.length === 0) {
        return '';
    }

    for (let i = chat.length - 1; i >= 0; i--) {
        const message = chat[i];

        if (message && !message.is_user && message.mes) {
            log('Last assistant message found in context.chat at index:', i, message);
            return message.mes || '';
        }
    }

    return '';
}

function getLastAssistantMessageFromDom() {
    const possibleSelectors = [
        '#chat .mes[is_user="false"]',
        '#chat .mes:not([is_user="true"])',
        '.mes[is_user="false"]',
        '.mes:not([is_user="true"])',
        '#chat .mes'
    ];

    for (const selector of possibleSelectors) {
        const found = Array.from(document.querySelectorAll(selector));

        if (!found.length) continue;

        const assistantMessages = found.filter((node) => {
            const isUserAttr = node.getAttribute('is_user');
            if (isUserAttr === 'true') return false;

            const className = String(node.className || '');
            if (className.includes('user')) return false;

            return true;
        });

        const messages = assistantMessages.length ? assistantMessages : found;
        const lastMessage = messages[messages.length - 1];

        const text = lastMessage.innerText || lastMessage.textContent || '';

        log('Last assistant message found in DOM with selector:', selector, lastMessage);
        log('Last assistant DOM text snippet:', normalizeText(text).slice(0, 2200));

        return text;
    }

    return '';
}

function getLastAssistantMessageText() {
    const contextText = getLastAssistantMessageFromContext();
    const normalizedContextText = normalizeText(contextText);

    if (
        normalizedContextText.includes('<relationship>') ||
        normalizedContextText.includes('RELATIONSHIPS') ||
        normalizedContextText.includes('Trust/Friendship') ||
        /Relationship(?:\/Friendship)?\s+with\s+.+?\s*=/i.test(normalizedContextText)
    ) {
        return contextText;
    }

    const domText = getLastAssistantMessageFromDom();

    if (domText) {
        return domText;
    }

    if (contextText) {
        return contextText;
    }

    console.warn('[Relationship Memory Tracker] No assistant message found in context.chat or DOM.');
    return '';
}

function parseLastMessageManually() {
    const text = getLastAssistantMessageText();

    if (!text) {
        alert('Could not read last assistant message. Open Console for details.');
        return;
    }

    const ok = updateMemoryFromText(text, true);

    if (ok) {
        alert('Relationship memory updated from last message.');
    }
}

function buildMemoryText() {
    const memory = getMemory();
    const names = Object.keys(memory);

    if (names.length === 0) {
        return '';
    }

    const lines = [];

    lines.push('<relationship_memory>');
    lines.push('Persistent relationship memory.');
    lines.push('This block may include offscreen characters.');
    lines.push('Use saved percentages as the source of truth for returning characters.');
    lines.push('Statuses, comments, and Current Dynamic are reference notes, not fixed labels.');
    lines.push('When a character appears again, keep the saved percentages as the baseline, but update custom statuses, comments, and Current Dynamic to fit the current scene.');
    lines.push('Do not reset returning characters to 0 unless the story clearly justifies it.');
    lines.push('A 0% Romance/Attraction value means no active romantic progress yet, not a permanent ban, unless lore says romance is impossible.');
    lines.push('If a Romance Start moment happens, Romance/Attraction may begin from the saved value according to <relationship_progression>.');
    lines.push('If a character is offscreen, keep their values unchanged unless they appear in the current scene.');
    lines.push('');

    for (const name of names) {
        const item = memory[name];

        lines.push(`${name}:`);
        lines.push(`Trust/Friendship: ${item.trust || '0%'} - ${item.trustStatus || 'Unknown'} (${item.trustComment || 'No comment.'})`);
        lines.push(`Romance/Attraction: ${item.romance || '0%'} - ${item.romanceStatus || 'Unknown'} (${item.romanceComment || 'No comment.'})`);
        lines.push(`Hostility/Conflict: ${item.hostility || '0%'} - ${item.hostilityStatus || 'Unknown'} (${item.hostilityComment || 'No comment.'})`);
        lines.push(`Current Dynamic: ${item.dynamic || 'No current dynamic saved.'}`);
        lines.push(`Status: ${item.status || 'saved'}.`);
        lines.push('');
    }

    lines.push('</relationship_memory>');

    return lines.join('\n');
}

function updatePromptInjection() {
    const memoryText = buildMemoryText();

    if (!memoryText) {
        setExtensionPrompt(
            INJECTION_KEY,
            '',
            extension_prompt_types.IN_CHAT,
            0,
            false,
            extension_prompt_roles.SYSTEM
        );

        log('Prompt injection cleared: no memory.');
        return;
    }

    setExtensionPrompt(
        INJECTION_KEY,
        memoryText,
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.SYSTEM
    );

    log('Prompt injection updated.');
}

function renderPanel() {
    const memory = getMemory();
    const body = document.querySelector('#rm-tracker-body');

    if (!body) return;

    const names = Object.keys(memory);

    if (names.length === 0) {
        body.innerHTML = '<div class="rm-tracker-empty">No relationship memory yet.</div>';
        return;
    }

    body.innerHTML = names.map((name) => {
        const item = memory[name];

        return `
            <div class="rm-tracker-card">
                <div class="rm-tracker-name">${escapeHtml(name)}</div>
                <div class="rm-tracker-row">Trust/Friendship: ${escapeHtml(item.trust || '0%')} - ${escapeHtml(item.trustStatus || 'Unknown')}</div>
                <div class="rm-tracker-row">Romance/Attraction: ${escapeHtml(item.romance || '0%')} - ${escapeHtml(item.romanceStatus || 'Unknown')}</div>
                <div class="rm-tracker-row">Hostility/Conflict: ${escapeHtml(item.hostility || '0%')} - ${escapeHtml(item.hostilityStatus || 'Unknown')}</div>
                <div class="rm-tracker-row">Dynamic: ${escapeHtml(item.dynamic || 'No dynamic saved.')}</div>
                <div class="rm-tracker-row">Status: ${escapeHtml(item.status || 'saved')}</div>
            </div>
        `;
    }).join('');
}

function createUi() {
    if (document.querySelector('#rm-tracker-panel') || document.querySelector('#rm-tracker-button')) {
        return;
    }

    const button = document.createElement('button');
    button.id = 'rm-tracker-button';
    button.type = 'button';
    button.textContent = 'Relationships';

    button.style.position = 'fixed';
    button.style.left = '12px';
    button.style.right = '12px';
    button.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 12px)';
    button.style.width = 'auto';
    button.style.height = '44px';
    button.style.zIndex = '2147483647';
    button.style.display = 'block';
    button.style.visibility = 'visible';
    button.style.opacity = '1';
    button.style.pointerEvents = 'auto';
    button.style.border = 'none';
    button.style.borderRadius = '12px';
    button.style.padding = '10px 12px';
    button.style.background = '#6f6af8';
    button.style.color = '#ffffff';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)';
    button.style.fontWeight = '700';
    button.style.fontSize = '14px';
    button.style.textAlign = 'center';

    const panel = document.createElement('div');
    panel.id = 'rm-tracker-panel';
    panel.style.display = 'none';

    panel.innerHTML = `
        <div id="rm-tracker-header">
            <div id="rm-tracker-title">Relationship Memory</div>
            <button id="rm-tracker-close" type="button">×</button>
        </div>
        <div id="rm-tracker-body"></div>
        <div id="rm-tracker-actions">
            <button id="rm-tracker-parse" type="button">Parse Last</button>
            <button id="rm-tracker-clear" type="button">Clear</button>
            <button id="rm-tracker-copy" type="button">Copy</button>
        </div>
    `;

    document.documentElement.appendChild(button);
    document.documentElement.appendChild(panel);

    button.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        renderPanel();
    });

    document.querySelector('#rm-tracker-close').addEventListener('click', () => {
        panel.style.display = 'none';
    });

    document.querySelector('#rm-tracker-parse').addEventListener('click', () => {
        parseLastMessageManually();
    });

    document.querySelector('#rm-tracker-clear').addEventListener('click', () => {
        const confirmed = confirm('Clear all saved relationship memory?');
        if (!confirmed) return;

        localStorage.removeItem(getStorageKey());
        renderPanel();
        updatePromptInjection();
        log('Memory cleared.');
    });

    document.querySelector('#rm-tracker-copy').addEventListener('click', async () => {
        const text = buildMemoryText();

        if (!text) {
            alert('No relationship memory to copy.');
            return;
        }

        await navigator.clipboard.writeText(text);
        alert('Relationship memory copied.');
    });
}

function handleIncomingMessage(data) {
    log('MESSAGE_RECEIVED event:', data);

    let messageText = '';

    if (typeof data === 'string') {
        messageText = data;
    } else if (data?.mes) {
        messageText = data.mes;
    } else if (data?.message?.mes) {
        messageText = data.message.mes;
    } else if (data?.message) {
        messageText = String(data.message);
    }

    if (!messageText) {
        messageText = getLastAssistantMessageText();
    }

    if (!messageText) {
        console.warn('[Relationship Memory Tracker] Could not read incoming message text.');
        return;
    }

    updateMemoryFromText(messageText, false);
}

function handleBeforeGeneration() {
    updatePromptInjection();
}

function handleChatChanged() {
    // Chat switched: refresh the panel and injection for the new chat's memory.
    renderPanel();
    updatePromptInjection();
}

function init() {

    log('Extension loaded.');

    createUi();
    renderPanel();
    updatePromptInjection();

    eventSource.on(event_types.MESSAGE_RECEIVED, handleIncomingMessage);
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, handleBeforeGeneration);
    eventSource.on(event_types.GENERATION_STARTED, handleBeforeGeneration);
    eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);

    log('Listening for MESSAGE_RECEIVED.');
    log('Prompt injection hook enabled.');
}

setTimeout(init, 1000);
