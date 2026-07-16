/**
 * James Dainard AI Mentor — chat widget.
 * Vanilla JS, no framework. Built with esbuild into public/widget.js.
 *
 * window.createJamesBot({ apiUrl, target, memberEmail })
 *
 * Design constraints (learned from the old build):
 *  - The input box renders IMMEDIATELY — never gated on a network call.
 *  - GHL is a SPA that swaps lesson bodies without a reload, so mounting is
 *    idempotent (data-mounted guard) and a MutationObserver re-mounts when the
 *    target div reappears.
 */
(function () {
  'use strict';

  var BRAND = {
    navy: '#0b1f3a',
    navyLight: '#132c4f',
    orange: '#f47b20',
    orangeDark: '#d96812',
    text: '#eaf0f7',
    textMuted: '#9fb0c6',
  };

  // The greeting + menu is STATIC widget copy (client's spec), rendered before
  // the model is ever called. Deterministic by construction: the menu and the
  // pre-numbers disclaimer cannot be forgotten by a model that never ran.
  var OPENING_MESSAGE = [
    "Hi! I'm James. I'm excited to support you on your real estate investing journey. Ask me anything about REI and I'll give you my best answer based on 20 years of experience.",
    '',
    "Want me to run some numbers with you? Just tell me which one you'd like:",
    '',
    '1. BRRRR',
    '2. Flip',
    '3. Land Acquisition',
    '4. Partnership Agreements (coming soon)',
    '5. Construction',
    '6. Material Allowance',
    '',
    'Quick note before we start: everything here is education and estimates only, not financial or investment advice. Always verify your own numbers before acting on a deal.',
  ].join('\n');

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

  function el(tag, styles, attrs) {
    var node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function createJamesBot(options) {
    options = options || {};
    var apiUrl = (options.apiUrl || '').replace(/\/+$/, '');
    var targetSelector = options.target || '#james-bot';
    var memberEmail = options.memberEmail || 'unknown';
    var sessionId = getSessionId();

    function mount() {
      var target = document.querySelector(targetSelector);
      if (!target || target.getAttribute('data-mounted') === 'true') return;
      target.setAttribute('data-mounted', 'true');
      target.innerHTML = '';

      var root = el('div', {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '480px',
        background: BRAND.navy,
        borderRadius: '12px',
        overflow: 'hidden',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        border: '1px solid ' + BRAND.navyLight,
      });

      // Header
      var header = el('div', {
        padding: '14px 18px',
        background: BRAND.navyLight,
        color: BRAND.text,
        fontWeight: '700',
        fontSize: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      });
      var dot = el('span', {
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: BRAND.orange,
        display: 'inline-block',
      });
      header.appendChild(dot);
      header.appendChild(document.createTextNode('James Dainard AI Mentor'));

      // Message list
      var list = el('div', {
        flex: '1',
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      });

      // Input row — rendered immediately, no network dependency.
      var form = el('form', {
        display: 'flex',
        gap: '8px',
        padding: '12px',
        background: BRAND.navyLight,
      });
      var input = el('input', {
        flex: '1',
        padding: '12px 14px',
        borderRadius: '8px',
        border: '1px solid ' + BRAND.navy,
        background: BRAND.navy,
        color: BRAND.text,
        fontSize: '14px',
        outline: 'none',
      }, {
        type: 'text',
        placeholder: 'Ask about a deal, or type 1-6…',
        'aria-label': 'Message James',
      });
      var send = el('button', {
        padding: '12px 20px',
        borderRadius: '8px',
        border: 'none',
        background: BRAND.orange,
        color: '#fff',
        fontWeight: '700',
        fontSize: '14px',
        cursor: 'pointer',
      }, { type: 'submit' });
      send.textContent = 'Send';
      form.appendChild(input);
      form.appendChild(send);

      // Explicit Enter-to-send — don't rely on implicit form submission,
      // which host-page key handlers (GHL) can swallow.
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          submitMessage();
        }
      });

      root.appendChild(header);
      root.appendChild(list);
      root.appendChild(form);
      target.appendChild(root);

      function addBubble(text, who) {
        var isUser = who === 'user';
        var bubble = el('div', {
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          background: isUser ? BRAND.orange : BRAND.navyLight,
          color: isUser ? '#fff' : BRAND.text,
          alignSelf: isUser ? 'flex-end' : 'flex-start',
          fontSize: '14px',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        });
        bubble.textContent = text;
        list.appendChild(bubble);
        list.scrollTop = list.scrollHeight;
        return bubble;
      }

      function addTyping() {
        var bubble = addBubble('…', 'bot');
        bubble.style.color = BRAND.textMuted;
        var i = 0;
        var timer = setInterval(function () {
          i = (i + 1) % 4;
          bubble.textContent = 'James is thinking' + new Array(i + 1).join('.');
        }, 400);
        return function remove() {
          clearInterval(timer);
          if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
        };
      }

      // Opening message: disclaimer + menu. Local, instant.
      addBubble(OPENING_MESSAGE, 'bot');

      var busy = false;
      function submitMessage() {
        var text = input.value.trim();
        if (!text || busy) return;
        input.value = '';
        addBubble(text, 'user');
        busy = true;
        send.style.background = BRAND.orangeDark;
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
            addBubble(
              "Connection hiccup on my end — give it another shot in a few seconds.",
              'bot'
            );
          })
          .then(function () {
            busy = false;
            send.style.background = BRAND.orange;
            input.focus();
          });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submitMessage();
      });

      input.focus();
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
