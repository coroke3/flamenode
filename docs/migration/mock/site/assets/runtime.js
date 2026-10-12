/* FlameNode design export runtime — renders .dc boards (sc-if / sc-for / dc-import / x-import) as live pages */
(function () {
  const BOARDS = window.FN_BOARDS || {};
  const EV = { onClick: 'click', onDoubleClick: 'dblclick', onContextMenu: 'contextmenu', onSubmit: 'submit', onInput: 'input', onKeyDown: 'keydown',
    onDragOver: 'dragover', onDragLeave: 'dragleave', onDrop: 'drop', onLoad: 'load',
    onPointerDown: 'pointerdown', onPointerUp: 'pointerup', onPointerMove: 'pointermove', onPointerLeave: 'pointerleave' };
  const BOOL = new Set(['disabled', 'checked', 'selected', 'hidden', 'open', 'required', 'readonly', 'multiple']);
  let scheduled = false, rootEl = null, entry = null, entryProps = {};
  const instances = new Map(); let reactRoots = [];
  window.DCLogic = class { constructor(p) { this.props = p || {}; this.state = {}; } setState(o) { Object.assign(this.state, typeof o === 'function' ? o(this.state) : o); schedule(); } };
  const classes = {}, tpls = {};
  function getClass(name) {
    if (classes[name]) return classes[name];
    const src = BOARDS[name]; if (!src) throw new Error('no board ' + name);
    const m = src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
    return (classes[name] = new Function('DCLogic', m[1] + '\n;return Component;')(window.DCLogic));
  }
  function template(name) {
    if (tpls[name]) return tpls[name];
    const src = BOARDS[name];
    const a = src.indexOf('</helmet>'), b = src.lastIndexOf('</x-dc>');
    const style = (src.match(/<helmet>[\s\S]*?<\/helmet>/) || [''])[0].replace(/@font-face[^}]*}/g, '').replace(/<link[^>]*>/g, '').replace(/<\/?helmet>/g, '');
    const t = document.createElement('template'); t.innerHTML = src.slice(a + 9, b);
    return (tpls[name] = { content: t.content, style });
  }
  const get = (s, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), s);
  const HOLE = /\{\{\s*([\w.$]+)\s*\}\}/g;
  const whole = (s) => { const m = s && s.match(/^\{\{\s*([\w.$]+)\s*\}\}$/); return m ? m[1] : null; };
  const interp = (s, sc) => s.replace(HOLE, (_, p) => { const v = get(sc, p); return v == null || typeof v === 'object' || typeof v === 'function' ? '' : String(v); });
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  let mounts = [], counters = [];
  function renderBoard(name, props, key, styles) {
    const C = getClass(name);
    let inst = instances.get(key);
    if (!inst || inst.__name !== name) { inst = new C(props); inst.__name = name; instances.set(key, inst); }
    inst.props = props;
    let vals = {}; try { vals = inst.renderVals() || {}; } catch (e) { console.error('renderVals', name, e); }
    const t = template(name), out = document.createDocumentFragment();
    if (t.style.trim() && !styles.has(name)) { styles.add(name); const d = document.createElement('div'); d.innerHTML = t.style; out.append(...d.childNodes); }
    counters.push({});
    for (const n of Array.from(t.content.childNodes)) expand(n, vals, out, key, styles);
    counters.pop();
    return out;
  }
  function expand(node, sc, parent, key, styles) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.nodeValue, sc))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const list = get(sc, whole(node.getAttribute('list')) || '') || [], as = node.getAttribute('as');
      for (const item of list) for (const c of Array.from(node.childNodes)) expand(c, Object.assign(Object.create(sc), { [as]: item }), parent, key, styles);
      return;
    }
    if (tag === 'sc-if') { if (get(sc, whole(node.getAttribute('value')) || '')) for (const c of Array.from(node.childNodes)) expand(c, sc, parent, key, styles); return; }
    if (tag === 'dc-import') {
      const name = node.getAttribute('name'), props = {};
      for (const at of Array.from(node.attributes)) { if (at.name === 'name' || at.name.startsWith('hint-')) continue; const w = whole(at.value); props[camel(at.name)] = w ? get(sc, w) : at.value; }
      const cnt = counters[counters.length - 1]; cnt[name] = (cnt[name] || 0) + 1;
      const wrap = document.createElement('div'); wrap.className = 'dc-import'; wrap.dataset.board = name;
      try { wrap.appendChild(renderBoard(name, props, key + '/' + name + '#' + cnt[name], styles)); } catch (e) { console.error(e); }
      parent.appendChild(wrap); return;
    }
    if (tag === 'x-import') {
      const comp = (node.getAttribute('component-from-global-scope') || '').split('.').pop(), props = {};
      for (const at of Array.from(node.attributes)) { if (at.name === 'component-from-global-scope' || at.name === 'style') continue; const w = whole(at.value); let k = camel(at.name); if (k === 'class') k = 'className'; props[k] = w ? get(sc, w) : at.value; }
      const holder = document.createElement('div'); holder.style.cssText = node.getAttribute('style') || ''; if (!holder.style.display) holder.style.display = 'contents';
      const kids = document.createElement('div'); for (const c of Array.from(node.childNodes)) expand(c, sc, kids, key, styles);
      mounts.push([holder, comp, props, kids]); parent.appendChild(holder); return;
    }
    const el = document.createElement(tag);
    for (const at of Array.from(node.attributes)) {
      const w = whole(at.value);
      if (/^on[A-Z]/.test(at.name) || /^on[a-z]+$/.test(at.name)) {
        const name = at.name.length > 2 && at.name[2] === at.name[2].toUpperCase() ? at.name : 'on' + at.name.slice(2).replace(/^./, c => c.toUpperCase());
        const fn = w ? get(sc, w) : null; if (typeof fn !== 'function') continue;
        let ev = EV[name] || name.slice(2).toLowerCase();
        if (name === 'onChange') ev = (tag === 'select' || /checkbox|radio|file/.test(node.getAttribute('type') || '')) ? 'change' : 'input';
        el.addEventListener(ev, (e) => fn(e)); continue;
      }
      if (w) { const v = get(sc, w); if (v === false || v == null || typeof v === 'function') continue; if (BOOL.has(at.name)) { if (v === true || v === 'true') el.setAttribute(at.name, ''); continue; } if (typeof v === 'object') continue; el.setAttribute(at.name, String(v)); }
      else el.setAttribute(at.name, interp(at.value, sc));
    }
    const target = tag === 'template' ? el.content : el;
    for (const c of Array.from(node.childNodes)) expand(c, sc, target, key, styles);
    if (tag === 'input' && el.hasAttribute('value')) el.value = el.getAttribute('value');
    if (tag === 'input' && el.hasAttribute('checked')) el.checked = true;
    parent.appendChild(el);
  }
  function focusPath() {
    const a = document.activeElement; if (!a || a === document.body || !rootEl.contains(a)) return null;
    const all = rootEl.querySelectorAll('input,textarea,select,button,a'); const i = Array.prototype.indexOf.call(all, a);
    return i < 0 ? null : { i, s: a.selectionStart, e: a.selectionEnd };
  }
  function render() {
    scheduled = false;
    const fp = focusPath(), sx = window.scrollX, sy = window.scrollY;
    reactRoots.forEach(r => { try { r.unmount(); } catch (e) {} }); reactRoots = [];
    mounts = []; counters = [];
    const frag = renderBoard(entry, entryProps, 'root', new Set());
    rootEl.replaceChildren(frag);
    const F = window.FlameNode, h = window.React && React.createElement;
    for (const [holder, comp, props, kids] of mounts) {
      const C = F && F[comp]; if (!C || !h) continue;
      const children = kids.childNodes.length ? h('div', { ref: (n) => { if (n && !n.firstChild) n.append(...kids.childNodes); } }) : undefined;
      try { const r = ReactDOM.createRoot(holder); ReactDOM.flushSync ? ReactDOM.flushSync(() => r.render(h(C, props, children))) : r.render(h(C, props, children)); reactRoots.push(r); } catch (e) { console.error(comp, e); }
    }
    if (fp) { const all = rootEl.querySelectorAll('input,textarea,select,button,a'); const el = all[fp.i]; if (el) { el.focus({ preventScroll: true }); try { if (fp.s != null) el.setSelectionRange(fp.s, fp.e); } catch (e) {} } }
    window.scrollTo(sx, sy);
  }
  function schedule() { if (!scheduled && rootEl) { scheduled = true; requestAnimationFrame(render); } }
  window.FN_RENDER = function (name, props) { entry = name; entryProps = props || {}; rootEl = document.getElementById('fn-root'); render(); };
})();
