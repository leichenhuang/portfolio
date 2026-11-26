/* dc-lite: a tiny runtime that renders this site's page templates.
   Supports {{path}} holes, <sc-for>, <sc-if>, onClick handlers and a
   small component class with props / state / setState. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
      scheduleRender();
    }
    forceUpdate() { scheduleRender(); }
  }
  window.DCLogic = DCLogic;

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    const parts = path.split('.');
    for (let i = scopes.length - 1; i >= 0; i--) {
      const sc = scopes[i];
      if (sc && Object.prototype.hasOwnProperty.call(sc, parts[0])) {
        let v = sc[parts[0]];
        for (let k = 1; k < parts.length; k++) { if (v == null) return undefined; v = v[parts[k]]; }
        return v;
      }
    }
    return undefined;
  }

  function interp(str, scopes) {
    return str.replace(HOLE, (_, p) => { const v = lookup(p, scopes); return v == null ? '' : String(v); });
  }

  function renderChildren(srcParent, dstParent, scopes) {
    for (const node of Array.from(srcParent.childNodes)) renderNode(node, dstParent, scopes);
  }

  function renderNode(node, dst, scopes) {
    if (node.nodeType === 3) {
      dst.appendChild(document.createTextNode(interp(node.nodeValue, scopes)));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const m = WHOLE.exec(node.getAttribute('list') || '');
      const list = m ? lookup(m[1], scopes) : [];
      const as = node.getAttribute('as') || 'item';
      (list || []).forEach((item, idx) => {
        const sc = {}; sc[as] = item; sc.$index = idx;
        renderChildren(node, dst, scopes.concat([sc]));
      });
      return;
    }
    if (tag === 'sc-if') {
      const m = WHOLE.exec(node.getAttribute('value') || '');
      if (m && lookup(m[1], scopes)) renderChildren(node, dst, scopes);
      return;
    }
    const el = node.namespaceURI === 'http://www.w3.org/2000/svg'
      ? document.createElementNS(node.namespaceURI, tag)
      : document.createElement(tag);
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name;
      if (name.indexOf('hint-') === 0) continue;
      const whole = WHOLE.exec(attr.value);
      if (/^on[a-z]+$/i.test(name)) {
        if (whole) {
          const fn = lookup(whole[1], scopes);
          if (typeof fn === 'function') { el.__h = el.__h || {}; el.__h[name.slice(2).toLowerCase()] = fn; }
        }
        continue;
      }
      let val;
      if (whole) {
        val = lookup(whole[1], scopes);
        if (val === false || val == null) continue;
        if (val === true) val = '';
      } else {
        val = interp(attr.value, scopes);
      }
      try { el.setAttribute(name, String(val)); } catch (e) { /* ignore bad attr */ }
    }
    const src = tag === 'template' ? node.content : node;
    renderChildren(src, el, scopes);
    dst.appendChild(el);
  }

  function bindHandlers(el) {
    if (el.__bound || !el.__h) return;
    el.__bound = true;
    for (const ev in el.__h) el.addEventListener(ev, (e) => { const f = el.__h && el.__h[ev]; if (f) f(e); });
  }
  function bindDeep(n) {
    if (n.nodeType !== 1) return;
    bindHandlers(n);
    for (const c of n.children) bindDeep(c);
  }
  function morph(oldN, newN) {
    if (oldN.nodeType !== newN.nodeType || oldN.nodeName !== newN.nodeName) {
      bindDeep(newN);
      oldN.replaceWith(newN);
      return;
    }
    if (oldN.nodeType === 3) {
      if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue;
      return;
    }
    if (oldN.nodeType !== 1) return;
    for (const a of Array.from(oldN.attributes)) if (!newN.hasAttribute(a.name)) oldN.removeAttribute(a.name);
    for (const a of Array.from(newN.attributes)) if (oldN.getAttribute(a.name) !== a.value) oldN.setAttribute(a.name, a.value);
    if (newN.__h) {
      const had = new Set(Object.keys(oldN.__h || {}));
      oldN.__h = newN.__h;
      for (const ev in newN.__h) if (!had.has(ev)) oldN.addEventListener(ev, (e) => { const f = oldN.__h && oldN.__h[ev]; if (f) f(e); });
      oldN.__bound = true;
    } else if (oldN.__h) { oldN.__h = {}; }
    morphChildren(oldN, newN);
  }
  function morphChildren(oldP, newP) {
    const oldC = Array.from(oldP.childNodes), newC = Array.from(newP.childNodes);
    for (let i = 0; i < newC.length; i++) {
      if (i < oldC.length) morph(oldC[i], newC[i]);
      else { bindDeep(newC[i]); oldP.appendChild(newC[i]); }
    }
    for (let i = newC.length; i < oldC.length; i++) oldC[i].remove();
  }

  let comp = null, tpl = null, root = null, pending = false, mounted = false;

  function render() {
    pending = false;
    const vals = comp.renderVals ? comp.renderVals() : {};
    const frag = document.createDocumentFragment();
    renderChildren(tpl.content, frag, [vals]);
    morphChildren(root, frag);
    if (!mounted) {
      mounted = true;
      if (comp.componentDidMount) comp.componentDidMount();
      if (location.hash) {
        const t = document.getElementById(location.hash.slice(1));
        if (t) t.scrollIntoView();
      }
    }
  }
  function scheduleRender() {
    if (!comp || pending) return;
    pending = true;
    requestAnimationFrame(render);
  }

  function boot() {
    tpl = document.getElementById('dc-template');
    root = document.getElementById('dc-root');
    const logic = document.getElementById('dc-logic');
    let props = {};
    try {
      const spec = JSON.parse(logic.getAttribute('data-props') || '{}');
      for (const k in spec) if (k[0] !== '$' && spec[k] && 'default' in spec[k]) props[k] = spec[k].default;
    } catch (e) { props = {}; }
    const Component = new Function('DCLogic', logic.textContent + '\nreturn Component;')(DCLogic);
    comp = new Component(props);
    if (!comp.props) comp.props = props;
    if (!comp.state) comp.state = {};
    render();
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const t = document.getElementById(a.getAttribute('href').slice(1));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
