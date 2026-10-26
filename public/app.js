const $ = id => document.getElementById(id);
let data = {}, selected = 'realestate', generation = 0;
function bubble(text, role = 'bot') {
  const el = document.createElement('div');
  el.className = 'bubble ' + role;
  el.textContent = text;
  $('messages').append(el);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function render() {
  generation++;
  $('businesses').replaceChildren();
  for (const [id, business] of Object.entries(data)) {
    const btn = document.createElement('button');
    btn.textContent = business.sector;
    btn.className = id === selected ? 'active' : '';
    btn.onclick = () => { selected = id; render(); };
    $('businesses').append(btn);
  }
  $('name').textContent = data[selected].name + ' · ' + data[selected].sector;
  $('messages').replaceChildren();
  $('status').textContent = '';
  $('lead').reset();
  $('question').value = '';
  bubble('Welcome! Ask about this fictional business. Answers use approved knowledge. Missing information requires a team member; this demo does not contact staff.');
}
async function post(url, payload) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok && !result.message) throw new Error(result.error || 'Request failed');
  return result;
}
$('chat').onsubmit = async event => {
  event.preventDefault();
  const message = $('question').value.trim();
  if (!message) return;
  const current = generation;
  $('question').value = '';
  bubble(message, 'user');
  try {
    const result = await post('/api/chat', { business: selected, message });
    if (current === generation) bubble(result.message);
  } catch (error) { if (current === generation) bubble(error.message || 'Connection failed. Please try again.'); }
};
$('lead').onsubmit = async event => {
  event.preventDefault();
  const current = generation;
  const form = new FormData(event.target);
  try {
    const result = await post('/api/lead', {
      business: selected, name: form.get('name'), contact: form.get('contact'),
      question: form.get('question'), consent: !!form.get('consent')
    });
    if (current === generation) { $('status').textContent = result.message; event.target.reset(); }
  } catch (error) { if (current === generation) $('status').textContent = error.message || 'Connection failed'; }
};
fetch('/api/businesses').then(response => {
  if (!response.ok) throw new Error('Business information unavailable');
  return response.json();
}).then(result => { data = result; render(); }).catch(() => bubble('Business information unavailable. Please try again later.'));
