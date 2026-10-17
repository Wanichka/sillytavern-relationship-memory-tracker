const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot() {
    const meta = {};
    const local = new Map();
    const context = { chatMetadata: meta, chatId: 'chat-a', saveMetadata() {} };
    const injections = [];
    const sandbox = {
        console, URL, Date, setTimeout() {}, setInterval() {}, clearInterval() {},
        window: { SillyTavern: { getContext: () => context } },
        document: {
            querySelector: () => null,
            createElement: () => ({ set innerHTML(value) { this.textContent = String(value).replace(/<[^>]+>/g, ''); } }),
        },
        localStorage: {
            getItem: key => local.get(key) ?? null,
            setItem: (key, value) => local.set(key, value),
            removeItem: key => local.delete(key),
        },
        setExtensionPrompt(...args) { injections.push(args); },
        extension_prompt_types: { IN_CHAT: 1 }, extension_prompt_roles: { SYSTEM: 0 },
        confirm: () => true,
    };
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';/g, '')
        .replace('setTimeout(init, 1000);', '');
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { api: sandbox, context, meta, local, injections };
}

function person(name, trust = '50%') {
    return { name, trust, trustStatus: 'Known', love: '10%', loveStatus: 'Close', status: 'present' };
}

test('a card can move from position 40 to first and stay there in chat metadata', () => {
    const { api, context, local } = boot();
    const memory = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`Person ${index + 1}`, person(`Person ${index + 1}`)]));
    api.saveMemory(memory);
    const names = Object.keys(memory);
    assert.equal(api.reorderMemory([names[39], ...names.slice(0, 39)]), true);
    assert.equal(Object.keys(api.getMemory())[0], 'Person 40');
    assert.equal(Object.keys(JSON.parse(local.get('rm_tracker_memory_v1::chat-a')))[0], 'Person 40');
    assert.equal(api.reorderMemory(['Person 1']), false);
    context.chatId = 'chat-b';
    context.chatMetadata = {};
    assert.equal(Object.keys(api.getMemory()).length, 0);
});

test('alternate name updates the chosen card while the old duplicate remains until manually deleted', () => {
    const { api } = boot();
    api.saveMemory({ 'Трафальгар Ло': person('Трафальгар Ло', '90%'), 'Ло': person('Ло', '80%') });
    assert.equal(api.setMemoryAliases('Трафальгар Ло', api.parseAliases('Ло, Trafalgar Law, ло', 'Трафальгар Ло')).ok, true);
    assert.deepEqual([...api.getMemory()['Трафальгар Ло'].aliases], ['Ло', 'Trafalgar Law']);
    assert.equal(api.memoryOwner(api.getMemory(), '  ЛО  '), 'Трафальгар Ло');
    const block = 'Relationship with Alice = Ло:\nTrust/Friendship: [100%] - [Полное доверие]\nCurrent Dynamic: Вернулся.';
    assert.equal(api.updateMemoryFromText(block), true);
    assert.equal(api.getMemory()['Трафальгар Ло'].trust, '100%');
    assert.equal(api.getMemory()['Ло'].trust, '80%');
    api.deleteCharacter('Ло');
    assert.equal(api.getMemory()['Ло'], undefined);
    assert.equal(api.memoryOwner(api.getMemory(), 'Ло'), 'Трафальгар Ло');
});

test('names are per chat and competing aliases cannot steal an assigned character', () => {
    const { api, context } = boot();
    api.saveMemory({ Law: person('Law'), Klion: person('Klion') });
    assert.equal(api.setMemoryAliases('Law', ['Ло']).ok, true);
    assert.equal(api.setMemoryAliases('Klion', ['Ло']).ok, false);
    context.chatId = 'chat-b';
    context.chatMetadata = {};
    api.saveMemory({ Klion: person('Klion') });
    assert.equal(api.memoryOwner(api.getMemory(), 'Ло'), 'Ло');
});

test('high attraction survives the new guidance and stale behavioral notes stay out of the generated prompt', () => {
    const { api, injections } = boot();
    api.saveMemory({ Law: {
        ...person('Law', '90%'), desire: '94%', desireStatus: 'OLD_STATUS_SENTINEL',
        desireComment: 'OLD_COMMENT_SENTINEL', dynamic: 'OLD_SCENE_SENTINEL',
    } });
    const before = JSON.stringify(api.getMemory());
    api.updatePromptInjection();
    const prompt = injections.at(-1)[1];
    assert.equal(prompt, api.buildMemoryText());
    assert.match(prompt, /^Desire\/Attraction: 94%$/m);
    assert.doesNotMatch(prompt, /OLD_(?:STATUS|COMMENT|SCENE)_SENTINEL|Status: present/);
    assert.match(prompt, /not current arousal/);
    assert.match(prompt, /independent flirtation and initiative remain possible/);
    assert.match(prompt, /Decreases have no -1 cap/);
    assert.equal(JSON.stringify(api.getMemory()), before);
});

test('a substantial measured loss is saved while axes omitted from that reply retain their values', () => {
    const { api, context, local } = boot();
    api.saveMemory({ Law: { ...person('Law', '90%'), love: '75%', desire: '94%', jealousy: '80%' } });
    const block = '<relationship>\nRelationship with Alice = Law:\nTrust/Friendship: [30%] - [Betrayed]\nJealousy: [5%] - [Cause resolved]\nCurrent Dynamic: Established events changed these axes.\n</relationship>';
    assert.equal(api.updateMemoryFromText(block), true);
    const saved = context.chatMetadata.rm_tracker_memory.Law;
    assert.equal(saved.trust, '30%');
    assert.equal(saved.jealousy, '5%');
    assert.equal(saved.love, '75%');
    assert.equal(saved.desire, '94%');
    assert.equal(JSON.parse(local.get('rm_tracker_memory_v1::chat-a')).Law.trust, '30%');
    assert.match(api.buildMemoryText(), /^Desire\/Attraction: 94%$/m);
});

test('migration placeholders and unmeasured axes stay omitted while measured zeroes remain real values', () => {
    const { api } = boot();
    api.saveMemory({
        Legacy: { name: 'Legacy', trust: '60%', romance: '70%', romanceStatus: 'Close' },
        New: { ...person('New'), desire: '0%', hostility: '0%' },
    });
    const prompt = api.buildMemoryText();
    const legacyBlock = prompt.split('\nLegacy:\n')[1].split('\nNew:\n')[0];
    const newBlock = prompt.split('\nNew:\n')[1];
    assert.match(legacyBlock, /^Love\/Affection: 70%$/m);
    assert.doesNotMatch(legacyBlock, /Desire\/Attraction:|Hostility\/Conflict:|Jealousy:/);
    assert.match(newBlock, /^Desire\/Attraction: 0%$/m);
    assert.match(newBlock, /^Hostility\/Conflict: 0%$/m);
    assert.equal(api.getMemory().Legacy.desireStatus, 'Not yet assessed');
});

test('legacy axis labels still update the current Love and Jealousy fields', () => {
    const { api } = boot();
    api.saveMemory({ Law: { ...person('Law'), desire: '94%' } });
    const block = 'Relationship with Alice = Law:\nTrust/Friendship: [51%] - [Reliable]\nRomance/Attraction: [40%] - [Attached]\nJealousy/Possessiveness: [12%] - [Uneasy]\nCurrent Dynamic: Legacy labels.';
    assert.equal(api.updateMemoryFromText(block), true);
    assert.equal(api.getMemory().Law.love, '40%');
    assert.equal(api.getMemory().Law.jealousy, '12%');
    assert.equal(api.getMemory().Law.desire, '94%');
    const prompt = api.buildMemoryText();
    assert.match(prompt, /^Love\/Affection: 40%$/m);
    assert.match(prompt, /^Jealousy: 12%$/m);
    assert.doesNotMatch(prompt, /Romance\/Attraction:|Jealousy\/Possessiveness:/);
});
