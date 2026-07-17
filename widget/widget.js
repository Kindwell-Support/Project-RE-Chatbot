/**
 * James Dainard AI Mentor — chat widget.
 * Vanilla JS, no framework. Built with esbuild into public/widget.js.
 *
 * window.createJamesBot({ apiUrl, target, memberEmail })
 *
 * Design constraints (learned from the old build):
 *  - The input box renders IMMEDIATELY and stays usable — never gated on a
 *    network call. The old build awaited a history fetch that hung, leaving
 *    members with a chat and no way to type.
 *  - GHL is a SPA that swaps lesson bodies without a reload, so mounting is
 *    idempotent (data-mounted guard) and a MutationObserver re-mounts when the
 *    target div reappears.
 *  - Model output is markdown. It is escaped first, then a small fixed set of
 *    tags is introduced — never innerHTML of raw model text.
 */
(function () {
  'use strict';

  var STYLE_ID = 'james-bot-styles';

  var BRAND = {
    navy: '#0b1f3a',
    navyLight: '#132c4f',
    navyDeep: '#08182e',
    orange: '#f47b20',
    orangeDark: '#d96812',
    text: '#eaf0f7',
    textMuted: '#9fb0c6',
  };

  // Kept deliberately plain: a greeting, one line so members know the
  // calculators exist, and the disclaimer. No numbered menu and no chip row —
  // they duplicated each other and made the first screen look like a phone tree.
  // The disclaimer stays: it must land before anyone enters deal numbers, and
  // static copy is the only way to guarantee that.
  var OPENING_MESSAGE = [
    "Hi! I'm James. I'm excited to support you on your real estate investing journey. Ask me anything about REI and I'll give you my best answer based on 20 years of experience.",
    '',
    'I can run the numbers on a flip, BRRRR, or land deal too — just tell me about the deal.',
    '',
    'Quick note before we start: everything here is education and estimates only, not financial or investment advice. Always verify your own numbers before acting on a deal.',
  ].join('\n');

  var CSS = [
    '.jb-root{display:flex;flex-direction:column;height:100%;min-height:420px;background:' + BRAND.navy + ';border:1px solid ' + BRAND.navyLight + ';border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:' + BRAND.text + ';}',
    '.jb-head{display:flex;align-items:center;gap:10px;padding:14px 18px;background:' + BRAND.navyLight + ';font-weight:700;font-size:15px;flex:0 0 auto;}',
    '.jb-dot{width:10px;height:10px;border-radius:50%;background:' + BRAND.orange + ';flex:0 0 auto;}',
    '.jb-list{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;}',
    '.jb-row{display:flex;}',
    '.jb-row.jb-user{justify-content:flex-end;}',
    '.jb-bubble{max-width:85%;padding:10px 14px;font-size:14px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere;}',
    '.jb-bot .jb-bubble{background:' + BRAND.navyLight + ';color:' + BRAND.text + ';border-radius:14px 14px 14px 4px;}',
    '.jb-user .jb-bubble{background:' + BRAND.orange + ';color:#fff;border-radius:14px 14px 4px 14px;white-space:pre-wrap;}',
    '.jb-bubble p{margin:0 0 8px;}',
    '.jb-bubble p:last-child{margin-bottom:0;}',
    '.jb-bubble h4{margin:10px 0 6px;font-size:14px;font-weight:700;}',
    '.jb-bubble h4:first-child{margin-top:0;}',
    '.jb-bubble ul{margin:0 0 8px;padding-left:18px;}',
    '.jb-bubble ul:last-child{margin-bottom:0;}',
    '.jb-bubble li{margin:2px 0;}',
    '.jb-bubble li::marker{color:' + BRAND.orange + ';}',
    '.jb-bubble code{background:' + BRAND.navyDeep + ';padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;}',
    '.jb-bubble strong{font-weight:700;color:#fff;}',
    '.jb-form{display:flex;gap:8px;padding:12px;background:' + BRAND.navyLight + ';flex:0 0 auto;}',
    /* 16px keeps iOS Safari from zooming the page on focus. */
    '.jb-input{flex:1 1 auto;min-width:0;padding:12px 14px;border-radius:8px;border:1px solid ' + BRAND.navy + ';background:' + BRAND.navy + ';color:' + BRAND.text + ';font-size:16px;font-family:inherit;outline:none;}',
    '.jb-input:focus{border-color:' + BRAND.orange + ';}',
    '.jb-input::placeholder{color:#6f829c;}',
    '.jb-send{flex:0 0 auto;padding:12px 20px;border:none;border-radius:8px;background:' + BRAND.orange + ';color:#fff;font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;transition:background .15s;}',
    '.jb-send:hover{background:' + BRAND.orangeDark + ';}',
    '.jb-send:focus-visible{outline:2px solid #fff;outline-offset:2px;}',
    '.jb-send[disabled]{background:' + BRAND.orangeDark + ';opacity:.6;cursor:default;}',
    '.jb-typing{color:' + BRAND.textMuted + ';font-style:italic;}',
    '.jb-retry{margin-top:8px;background:transparent;border:1px solid ' + BRAND.orange + ';color:' + BRAND.orange + ';border-radius:6px;padding:5px 12px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;}',
    '.jb-retry:hover{background:' + BRAND.orange + ';color:#fff;}',
    '@media (max-width:520px){.jb-bubble{max-width:92%;font-size:13.5px;}.jb-list{padding:12px;}.jb-form{padding:10px;}.jb-send{padding:12px 16px;}}',
    '@media (prefers-reduced-motion:reduce){.jb-send{transition:none;}}',
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getSessionId() {
    try {
      var key = 'james-bot-session';
      var existing = window.localStorage.getItem(key);
      if (existing) return existing;
      var fresh = uuid();
      window.localStorage.setItem(key, fresh);
      return fresh;
    } catch (e) {
      return uuid();
    }
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  // --- Markdown ------------------------------------------------------------
  // The model replies in markdown ("- **Net Profit**: $101,916"), which the old
  // widget printed with the asterisks showing. Escape EVERYTHING first, then
  // introduce a fixed set of tags — so no model (or echoed user) content can
  // inject markup, and innerHTML below is safe by construction.

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inlineMarkdown(escaped) {
    return escaped
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // Italics need a word boundary either side so snake_case survives intact.
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  }

  function renderMarkdownInto(node, text) {
    var lines = String(text).split('\n');
    var html = '';
    var listOpen = false;

    function closeList() {
      if (listOpen) {
        html += '</ul>';
        listOpen = false;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = escapeHtml(lines[i]).trim();
      if (!line) {
        closeList();
        continue;
      }

      var heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) {
        closeList();
        html += '<h4>' + inlineMarkdown(heading[1]) + '</h4>';
        continue;
      }

      var bullet = line.match(/^[-*+]\s+(.*)$/);
      if (bullet) {
        if (!listOpen) {
          html += '<ul>';
          listOpen = true;
        }
        html += '<li>' + inlineMarkdown(bullet[1]) + '</li>';
        continue;
      }

      // Numbered lines stay literal text: the menu's "1. BRRRR" numbers are
      // what members type to choose, so they must not become <ol> markers.
      closeList();
      html += '<p>' + inlineMarkdown(line) + '</p>';
    }
    closeList();
    node.innerHTML = html;
  }

  // --- Widget --------------------------------------------------------------

  function createJamesBot(options) {
    options = options || {};
    var apiUrl = String(options.apiUrl == null ? '' : options.apiUrl).replace(/\/+$/, '');
    var targetSelector = options.target || '#james-bot';
    var memberEmail = options.memberEmail || 'unknown';
    var sessionId = getSessionId();

    function mount() {
      var target = document.querySelector(targetSelector);
      if (!target || target.getAttribute('data-mounted') === 'true') return;
      target.setAttribute('data-mounted', 'true');
      target.innerHTML = '';
      injectStyles();

      var root = el('div', 'jb-root');

      var header = el('div', 'jb-head');
      header.appendChild(el('span', 'jb-dot'));
      header.appendChild(document.createTextNode('James Dainard AI Mentor'));

      var list = el('div', 'jb-list', {
        role: 'log',
        'aria-live': 'polite',
        'aria-relevant': 'additions',
        'aria-label': 'Conversation with James',
      });

      var form = el('form', 'jb-form');
      var input = el('input', 'jb-input', {
        type: 'text',
        placeholder: 'Ask James anything…',
        'aria-label': 'Message James',
        autocomplete: 'off',
      });
      var send = el('button', 'jb-send', { type: 'submit' });
      send.textContent = 'Send';
      form.appendChild(input);
      form.appendChild(send);

      root.appendChild(header);
      root.appendChild(list);
      root.appendChild(form);
      target.appendChild(root);

      // Scroll-anchoring: only follow new messages when the member is already
      // at the bottom, so a long answer can't yank them out of what they're
      // re-reading.
      function nearBottom() {
        return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      }

      function addBubble(text, who) {
        var stick = nearBottom();
        var row = el('div', 'jb-row ' + (who === 'user' ? 'jb-user' : 'jb-bot'));
        var bubble = el('div', 'jb-bubble');
        if (who === 'user') {
          bubble.textContent = text; // never parse member input as markup
        } else {
          renderMarkdownInto(bubble, text);
        }
        row.appendChild(bubble);
        list.appendChild(row);
        if (stick) list.scrollTop = list.scrollHeight;
        return { row: row, bubble: bubble };
      }

      function addTyping() {
        var handle = addBubble('James is thinking', 'bot');
        handle.bubble.className = 'jb-bubble jb-typing';
        var i = 0;
        var timer = setInterval(function () {
          i = (i + 1) % 4;
          handle.bubble.textContent = 'James is thinking' + new Array(i + 1).join('.');
        }, 400);
        return function remove() {
          clearInterval(timer);
          if (handle.row.parentNode) handle.row.parentNode.removeChild(handle.row);
        };
      }

      // Opening message: local and instant. The greeting, the numbered menu and
      // the pre-numbers disclaimer are static copy — a model can forget them,
      // static text cannot.
      addBubble(OPENING_MESSAGE, 'bot');

      var busy = false;
      var started = false;

      function setBusy(state) {
        busy = state;
        send.disabled = state;
      }

      function showError(failedText) {
        var handle = addBubble(
          'Connection hiccup on my end — give it another shot in a few seconds.',
          'bot'
        );
        var retry = el('button', 'jb-retry', { type: 'button' });
        retry.textContent = 'Retry';
        retry.addEventListener('click', function () {
          if (handle.row.parentNode) handle.row.parentNode.removeChild(handle.row);
          submitMessage(failedText, true);
        });
        handle.bubble.appendChild(retry);
      }

      function submitMessage(override, skipEcho) {
        var text = typeof override === 'string' ? override : input.value.trim();
        if (!text || busy) return;
        if (typeof override !== 'string') input.value = '';
        started = true;
        if (!skipEcho) addBubble(text, 'user');
        setBusy(true);
        var removeTyping = addTyping();

        fetch(apiUrl + '/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            message: text,
            session_id: sessionId,
            member_email: memberEmail,
          }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (data) {
            removeTyping();
            addBubble(data.output || "I didn't catch that — try again.", 'bot');
          })
          .catch(function () {
            removeTyping();
            showError(text);
          })
          .then(function () {
            setBusy(false);
            input.focus();
          });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submitMessage();
      });

      // Explicit Enter-to-send — don't rely on implicit form submission, which
      // host-page key handlers (GHL) can swallow.
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          submitMessage();
        }
      });

      input.focus();

      // Restore prior turns AFTER the UI is up and interactive. Memory lives on
      // the server, so without this a reload or GHL lesson swap shows an empty
      // chat while the bot still remembers the deal — confusing. This fetch can
      // hang or fail with no consequence: it never gates rendering, never
      // disables the input, and never surfaces an error to the member.
      fetch(apiUrl + '/history?session_id=' + encodeURIComponent(sessionId), {
        headers: { accept: 'application/json' },
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (!data || !data.messages || !data.messages.length) return;
          if (started) return; // member got there first; don't reorder their chat
          data.messages.forEach(function (m) {
            addBubble(m.content, m.role === 'user' ? 'user' : 'bot');
          });
          list.scrollTop = list.scrollHeight;
        })
        .catch(function () {
          /* history is a nicety — silence is the correct failure mode */
        });
    }

    // Initial mount (DOM may or may not be ready when the loader runs).
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount);
    } else {
      mount();
    }

    // GHL swaps lesson content without a full page load — re-mount whenever
    // the target div reappears.
    var observer = new MutationObserver(function () {
      var target = document.querySelector(targetSelector);
      if (target && target.getAttribute('data-mounted') !== 'true') mount();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.createJamesBot = createJamesBot;
})();
