import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('switching businesses discards delayed replies even after switching back', async () => {
  const elements = new Map();
  function element() {
    return { value: '', textContent: '', children: [], append(el) { this.children.push(el); }, replaceChildren() { this.children = []; }, reset() {} };
  }
  for (const id of ['businesses', 'name', 'messages', 'status', 'lead', 'question', 'chat']) elements.set(id, element());
  let finishChat;
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: element },
    fetch: async route => {
      if (route === '/api/businesses') return { ok: true, json: async () => ({ realestate: { name: 'Northstar Properties', sector: 'Real estate' }, hotel: { name: 'Aster House', sector: 'Hospitality' } }) };
      return new Promise(resolve => { finishChat = () => resolve({ ok: true, json: async () => ({ message: 'Delayed original response' }) }); });
    }
  });
  vm.runInContext(await readFile(new URL('./public/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  elements.get('question').value = 'property';
  const pending = elements.get('chat').onsubmit({ preventDefault() {} });
  elements.get('businesses').children[1].onclick();
  assert.match(elements.get('name').textContent, /Aster House/);
  elements.get('businesses').children[0].onclick();
  finishChat();
  await pending;
  assert.ok(elements.get('messages').children.every(el => !el.textContent.includes('Delayed original response')));
});
