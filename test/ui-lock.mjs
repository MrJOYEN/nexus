// Test UI du parcours verrouillage de Nexus via CDP.
// Prerequis : instance lancee avec --remote-debugging-port et profil vierge.
const PORT = process.argv[2] || '9224';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

let page;
for (let i = 0; i < 30 && !page; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
  } catch {}
  if (!page) await sleep(500);
}
if (!page) { console.error('FAIL page sidebar introuvable'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    return { __threw: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  }
  return r.result?.result?.value;
}
const visible = (sel) => evalJs(`!document.querySelector('${sel}').classList.contains('hidden')`);
async function key(keyName, code, vk, modifiers = 0) {
  // type keyDown (pas rawKeyDown) : before-input-event ne voit que keyDown.
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}
await send('Runtime.enable');

// --- 1. Onboarding : langue + 2 services -----------------------------------
check('onboarding visible', await visible('#onboarding'));
await evalJs(`document.querySelector('.ob-langs button[data-lang="fr"]').click()`);
await sleep(800);
// Telegram + Element : pas de Discord, qui declenche une demande de cle
// d'acces Windows sur ce poste.
await evalJs(`(() => { const t = [...document.querySelectorAll('#ob-grid .tile')]; t[1].click(); t[7].click(); })()`);
await evalJs(`document.getElementById('ob-start').click()`);
await sleep(4000);
check('onboarding termine', !(await visible('#onboarding')));
const ids = await evalJs(`[...items.keys()]`);
check('2 services crees', Array.isArray(ids) && ids.length === 2, JSON.stringify(ids));
const [first, second] = ids;

// --- 2. Proteger le service 2 depuis son formulaire (sans code defini) ------
await evalJs(`openForm(items.get('${second}').service)`);
check('formulaire ouvert', await visible('#modal'));
await evalJs(`(() => { fields.protected.checked = true; document.getElementById('service-form').requestSubmit(); })()`);
await sleep(800);
check('formulaire ferme apres save', !(await visible('#modal')));
check('formulaire du code ouvert (regression modal-sous-vues)', await visible('#lock-setup'));

// --- 3. Definir le code 1234 ------------------------------------------------
await evalJs(`(() => { lockFields.next.value = '1234'; lockFields.confirm.value = '1234'; document.getElementById('lock-setup-form').requestSubmit(); })()`);
await sleep(800);
check('formulaire du code ferme', !(await visible('#lock-setup')));

// --- 4. Ouvrir le service protege : ecran de code du service ----------------
await evalJs(`window.hub.select('${second}')`);
await sleep(600);
check('ecran de code du service affiche', await visible('#service-lock'));
await evalJs(`(() => { serviceLockPin.value = '9999'; serviceLockForm.requestSubmit(); })()`);
await sleep(600);
check('mauvais code refuse', await visible('#service-lock-error'));
await evalJs(`(() => { serviceLockPin.value = '1234'; serviceLockForm.requestSubmit(); })()`);
await sleep(600);
check('bon code accepte, service revele', !(await visible('#service-lock')));

// --- 5. Verrouillage global puis deverrouillage -----------------------------
// (Ctrl+L passe par before-input-event, que le CDP ne sait pas atteindre :
// on verrouille par l'API, le raccourci reste couvert par le test manuel.)
await evalJs(`window.hub.lockNow()`);
await sleep(600);
check("lockNow verrouille l'app", await visible('#lockscreen'));
await evalJs(`(() => { lockPin.value = '0000'; document.getElementById('lock-form').requestSubmit(); })()`);
await sleep(600);
check('mauvais code global refuse', await visible('#lock-error'));
await evalJs(`(() => { lockPin.value = '1234'; document.getElementById('lock-form').requestSubmit(); })()`);
await sleep(600);
check('bon code global accepte', !(await visible('#lockscreen')));

// --- 6. Apres verrouillage, le service protege redemande son code -----------
check('le service protege redemande son code', await visible('#service-lock'));
await evalJs(`(() => { serviceLockPin.value = '1234'; serviceLockForm.requestSubmit(); })()`);
await sleep(400);

// --- 7. Decocher la protection : refuse tant que verrouille -----------------
// (ici il est deverrouille, donc ca doit passer)
await evalJs(`openForm(items.get('${second}').service)`);
await evalJs(`(() => { fields.protected.checked = false; document.getElementById('service-form').requestSubmit(); })()`);
await sleep(600);
check('protection retiree apres deverrouillage', !(await visible('#modal')));

console.log(failures ? `${failures} echec(s)` : 'TOUT PASSE');
process.exit(failures ? 1 : 0);
