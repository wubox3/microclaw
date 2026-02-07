/**
 * Generates a complete A2UI renderer page as an HTML string.
 * This page runs inside an iframe and communicates with the parent via postMessage.
 */
export function generateA2uiPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MicroClaw Canvas</title>
<style>
  :root {
    --primary: #E87B35;
    --primary-hover: #D06A2B;
    --bg: #FFFFFF;
    --text: #1A1A1A;
    --text-secondary: #6B6B6B;
    --text-muted: #9B9B9B;
    --border: #E8E5E0;
    --surface: #F5F3F0;
    --radius: 8px;
    --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    padding: 16px;
    line-height: 1.5;
  }

  #a2ui-root {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* A2UI Component Styles */
  .a2ui-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .a2ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 20px;
    background: var(--primary);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    font-family: var(--font);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .a2ui-button:hover { background: var(--primary-hover); }

  .a2ui-button.secondary {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .a2ui-button.secondary:hover { background: var(--border); }

  .a2ui-text { font-size: 14px; color: var(--text); }
  .a2ui-text.caption { font-size: 12px; color: var(--text-muted); }
  .a2ui-text.body { font-size: 14px; }

  .a2ui-image {
    max-width: 100%;
    border-radius: var(--radius);
  }

  .a2ui-row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .a2ui-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .a2ui-divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }

  .a2ui-tabs {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .a2ui-tab-headers {
    display: flex;
    border-bottom: 1px solid var(--border);
    gap: 0;
  }

  .a2ui-tab-header {
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
    font-family: var(--font);
  }

  .a2ui-tab-header.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }

  .a2ui-tab-panel { padding: 12px 0; display: none; }
  .a2ui-tab-panel.active { display: block; }

  .a2ui-textfield {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }

  .a2ui-textfield:focus { border-color: var(--primary); }

  .a2ui-checkbox-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 14px;
  }

  .a2ui-checkbox-wrap input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--primary);
  }

  .a2ui-slider-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .a2ui-slider-wrap input[type="range"] {
    width: 100%;
    accent-color: var(--primary);
  }

  .a2ui-slider-value {
    font-size: 12px;
    color: var(--text-muted);
    text-align: right;
  }

  .a2ui-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .a2ui-modal {
    background: var(--bg);
    border-radius: var(--radius);
    padding: 24px;
    max-width: 480px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .a2ui-list { padding-left: 20px; }
  .a2ui-list li { margin-bottom: 4px; font-size: 14px; }

  /* Custom HTML container */
  #html-root { display: none; }
  #html-root.active { display: block; }

  /* Empty state */
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    color: var(--text-muted);
    font-size: 14px;
  }
</style>
</head>
<body>

<div id="a2ui-root">
  <div class="empty-state">Canvas ready</div>
</div>
<div id="html-root"></div>

<script>
(function() {
  'use strict';

  var MAX_DEPTH = 50;
  var a2uiRoot = document.getElementById('a2ui-root');
  var htmlRoot = document.getElementById('html-root');
  var surfaces = {};

  var PARENT_ORIGIN = location.origin || '';

  function sendAction(action, componentId, value) {
    if (!PARENT_ORIGIN) return;
    parent.postMessage({
      type: 'canvas_action',
      action: action,
      componentId: componentId || undefined,
      value: value !== undefined ? value : undefined
    }, PARENT_ORIGIN);
  }

  var DANGEROUS_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta', 'svg', 'math', 'foreignobject', 'animate', 'animatetransform', 'set', 'use', 'mtext', 'mglyph', 'annotation-xml'];

  function sanitizeHtml(html) {
    var temp = document.createElement('div');
    temp.innerHTML = html || '';
    // Remove dangerous tags
    for (var dt = 0; dt < DANGEROUS_TAGS.length; dt++) {
      var dangerous = temp.querySelectorAll(DANGEROUS_TAGS[dt]);
      for (var d = 0; d < dangerous.length; d++) dangerous[d].remove();
    }
    // Remove event handler attributes and dangerous URIs
    var allEls = temp.querySelectorAll('*');
    for (var e = 0; e < allEls.length; e++) {
      var attrs = allEls[e].attributes;
      for (var a = attrs.length - 1; a >= 0; a--) {
        if (attrs[a].name.toLowerCase().startsWith('on')) {
          allEls[e].removeAttribute(attrs[a].name);
        }
      }
      // Remove javascript:, vbscript:, and data: (non-image) href/src/action attributes
      var urlAttrs = ['href', 'src', 'action', 'formaction', 'xlink:href'];
      for (var u = 0; u < urlAttrs.length; u++) {
        var val = allEls[e].getAttribute(urlAttrs[u]);
        if (val) {
          var trimmedVal = val.trim().toLowerCase();
          if (trimmedVal.startsWith('javascript:') || trimmedVal.startsWith('vbscript:')) {
            allEls[e].removeAttribute(urlAttrs[u]);
          }
          // Block data: URIs except data:image/ (but not SVG which can contain scripts)
          if (trimmedVal.startsWith('data:') && !trimmedVal.startsWith('data:image/')) {
            allEls[e].removeAttribute(urlAttrs[u]);
          }
          if (trimmedVal.startsWith('data:image/svg')) {
            allEls[e].removeAttribute(urlAttrs[u]);
          }
        }
      }
    }
    return temp.innerHTML;
  }

  function isSafeSrc(src) {
    if (!src) return false;
    var trimmed = String(src).trim().toLowerCase();
    // Block SVG data URIs which can contain embedded scripts
    if (trimmed.startsWith('data:image/svg')) return false;
    return trimmed.startsWith('http://') ||
           trimmed.startsWith('https://') ||
           trimmed.startsWith('/') ||
           trimmed.startsWith('data:image/');
  }

  function renderComponent(comp, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH || !comp || !comp.type) return document.createTextNode('');
    var props = comp.props || {};
    var el;
    var nextDepth = depth + 1;

    switch (comp.type) {
      case 'text': {
        var variant = props.variant || 'body';
        if (variant === 'h1') el = document.createElement('h1');
        else if (variant === 'h2') el = document.createElement('h2');
        else if (variant === 'h3') el = document.createElement('h3');
        else if (variant === 'h4') el = document.createElement('h4');
        else if (variant === 'h5') el = document.createElement('h5');
        else el = document.createElement('p');
        el.className = 'a2ui-text' + (variant === 'caption' ? ' caption' : '');
        el.textContent = props.text || props.content || '';
        break;
      }

      case 'button': {
        el = document.createElement('button');
        el.className = 'a2ui-button' + (props.variant === 'secondary' ? ' secondary' : '');
        el.textContent = props.label || props.text || 'Button';
        var btnId = comp.id || props.label || '';
        var btnAction = props.onclick || props.action || 'click';
        el.addEventListener('click', function() {
          sendAction(btnAction, btnId, props.label);
        });
        break;
      }

      case 'card': {
        el = document.createElement('div');
        el.className = 'a2ui-card';
        if (comp.children) {
          for (var i = 0; i < comp.children.length; i++) {
            el.appendChild(renderComponent(comp.children[i], nextDepth));
          }
        }
        break;
      }

      case 'image': {
        el = document.createElement('img');
        el.className = 'a2ui-image';
        var imgSrc = String(props.src || '');
        if (isSafeSrc(imgSrc)) {
          el.src = imgSrc;
        }
        el.alt = props.alt || '';
        break;
      }

      case 'list': {
        el = document.createElement(props.ordered ? 'ol' : 'ul');
        el.className = 'a2ui-list';
        if (comp.children) {
          for (var j = 0; j < comp.children.length; j++) {
            var li = document.createElement('li');
            li.appendChild(renderComponent(comp.children[j], nextDepth));
            el.appendChild(li);
          }
        }
        break;
      }

      case 'tabs': {
        el = document.createElement('div');
        el.className = 'a2ui-tabs';
        var headersEl = document.createElement('div');
        headersEl.className = 'a2ui-tab-headers';
        var panels = [];
        var tabChildren = comp.children || [];

        // Create headers and panels
        for (var t = 0; t < tabChildren.length; t++) {
          var tab = tabChildren[t];
          var tabProps = tab.props || {};
          var header = document.createElement('button');
          header.className = 'a2ui-tab-header' + (t === 0 ? ' active' : '');
          header.textContent = tabProps.label || tabProps.title || 'Tab ' + (t + 1);
          header.dataset.index = String(t);

          var panel = document.createElement('div');
          panel.className = 'a2ui-tab-panel' + (t === 0 ? ' active' : '');
          if (tab.children) {
            for (var tc = 0; tc < tab.children.length; tc++) {
              panel.appendChild(renderComponent(tab.children[tc], nextDepth));
            }
          }
          panels.push(panel);
          headersEl.appendChild(header);
        }

        // Add click handlers after all headers are created
        var allHeaders = headersEl.querySelectorAll('.a2ui-tab-header');
        for (var fix = 0; fix < allHeaders.length; fix++) {
          allHeaders[fix].addEventListener('click', (function(idx, hs, ps) {
            return function() {
              for (var h = 0; h < hs.length; h++) {
                hs[h].classList.remove('active');
                ps[h].classList.remove('active');
              }
              hs[idx].classList.add('active');
              ps[idx].classList.add('active');
            };
          })(fix, allHeaders, panels));
        }

        el.appendChild(headersEl);
        for (var p = 0; p < panels.length; p++) {
          el.appendChild(panels[p]);
        }
        break;
      }

      case 'text-field': {
        if (props.multiline) {
          el = document.createElement('textarea');
          el.rows = props.rows || 3;
        } else {
          el = document.createElement('input');
          el.type = 'text';
        }
        el.className = 'a2ui-textfield';
        el.placeholder = props.placeholder || '';
        if (props.value !== undefined) el.value = String(props.value);
        var tfId = comp.id || '';
        el.addEventListener('change', function() {
          sendAction('input_change', tfId, el.value);
        });
        break;
      }

      case 'checkbox': {
        el = document.createElement('label');
        el.className = 'a2ui-checkbox-wrap';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!props.checked;
        var cbId = comp.id || '';
        cb.addEventListener('change', function() {
          sendAction('checkbox_change', cbId, cb.checked);
        });
        el.appendChild(cb);
        el.appendChild(document.createTextNode(props.label || ''));
        break;
      }

      case 'slider': {
        el = document.createElement('div');
        el.className = 'a2ui-slider-wrap';
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(props.min !== undefined ? props.min : 0);
        slider.max = String(props.max !== undefined ? props.max : 100);
        slider.step = String(props.step || 1);
        slider.value = String(props.value !== undefined ? props.value : 50);
        var valDisplay = document.createElement('span');
        valDisplay.className = 'a2ui-slider-value';
        valDisplay.textContent = slider.value;
        var sliderId = comp.id || '';
        slider.addEventListener('input', function() {
          valDisplay.textContent = slider.value;
          sendAction('slider_change', sliderId, Number(slider.value));
        });
        el.appendChild(slider);
        el.appendChild(valDisplay);
        break;
      }

      case 'divider': {
        el = document.createElement('hr');
        el.className = 'a2ui-divider';
        break;
      }

      case 'row': {
        el = document.createElement('div');
        el.className = 'a2ui-row';
        if (comp.children) {
          for (var r = 0; r < comp.children.length; r++) {
            el.appendChild(renderComponent(comp.children[r], nextDepth));
          }
        }
        break;
      }

      case 'column': {
        el = document.createElement('div');
        el.className = 'a2ui-column';
        if (comp.children) {
          for (var col = 0; col < comp.children.length; col++) {
            el.appendChild(renderComponent(comp.children[col], nextDepth));
          }
        }
        break;
      }

      case 'modal': {
        var backdrop = document.createElement('div');
        backdrop.className = 'a2ui-modal-backdrop';
        el = document.createElement('div');
        el.className = 'a2ui-modal';
        if (comp.children) {
          for (var m = 0; m < comp.children.length; m++) {
            el.appendChild(renderComponent(comp.children[m], nextDepth));
          }
        }
        backdrop.appendChild(el);
        backdrop.addEventListener('click', function(e) {
          if (e.target === backdrop) {
            sendAction('modal_dismiss', comp.id || '');
          }
        });
        return backdrop;
      }

      default: {
        el = document.createElement('div');
        el.textContent = '[Unknown: ' + comp.type + ']';
      }
    }

    if (comp.id) el.dataset.a2uiId = comp.id;
    return el;
  }

  function escapeSurfaceSelector(id) {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/([^a-zA-Z0-9])/g, '\\$1');
  }

  function renderSurface(surfaceId, root) {
    surfaces[surfaceId] = root;
    // Targeted update: replace only the affected surface
    var existing = a2uiRoot.querySelector('[data-surface="' + escapeSurfaceSelector(surfaceId) + '"]');
    var newEl = renderComponent(root, 0);
    if (newEl.nodeType === 1) {
      newEl.dataset.surface = surfaceId;
    } else {
      var wrapper = document.createElement('div');
      wrapper.dataset.surface = surfaceId;
      wrapper.appendChild(newEl);
      newEl = wrapper;
    }

    // Clear empty state if present
    var emptyState = a2uiRoot.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    if (existing) {
      a2uiRoot.replaceChild(newEl, existing);
    } else {
      a2uiRoot.appendChild(newEl);
    }
  }

  function deleteSurface(surfaceId) {
    delete surfaces[surfaceId];
    var existing = a2uiRoot.querySelector('[data-surface="' + escapeSurfaceSelector(surfaceId) + '"]');
    if (existing) existing.remove();
    if (Object.keys(surfaces).length === 0) {
      a2uiRoot.innerHTML = '<div class="empty-state">Canvas ready</div>';
    }
  }

  function resetAll() {
    surfaces = {};
    a2uiRoot.innerHTML = '<div class="empty-state">Canvas ready</div>';
    htmlRoot.innerHTML = '';
    htmlRoot.classList.remove('active');
  }

  function handleMessage(event) {
    // Validate source is our parent window
    if (event.source !== parent) return;

    var data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case 'canvas_update':
        a2uiRoot.style.display = 'none';
        htmlRoot.classList.add('active');
        htmlRoot.innerHTML = sanitizeHtml(data.html);
        break;

      case 'canvas_eval':
        // Arbitrary code execution disabled for security
        sendAction('eval_error', undefined, 'canvas_eval is disabled for security reasons');
        break;

      case 'canvas_a2ui':
        a2uiRoot.style.display = '';
        htmlRoot.classList.remove('active');
        if (data.messages && Array.isArray(data.messages)) {
          for (var i = 0; i < data.messages.length; i++) {
            var msg = data.messages[i];
            if (msg.kind === 'beginRendering' && typeof msg.surfaceId === 'string') {
              surfaces[msg.surfaceId] = surfaces[msg.surfaceId] || null;
            } else if (msg.kind === 'surfaceUpdate' && typeof msg.surfaceId === 'string' && msg.root) {
              renderSurface(msg.surfaceId, msg.root);
            } else if (msg.kind === 'deleteSurface' && typeof msg.surfaceId === 'string') {
              deleteSurface(msg.surfaceId);
            }
          }
        }
        break;

      case 'canvas_a2ui_reset':
        resetAll();
        break;
    }
  }

  window.addEventListener('message', handleMessage);

  // Signal readiness to parent
  if (PARENT_ORIGIN) {
    parent.postMessage({ type: 'canvas_ready' }, PARENT_ORIGIN);
  }
})();
</script>
</body>
</html>`;
}
