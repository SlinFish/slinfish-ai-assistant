import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
async function page(response) {
  const elements = new Map();
  function element() { return { value: '', textContent: '', children: [], resets: 0, append(el) { this.children.push(el); }, replaceChildren() { this.children = []; }, reset() { this.resets++; }, querySelector() { return this.button; } }; }
  for (const id of ['businesses', 'messages', 'name', 'status', 'lead', 'chat', 'question']) elements.set(id, element());
  elements.get('lead').button = { disabled: false };
  const context = vm.createContext({ document: { getElementById: id => elements.get(id), createElement: element },
    FormData: class { get(key) { return { name: 'Demo', contact: 'demo@example.invalid', question: 'Demo question', consent: 'on' }[key]; } },
    fetch: async route => route === '/api/businesses' ? { ok: true, json: async () => ({ realestate: { name: 'Demo agency', sector: 'Real estate' }, hotel: { name: 'Demo hotel', sector: 'Hospitality' } }) } : response()
  });
  vm.runInContext(code, context); await new Promise(resolve => setImmediate(resolve));
  return elements;
}
test('frontend shows failed storage responses without resetting or claiming success', async () => {
  const elements = await page(async () => ({ ok: false, json: async () => ({ error: 'Inquiry storage unavailable' }) }));
  const form = elements.get('lead'), before = form.resets;
  await form.onsubmit({ preventDefault() {}, target: form });
  assert.equal(elements.get('status').textContent, 'Inquiry storage unavailable');
  assert.equal(form.resets, before); assert.equal(form.button.disabled, false);
});
test('frontend prevents duplicate pending submits and ignores stale business responses', async () => {
  let finish, calls = 0;
  const elements = await page(() => { calls++; return new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({ message: 'Saved previous business' }) }); }); });
  const form = elements.get('lead');
  const pending = form.onsubmit({ preventDefault() {}, target: form });
  await form.onsubmit({ preventDefault() {}, target: form }); assert.equal(calls, 1);
  elements.get('businesses').children[1].onclick(); finish(); await pending;
  assert.equal(elements.get('status').textContent, ''); assert.equal(form.button.disabled, false);
});
