const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot() {
    const meta = {};
    const local = new Map();
    const context = { chatMetadata: meta, chatId: 'chat-a', saveMetadata() {} };
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
        setExtensionPrompt() {},
        extension_prompt_types: { IN_PROMPT: 0 }, extension_prompt_roles: { SYSTEM: 0 },
        confirm: () => true,
    };
    const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';/g, '')
        .replace('setTimeout(init, 1000);', '');
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return { api: sandbox, context, meta, local };
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
