// Relationship Memory Tracker v2.2
// Full replacement file.
// v2.2: Storage moved to SillyTavern chat metadata (lives in the chat file on
//   the server: survives browser cache clearing, travels with chat backups).
//   Dual-write: every save also mirrors to localStorage as a warm local backup.
//   Read priority: chat metadata first; if its slot is empty, memory is seeded
//   ONCE from localStorage (existing non-empty metadata is never overwritten
//   by localStorage). If the metadata API is unavailable (no chat open yet,
//   or an incompatible SillyTavern version), the tracker quietly runs on
//   localStorage alone, exactly like v2.1 — with a one-time console warning
//   when a chat is open but metadata cannot be reached.
// v2.1: Panel header shows a character counter: "Relationship Memory (N)".
//   Axis rows show the saved comment as a hover tooltip (title attribute),
//   so cards stay compact but full comments are visible on desktop.
// v2.0: Romance/Attraction is split into two independent axes:
//   Love/Affection  — emotional attachment: being in love, tenderness, longing,
//                     the need for this specific person's closeness.
//   Desire/Attraction — physical pull: desire, tension, reaction to body/voice/touch.
// Old saved memory migrates automatically on first read per chat:
//   romance -> love (values, status, comment preserved),
//   desire  -> "Not yet assessed" until the character next appears in a scene.
// Parser accepts BOTH formats during transition: if a post still uses the old
// "Romance/Attraction" line, it is read as Love/Affection.
// Behavior change: an axis missing from a post no longer resets to 0% —
// the previously saved value is kept (only axes actually present overwrite).
// v1.7.1: parser handles "; Name:" glued to the end of the previous
// Current Dynamic line.
// v1.7: hardened absence rule — bans placeholder lines (*offscreen* etc.),
// presence measured at END of post.
// Injected memory explicitly separates "remember everyone" from "show only
// those present": absent characters stay in memory but must be omitted from the
// visible info blocks.
// Draggable panel bounded to the viewport (tablet-safe).
// Jealousy axis; per-character delete buttons.
// parseAxis: the trailing "(comment)" on each axis line is optional.
// Prompt injection treats percentages as authoritative,
// but statuses, comments, and Current Dynamic as flexible reference notes.
// Universal parser: no hardcoded user names, no hardcoded character names.
// Handles special spacing character "ㅤ".
// Memory is keyed per chat. Primary store: chat metadata (v2.2+);
// mirror/fallback: localStorage (per-chat key, with the old global key
// when no chat id is available).

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

/* ------------------------------ storage layer ------------------------------ */

// Key inside the chat metadata object. Metadata is serialized into the chat
// file on the SillyTavern server, so this survives browser cache clearing and
// travels together with chat backups/exports.
const METADATA_KEY = 'rm_tracker_memory';

let warnedMetadataUnavailable = false;

function getChatMetadataSafe() {
    const context = getContextSafe();

    // API name differs between SillyTavern versions.
    const meta = context?.chatMetadata ?? context?.chat_metadata ?? null;

    return (meta && typeof meta === 'object') ? meta : null;
}

// Ask SillyTavern to persist chat metadata to the server. API name differs
// between versions; if neither exists, the write stays in-memory only (the
// localStorage mirror still guarantees nothing is lost on this device).
function persistChatMetadata() {
    const context = getContextSafe();

    try {
        if (typeof context?.saveMetadata === 'function') {
            context.saveMetadata();
            return true;
        }

        if (typeof context?.saveMetadataDebounced === 'function') {
            context.saveMetadataDebounced();
            return true;
        }
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to persist chat metadata:', error);
    }

    return false;
}

function readLocalStorageMemory() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to read localStorage memory:', error);
        return null;
    }
}

// One-time per-chat migration from the single Romance/Attraction axis to the
// Love/Affection + Desire/Attraction split. Runs on every read, but only
// converts records that still carry the old "romance" field, so after the
// first pass it is a no-op.
function migrateMemory(memory) {
    let changed = false;

    for (const name of Object.keys(memory)) {
        const item = memory[name];

        if (!item || typeof item !== 'object') continue;

        if (item.love === undefined && item.romance !== undefined) {
            item.love = item.romance;
            item.loveStatus = item.romanceStatus;
            item.loveComment = item.romanceComment;

            // Desire starts unknown; the first parse after the character
            // appears in a scene will fill it with a real value.
            item.desire = '0%';
            item.desireStatus = 'Not yet assessed';
            item.desireComment = 'Migrated from single Romance axis; desire not measured yet.';

            delete item.romance;
            delete item.romanceStatus;
            delete item.romanceComment;

            changed = true;
        }
    }

    return changed;
}

function getMemory() {
    let memory = null;

    const meta = getChatMetadataSafe();

    if (meta) {
        const stored = meta[METADATA_KEY];

        if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.keys(stored).length > 0) {
            // Primary source of truth.
            memory = stored;
        } else {
            // Metadata slot is empty: seed it ONCE from localStorage.
            // This is the automatic v2.1 -> v2.2 migration. It only ever runs
            // into an EMPTY slot — localStorage never overwrites existing
            // metadata, so a stale local copy cannot roll back real progress.
            const local = readLocalStorageMemory();

            if (local && Object.keys(local).length > 0) {
                meta[METADATA_KEY] = local;
                persistChatMetadata();
                memory = local;
                log('Seeded chat metadata from localStorage backup.');
            }
        }
    } else {
        // Metadata unavailable. Normal during page boot / chat switching;
        // suspicious if a chat is actually open — warn once so it is visible.
        let chatId = null;
        try {
            const context = getContextSafe();
            chatId = context?.getCurrentChatId?.() ?? context?.chatId ?? null;
        } catch (e) { /* ignore */ }

        if (chatId && !warnedMetadataUnavailable) {
            console.warn('[Relationship Memory Tracker] Chat metadata unavailable; running on localStorage fallback.');
            warnedMetadataUnavailable = true;
        }
    }

    if (!memory) {
        memory = readLocalStorageMemory() || {};
    }

    if (migrateMemory(memory)) {
        saveMemory(memory);
        log('Memory migrated to Love/Desire format.');
    }

    return memory;
}

// Dual-write: chat metadata is the source of truth, localStorage is a warm
// local backup (and the only store when metadata is unavailable).
function saveMemory(memory) {
    const meta = getChatMetadataSafe();

    if (meta) {
        meta[METADATA_KEY] = memory;
        persistChatMetadata();
    }

    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(memory, null, 2));
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to save memory to localStorage:', error);
    }
}

// Full wipe for the current chat: both stores at once, so a cleared chat does
// not resurrect from the localStorage mirror on the next read.
function clearMemory() {
    const meta = getChatMetadataSafe();

    if (meta && METADATA_KEY in meta) {
        delete meta[METADATA_KEY];
        persistChatMetadata();
    }

    try {
        localStorage.removeItem(getStorageKey());
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to clear localStorage memory:', error);
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

    // Trailing "(comment)" is OPTIONAL. If it were required, an axis line
    // without a parenthetical (e.g. "79% - Глубокое Доверие" or the new
    // single-sentence Internal Feeling format) would fail to match, and since
    // Trust is the required axis the whole character would be dropped.
    const regex = new RegExp(
        `${escapedAxis}:\\s*\\[?(\\d{1,3})%\\]?\\s*-\\s*\\[?([^\\]\\n\\(]+)\\]?(?:\\s*\\(([^\\)]*)\\))?`,
        'i'
    );

    const match = text.match(regex);

    if (!match) return null;

    return {
        value: `${Math.min(Number(match[1]), 100)}%`,
        status: match[2].trim(),
        comment: (match[3] || '').trim()
    };
}

function parseCharacterBlock(name, block) {
    const trust = parseAxis(block, 'Trust/Friendship');

    if (!trust) {
        return null;
    }

    // New split axes. During the transition Gemini may still emit the old
    // "Romance/Attraction" line — read it as Love/Affection so no data is lost.
    const love = parseAxis(block, 'Love/Affection') || parseAxis(block, 'Romance/Attraction');
    const desire = parseAxis(block, 'Desire/Attraction');
    const hostility = parseAxis(block, 'Hostility/Conflict');
    const jealousy = parseAxis(block, 'Jealousy');

    const dynamicMatch = block.match(/Current\s+Dynamic:\s*([^\n]+)/i);

    const parsed = {
        name: name.trim(),
        trust: trust.value,
        trustStatus: trust.status,
        trustComment: trust.comment,
        dynamic: dynamicMatch ? dynamicMatch[1].trim() : 'No current dynamic parsed.',
        status: 'present',
        lastUpdated: new Date().toISOString()
    };

    // Only include axes that were actually present in this post. Missing axes
    // are simply not overwritten, so the previously saved value survives the
    // spread in updateMemoryFromText instead of being reset to 0%.
    if (love) {
        parsed.love = love.value;
        parsed.loveStatus = love.status;
        parsed.loveComment = love.comment;
    }

    if (desire) {
        parsed.desire = desire.value;
        parsed.desireStatus = desire.status;
        parsed.desireComment = desire.comment;
    }

    if (hostility) {
        parsed.hostility = hostility.value;
        parsed.hostilityStatus = hostility.status;
        parsed.hostilityComment = hostility.comment;
    }

    if (jealousy) {
        parsed.jealousy = jealousy.value;
        parsed.jealousyStatus = jealousy.status;
        parsed.jealousyComment = jealousy.comment;
    }

    return parsed;
}

function parseRelationshipBlock(block) {
    let normalized = removeRelationshipPrefix(normalizeText(block));

    // Gemini sometimes glues the next character's name to the end of the
    // previous "Current Dynamic" line: "...business here.; Ikkaku:\nTrust/Friendship:".
    // Move such names onto their own line so the header regex can find them,
    // and so the previous character's Current Dynamic is not polluted.
    normalized = normalized.replace(
        /;\s*([^\n:;]+):\s*(?=\n\s*Trust\/Friendship:)/gi,
        '\n$1:'
    );

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

// Axis line for the injection. With the Internal Feeling format the whole
// sentence lives in the "status" slot and the parenthetical comment is often
// absent — omit empty "()" instead of printing "(No comment.)".
function formatAxisLine(label, value, status, comment) {
    const line = `${label}: ${value || '0%'} - ${status || 'Unknown'}`;
    return comment ? `${line} (${comment})` : line;
}

function buildMemoryText() {
    const memory = getMemory();
    const names = Object.keys(memory);

    if (names.length === 0) {
        return '';
    }

    const lines = [];

    lines.push('<relationship_memory>');
    lines.push('This is a HIDDEN long-term memory store, not a scene roster. It lists ALL known characters, including ones not currently present.');
    lines.push('CRITICAL: This block is for your reference only. Do NOT treat it as the list of characters to write about.');
    lines.push('In the visible info blocks (<relationship>, char_mood, char_thoughts, char_outfit, etc.) include ONLY characters who are physically present in the CURRENT scene.');
    lines.push('A character listed here who is NOT physically present at the END of the current post must be OMITTED from every info block ENTIRELY.');
    lines.push('Do not list absent characters at all — not even with placeholders like *offscreen*, *absent*, *N/A*, or an empty value. An absent character has NO line in any info block.');
    lines.push('If a character was in the scene earlier in the post but left before its end, they count as absent.');
    lines.push('Keep the saved memory of absent characters unchanged; simply do not output them.');
    lines.push('The "Status" and "Current Dynamic" fields here describe saved memory, not presence — never use them as a reason to write an absent character into an info block.');
    lines.push('Use saved percentages as the source of truth for returning characters.');
    lines.push('Statuses, comments, and Current Dynamic are reference notes, not fixed labels.');
    lines.push('When a character appears again, keep the saved percentages as the baseline, but update the feeling descriptions and Current Dynamic to fit the current scene.');
    lines.push('Do not reset returning characters to 0 unless the story clearly justifies it.');
    lines.push('Love/Affection and Desire/Attraction are INDEPENDENT axes: Love is emotional attachment (being in love, tenderness, longing for this person); Desire is physical pull (attraction, tension, wanting). One can be high while the other is low.');
    lines.push('A 0% Love/Affection value means no active romantic progress yet, not a permanent ban, unless lore says romance is impossible.');
    lines.push('If a Romance Start moment happens, Love/Affection may begin from the saved value according to <relationship_progression>.');
    lines.push('A Desire/Attraction value marked "Not yet assessed" was never measured: when that character next appears, evaluate it fresh from their personality, history, and the saved Love/Affection — do not treat it as a confirmed zero.');
    lines.push('');

    for (const name of names) {
        const item = memory[name];

        lines.push(`${name}:`);
        lines.push(formatAxisLine('Trust/Friendship', item.trust, item.trustStatus, item.trustComment));
        lines.push(formatAxisLine('Love/Affection', item.love, item.loveStatus, item.loveComment));
        lines.push(formatAxisLine('Desire/Attraction', item.desire, item.desireStatus, item.desireComment));
        lines.push(formatAxisLine('Hostility/Conflict', item.hostility, item.hostilityStatus, item.hostilityComment));
        lines.push(formatAxisLine('Jealousy', item.jealousy, item.jealousyStatus, item.jealousyComment));
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

function deleteCharacter(name) {
    if (name == null) return;

    const confirmed = confirm(`Delete relationship memory for "${name}"?`);
    if (!confirmed) return;

    const memory = getMemory();

    if (!(name in memory)) {
        log('Tried to delete a character that is not in memory:', name);
        return;
    }

    delete memory[name];
    saveMemory(memory);
    renderPanel();
    updatePromptInjection();

    log('Deleted character:', name);
}

// Panel row for one axis. The comment is not printed in the card (cards stay
// compact); instead it goes into the title attribute so it shows as a hover
// tooltip on desktop. escapeHtml also escapes quotes, so it is attribute-safe.
function axisRow(label, value, status, comment) {
    const tooltip = comment ? ` title="${escapeHtml(comment)}"` : '';
    return `<div class="rm-tracker-row"${tooltip}>${label}: ${escapeHtml(value || '0%')} - ${escapeHtml(status || 'Unknown')}</div>`;
}

function updatePanelCounter(count) {
    const titleEl = document.querySelector('#rm-tracker-title');
    if (titleEl) {
        titleEl.textContent = `Relationship Memory (${count})`;
    }
}

function renderPanel() {
    const memory = getMemory();
    const body = document.querySelector('#rm-tracker-body');

    if (!body) return;

    const names = Object.keys(memory);

    updatePanelCounter(names.length);

    if (names.length === 0) {
        body.innerHTML = '<div class="rm-tracker-empty">No relationship memory yet.</div>';
        return;
    }

    body.innerHTML = names.map((name, index) => {
        const item = memory[name];

        return `
            <div class="rm-tracker-card" data-rm-index="${index}">
                <div class="rm-tracker-card-head">
                    <div class="rm-tracker-name">${escapeHtml(name)}</div>
                    <button class="rm-tracker-delete" type="button" data-rm-index="${index}" title="Delete this memory" aria-label="Delete this memory">×</button>
                </div>
                ${axisRow('Trust/Friendship', item.trust, item.trustStatus, item.trustComment)}
                ${axisRow('Love/Affection', item.love, item.loveStatus, item.loveComment)}
                ${axisRow('Desire/Attraction', item.desire, item.desireStatus, item.desireComment)}
                ${axisRow('Hostility/Conflict', item.hostility, item.hostilityStatus, item.hostilityComment)}
                ${axisRow('Jealousy', item.jealousy, item.jealousyStatus, item.jealousyComment)}
                <div class="rm-tracker-row">Dynamic: ${escapeHtml(item.dynamic || 'No dynamic saved.')}</div>
                <div class="rm-tracker-row">Status: ${escapeHtml(item.status || 'saved')}</div>
            </div>
        `;
    }).join('');

    // Wire up the per-card delete buttons. Names are looked up by index to
    // avoid any escaping issues with special characters in character names.
    body.querySelectorAll('.rm-tracker-delete').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-rm-index'));
            const name = names[idx];
            deleteCharacter(name);
        });
    });
}

/* ------------------------------- draggable UI ------------------------------- */

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Keep a dragged element on-screen. The top margin ensures the draggable
// header can never hide under a floating browser toolbar (tablet/mobile).
const DRAG_EDGE = 8;
const DRAG_TOP_MARGIN = 50;

function clampToViewport(el, left, top) {
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const maxLeft = Math.max(DRAG_EDGE, window.innerWidth - w - DRAG_EDGE);
    const maxTop = Math.max(DRAG_TOP_MARGIN, window.innerHeight - h - DRAG_EDGE);
    return {
        left: clamp(left, DRAG_EDGE, maxLeft),
        top: clamp(top, DRAG_TOP_MARGIN, maxTop),
    };
}

function applyPosition(el, left, top) {
    // Inline !important beats the fixed-position rules (and the mobile media
    // query) in style.css, so a dragged element actually moves.
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('top', `${top}px`, 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
}

function restorePosition(el, storageKey) {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            const p = clampToViewport(el, saved.left, saved.top);
            applyPosition(el, p.left, p.top);
        }
    } catch (error) {
        console.error('[Relationship Memory Tracker] Failed to restore position:', error);
    }
}

// Drag `el` by `handle`; remembers position. Inner <button>s in the handle
// (e.g. the close button) keep working.
function makeDraggable(el, { storageKey, handle = el } = {}) {
    restorePosition(el, storageKey);
    handle.style.touchAction = 'none';

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    handle.addEventListener('pointerdown', (event) => {
        const innerButton = event.target.closest('button');
        if (innerButton && innerButton !== el) return;
        if (event.button != null && event.button !== 0) return;

        dragging = true;
        moved = false;
        const rect = el.getBoundingClientRect();
        baseLeft = rect.left;
        baseTop = rect.top;
        startX = event.clientX;
        startY = event.clientY;
        try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    });

    handle.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        moved = true;
        const p = clampToViewport(el, baseLeft + dx, baseTop + dy);
        applyPosition(el, p.left, p.top);
    });

    function finish(event) {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        if (moved) {
            const rect = el.getBoundingClientRect();
            try {
                localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
            } catch (e) { /* ignore */ }
        }
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
}

function createUi() {
    if (document.querySelector('#rm-tracker-panel')) {
        return;
    }

    const button = document.createElement('button');
    button.id = 'rm-tracker-button';
    button.textContent = 'Relationships';
    document.body.appendChild(button);

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

    document.body.appendChild(panel);

    makeDraggable(panel, {
        storageKey: 'rm_tracker_panel_pos',
        handle: panel.querySelector('#rm-tracker-header'),
    });

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

        clearMemory();
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
