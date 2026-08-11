/**
 * Ask James — chat widget.
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
 *
 * Visual direction — "dark room, warm light":
 *  - All color/type/motion derive from CSS custom properties (--jb-*) defined
 *    once on .jb-root, so a retheme is a token edit, not a component rewrite.
 *  - Structural chrome (header, composer, calculator + result cards) is liquid
 *    glass over a contained amber ambient layer that gives the glass something
 *    to refract. Message bubbles stay flat — glass is capped for performance.
 *  - Everything is scoped under .jb-root with a jb- class prefix so host-page
 *    (GHL) styles can't bleed in and ours can't leak out. See report §scoping.
 */
(function () {
  'use strict';

  var STYLE_ID = 'james-bot-styles';

  // Kept deliberately plain: a greeting, one line so members know the
  // calculators exist, and the disclaimer. The disclaimer must land before
  // anyone enters deal numbers, and static copy is the only way to guarantee
  // that. (The opening screen is intentionally a single bubble — no chip row,
  // no numbered menu; pinned by tests/widget.test.ts.)
  var OPENING_MESSAGE = [
    "Hi! I'm James — ask me anything related to Real Estate Investing and I will share my knowledge based on my 20 years of experience.",
    '',
    'I can answer questions related to REI, or I can perform calculations based on my BRRRR, Flip, Land Acquisition and Construction Calculators.',
    '',
    'Let me know how I can help.',
    '',
    'Quick note before we start: everything here is education and estimates only, not financial or investment advice. Always verify your own numbers before acting on a deal.',
  ].join('\n');

  // Honest, neutral rotating status. The backend answers in one shot (no token
  // stream), so the widget genuinely does not know which tool is running while
  // it waits — so it does NOT fake tool-specific copy on a timer. See report.
  var THINK_COPY = [
    'Thinking it through',
    'Still with you',
    'Working on it',
    'Putting this together',
  ];

  // ---------------------------------------------------------------------------
  // Styles. One token block on .jb-root; everything else derives from it.
  // ---------------------------------------------------------------------------
  var CSS = [
    /* Tokens — the single source of color / type / motion. Prefixed --jb-* so
       they can never collide with a host page's own custom properties. */
    '.jb-root{',
    '--jb-bg-base:#0A0A0B;--jb-bg-raised:#141416;--jb-bg-sunken:#060607;',
    '--jb-text-primary:#F5F5F7;--jb-text-secondary:rgba(245,245,247,0.62);--jb-text-tertiary:rgba(245,245,247,0.38);',
    '--jb-accent:#F7B211;--jb-accent-hover:#FFC53D;--jb-accent-pressed:#D99A0A;--jb-on-accent:#0A0A0B;',
    '--jb-glass-fill:rgba(255,255,255,0.055);--jb-glass-border:rgba(255,255,255,0.10);--jb-glass-edge:rgba(255,255,255,0.22);',
    '--jb-danger:#FF6B5A;',
    /* §11 token swap: user bubbles are amber, James stays neutral glass. To put
       amber on ALL bubbles, point --jb-bot-* at the accent here — one place. */
    '--jb-user-bg:var(--jb-accent);--jb-user-text:var(--jb-on-accent);',
    '--jb-bot-bg:rgba(255,255,255,0.04);--jb-bot-text:var(--jb-text-primary);--jb-bot-border:var(--jb-glass-border);',
    '--jb-ease:cubic-bezier(0.22,1,0.36,1);--jb-blur:24px;--jb-radius:18px;',
    'position:relative;display:flex;flex-direction:column;height:100%;min-height:420px;overflow:hidden;',
    'background:var(--jb-bg-base);border:1px solid rgba(255,255,255,0.06);border-radius:var(--jb-radius);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji",sans-serif;',
    'font-size:15px;line-height:1.6;letter-spacing:normal;color:var(--jb-text-primary);',
    'font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;',
    '}',
    /* Reset inherited box model so host CSS can't distort our layout. */
    '.jb-root *,.jb-root *::before,.jb-root *::after{box-sizing:border-box;}',

    /* --- Ambient light layer -------------------------------------------------
       Contained to the widget (position:absolute, not fixed) so the amber never
       bleeds onto the host lesson page. Sized in px (not vw) for the same
       reason — a viewport unit would balloon inside a small embed. The orbs are
       barely visible alone; their job is to give the glass something to
       refract. */
    '.jb-orbs{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;}',
    '.jb-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:0.9;will-change:transform;transition:opacity 700ms ease,filter 700ms ease;}',
    '.jb-orb-a{width:460px;height:460px;top:-26%;left:-18%;background:radial-gradient(circle at center,rgba(247,178,17,0.10),transparent 68%);animation:jb-drift-a 52s ease-in-out infinite;}',
    '.jb-orb-b{width:520px;height:520px;bottom:-30%;right:-20%;background:radial-gradient(circle at center,rgba(184,116,0,0.07),transparent 66%);animation:jb-drift-b 61s ease-in-out infinite;}',
    '.jb-orb-c{width:400px;height:400px;top:28%;right:-24%;background:radial-gradient(circle at center,rgba(42,53,80,0.05),transparent 70%);animation:jb-drift-c 47s ease-in-out infinite;}',
    '@keyframes jb-drift-a{0%{transform:translate(0,0) scale(1);}50%{transform:translate(40px,30px) scale(1.08);}100%{transform:translate(0,0) scale(1);}}',
    '@keyframes jb-drift-b{0%{transform:translate(0,0) scale(1);}50%{transform:translate(-46px,-28px) scale(1.06);}100%{transform:translate(0,0) scale(1);}}',
    '@keyframes jb-drift-c{0%{transform:translate(0,0) scale(1);}50%{transform:translate(-30px,36px) scale(1.1);}100%{transform:translate(0,0) scale(1);}}',
    /* The whole room responds while James thinks: orbs warm and quicken, then
       settle when the answer lands. This is the signature paying off. */
    '.jb-root.jb-busy .jb-orb{opacity:1;filter:blur(54px) saturate(1.2);}',
    '.jb-root.jb-busy .jb-orb-a{animation-duration:22s;}',
    '.jb-root.jb-busy .jb-orb-b{animation-duration:26s;}',
    '.jb-root.jb-busy .jb-orb-c{animation-duration:19s;}',

    /* --- Glass utility ------------------------------------------------------- */
    '.jb-glass{position:relative;background:var(--jb-glass-fill);',
    'backdrop-filter:blur(var(--jb-blur)) saturate(180%);-webkit-backdrop-filter:blur(var(--jb-blur)) saturate(180%);',
    'border:1px solid var(--jb-glass-border);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.14),0 8px 32px rgba(0,0,0,0.4);}',
    /* Specular top lip — light from above catching the edge. */
    '.jb-glass::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;',
    'background:linear-gradient(to bottom,rgba(255,255,255,0.18),transparent 40%);}',
    /* Fallback: on browsers without backdrop-filter, glass would read as a flat
       gray box, so give it a solid raised fill instead. */
    '@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){',
    '.jb-glass{background:var(--jb-bg-raised);}}',

    /* --- Layout: header / list / composer sit above the orbs ------------------ */
    '.jb-head,.jb-list,.jb-form{position:relative;z-index:1;}',
    '.jb-head{display:flex;align-items:center;gap:10px;padding:14px 18px;flex:0 0 auto;',
    'border-radius:0;border-left:none;border-right:none;border-top:none;font-weight:600;font-size:20px;letter-spacing:-0.01em;}',
    '.jb-title{color:var(--jb-text-primary);}',
    '.jb-dot{width:9px;height:9px;border-radius:50%;background:var(--jb-accent);flex:0 0 auto;',
    'box-shadow:0 0 0 0 rgba(247,178,17,0.5);animation:jb-pulse-dot 3.4s var(--jb-ease) infinite;}',
    '@keyframes jb-pulse-dot{0%{box-shadow:0 0 0 0 rgba(247,178,17,0.45);}70%{box-shadow:0 0 0 7px rgba(247,178,17,0);}100%{box-shadow:0 0 0 0 rgba(247,178,17,0);}}',

    '.jb-list{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:18px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch;}',

    /* --- Message bubbles (flat translucent fills — glass is reserved for chrome) */
    '.jb-row{display:flex;animation:jb-in 220ms var(--jb-ease) both;}',
    '.jb-row.jb-user{justify-content:flex-end;}',
    '@keyframes jb-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}',
    '.jb-bubble{max-width:86%;padding:11px 15px;font-size:15px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;border-radius:var(--jb-radius);}',
    '.jb-bot .jb-bubble{background:var(--jb-bot-bg);color:var(--jb-bot-text);border:1px solid var(--jb-bot-border);',
    'border-left:2px solid var(--jb-accent);border-top-left-radius:5px;}',
    '.jb-user .jb-bubble{background:var(--jb-user-bg);color:var(--jb-user-text);border-top-right-radius:5px;white-space:pre-wrap;font-weight:500;}',
    '.jb-bubble p{margin:0 0 8px;}',
    '.jb-bubble p:last-child{margin-bottom:0;}',
    '.jb-bubble h4{margin:12px 0 6px;font-size:15px;font-weight:700;letter-spacing:-0.01em;}',
    '.jb-bubble h4:first-child{margin-top:0;}',
    '.jb-bubble ul{margin:0 0 8px;padding-left:18px;}',
    '.jb-bubble ul:last-child{margin-bottom:0;}',
    '.jb-bubble li{margin:3px 0;}',
    '.jb-bubble li::marker{color:var(--jb-accent);}',
    '.jb-bubble code{background:var(--jb-bg-sunken);padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;}',
    '.jb-bubble strong{font-weight:700;color:#fff;}',
    /* The lead figure the count-up lands on — confident, tabular, amber. */
    '.jb-fig{font-weight:650;letter-spacing:-0.01em;color:var(--jb-accent);font-variant-numeric:tabular-nums;}',

    /* --- Thinking state ------------------------------------------------------ */
    '.jb-think-row{display:flex;}',
    '.jb-think{display:inline-flex;align-items:center;gap:10px;padding:11px 15px;border-radius:var(--jb-radius);',
    'background:var(--jb-bot-bg);border:1px solid var(--jb-bot-border);border-left:2px solid var(--jb-accent);border-top-left-radius:5px;',
    'color:var(--jb-text-secondary);font-size:14px;}',
    '.jb-think-dots{display:inline-flex;gap:4px;}',
    '.jb-think-dots i{width:6px;height:6px;border-radius:50%;background:var(--jb-accent);opacity:0.5;animation:jb-blink 1.2s var(--jb-ease) infinite;}',
    '.jb-think-dots i:nth-child(2){animation-delay:0.18s;}',
    '.jb-think-dots i:nth-child(3){animation-delay:0.36s;}',
    '@keyframes jb-blink{0%,100%{opacity:0.35;transform:translateY(0);}50%{opacity:1;transform:translateY(-2px);}}',

    /* --- Composer ------------------------------------------------------------ */
    '.jb-form{display:flex;gap:10px;align-items:center;padding:12px;flex:0 0 auto;margin:0 10px 10px;border-radius:14px;}',
    /* 16px font keeps iOS Safari from zooming the page on focus. */
    '.jb-input{flex:1 1 auto;min-width:0;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);',
    'background:var(--jb-bg-sunken);color:var(--jb-text-primary);font-size:16px;font-family:inherit;outline:none;transition:border-color 160ms var(--jb-ease),box-shadow 160ms var(--jb-ease);}',
    '.jb-input:focus{border-color:var(--jb-accent);box-shadow:0 0 0 3px rgba(247,178,17,0.22);}',
    '.jb-input::placeholder{color:var(--jb-text-tertiary);}',
    '.jb-send{flex:0 0 auto;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;',
    'border:none;border-radius:50%;background:var(--jb-accent);color:var(--jb-on-accent);cursor:pointer;',
    'transition:background 160ms var(--jb-ease),transform 120ms var(--jb-ease);}',
    '.jb-send:hover{background:var(--jb-accent-hover);}',
    '.jb-send:active{transform:scale(0.94);background:var(--jb-accent-pressed);}',
    '.jb-send:focus-visible{outline:2px solid var(--jb-accent-hover);outline-offset:2px;}',
    '.jb-send[disabled]{opacity:0.5;cursor:default;}',
    '.jb-send .jb-send-i{width:20px;height:20px;display:block;}',
    /* Send hints it is armed only when there is something to send. */
    '.jb-form.jb-armed .jb-send{animation:jb-arm 2.2s var(--jb-ease) infinite;}',
    '@keyframes jb-arm{0%,100%{box-shadow:0 0 0 0 rgba(247,178,17,0);}50%{box-shadow:0 0 0 5px rgba(247,178,17,0.18);}}',
    /* Visually-hidden text so the icon-only button still reads "Send". */
    '.jb-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}',

    '.jb-retry{margin-top:10px;background:transparent;border:1px solid var(--jb-accent);color:var(--jb-accent);',
    'border-radius:8px;padding:6px 13px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:background 160ms var(--jb-ease),color 160ms var(--jb-ease);}',
    '.jb-retry:hover{background:var(--jb-accent);color:var(--jb-on-accent);}',

    /* --- Inline calculator form (glass card inset into the thread) ----------- */
    '.jb-calc{max-width:100%;width:100%;border-radius:16px;padding:16px;animation:jb-card-in 320ms var(--jb-ease) both;}',
    '@keyframes jb-card-in{from{opacity:0;transform:scale(0.98);}to{opacity:1;transform:scale(1);}}',
    '.jb-calc-title{font-weight:700;font-size:15px;letter-spacing:-0.01em;margin:0 0 4px;color:var(--jb-text-primary);}',
    '.jb-calc-sub{color:var(--jb-text-secondary);font-size:13px;margin:0 0 14px;}',
    '.jb-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}',
    '.jb-label{font-size:13px;letter-spacing:0.01em;color:var(--jb-text-secondary);font-weight:600;}',
    '.jb-req{color:var(--jb-accent);margin-left:3px;}',
    '.jb-unit{color:var(--jb-text-tertiary);font-weight:400;}',
    '.jb-control{width:100%;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);',
    'background:var(--jb-bg-sunken);color:var(--jb-text-primary);font-size:16px;font-family:inherit;outline:none;',
    'transition:border-color 160ms var(--jb-ease),box-shadow 160ms var(--jb-ease);}',
    '.jb-control:focus{border-color:var(--jb-accent);box-shadow:0 0 0 3px rgba(247,178,17,0.22);}',
    '.jb-control[aria-invalid="true"]{border-color:var(--jb-danger);box-shadow:0 0 0 3px rgba(255,107,90,0.18);}',
    '.jb-adv{margin:4px 0 14px;}',
    '.jb-adv-toggle{background:transparent;border:none;color:var(--jb-accent);font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;padding:5px 0;}',
    '.jb-adv-toggle:hover{color:var(--jb-accent-hover);}',
    '.jb-adv-body{margin-top:12px;padding-top:12px;border-top:1px solid var(--jb-glass-border);}',
    '.jb-calc-actions{display:flex;gap:10px;align-items:center;margin-top:4px;}',
    '.jb-btn{border:none;border-radius:10px;padding:11px 20px;background:var(--jb-accent);color:var(--jb-on-accent);',
    'font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;transition:background 160ms var(--jb-ease),transform 120ms var(--jb-ease);',
    'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:118px;}',
    '.jb-btn:hover{background:var(--jb-accent-hover);}',
    '.jb-btn:active{transform:scale(0.97);background:var(--jb-accent-pressed);}',
    '.jb-btn:focus-visible,.jb-calc-cancel:focus-visible,.jb-adv-toggle:focus-visible,.jb-retry:focus-visible{outline:2px solid var(--jb-accent-hover);outline-offset:2px;}',
    '.jb-calc-cancel{background:transparent;border:1px solid rgba(255,255,255,0.14);color:var(--jb-text-secondary);',
    'border-radius:10px;padding:11px 16px;font-size:14px;font-family:inherit;cursor:pointer;transition:border-color 160ms var(--jb-ease),color 160ms var(--jb-ease);}',
    '.jb-calc-cancel:hover{border-color:var(--jb-text-secondary);color:var(--jb-text-primary);}',
    '.jb-calc-error{color:var(--jb-danger);font-size:12.5px;margin-top:10px;}',
    /* Session ARV pre-fill note — amber-tinted so it reads as the system
       having done work for you, with the bound address always visible. */
    '.jb-prefill-note{margin-top:5px;font-size:12px;line-height:1.45;color:var(--jb-accent);opacity:0.92;}',
    /* Disabled controls during a run: readable, obviously inert, not greyed to
       the point the member thinks the card broke. */
    '.jb-calc[data-busy="true"] .jb-control{opacity:0.55;cursor:default;}',
    '.jb-btn[disabled],.jb-calc-cancel[disabled]{opacity:0.68;cursor:default;}',
    '.jb-btn[disabled]:hover{background:var(--jb-accent);}',

    /* --- Calculating state ---------------------------------------------------
       Same room, working: the orbs warm via .jb-busy on the root (the existing
       thinking treatment), the button acknowledges the click with zero delay,
       and a skeleton of the result card stands where the answer will land. */
    '.jb-spin{width:13px;height:13px;flex:0 0 auto;border-radius:50%;',
    'border:2px solid rgba(10,10,11,0.28);border-top-color:var(--jb-on-accent);',
    'animation:jb-spin 620ms linear infinite;}',
    '@keyframes jb-spin{to{transform:rotate(360deg);}}',

    /* The amber left edge is the app's existing "James is producing this" mark —
       it is what makes .jb-think and the bot bubbles read on a near-black
       background. Without it the card was measurably in view but too dim to
       register as working, which is the whole point of the state. */
    '.jb-pending{max-width:100%;width:100%;border-radius:16px;padding:16px;animation:jb-card-in 320ms var(--jb-ease) both;',
    'border-left:2px solid var(--jb-accent);border-top-left-radius:5px;}',
    '.jb-pending-head{display:flex;align-items:center;gap:10px;color:var(--jb-text-primary);font-size:13px;font-weight:600;margin-bottom:14px;}',
    /* Full-strength amber dots here (the ambient .jb-think-dots sit at 0.5). */
    '.jb-pending .jb-think-dots i{opacity:0.9;}',
    '.jb-pending-bars{display:flex;flex-direction:column;gap:10px;}',
    '.jb-bar{height:12px;border-radius:6px;background:rgba(255,255,255,0.11);position:relative;overflow:hidden;}',
    '.jb-bar-lead{height:26px;width:52%;background:rgba(247,178,17,0.16);}',
    '.jb-bar:nth-child(2){width:88%;}',
    '.jb-bar:nth-child(3){width:70%;}',
    /* Amber sweep, not a grey shimmer — it reads as this app doing the work. */
    '.jb-bar::after{content:"";position:absolute;inset:0;transform:translateX(-100%);',
    'background:linear-gradient(90deg,transparent,rgba(247,178,17,0.34),transparent);',
    'animation:jb-sweep 1500ms var(--jb-ease) infinite;}',
    '.jb-bar-lead::after{background:linear-gradient(90deg,transparent,rgba(247,178,17,0.52),transparent);}',
    '.jb-bar:nth-child(2)::after{animation-delay:150ms;}',
    '.jb-bar:nth-child(3)::after{animation-delay:300ms;}',
    '@keyframes jb-sweep{to{transform:translateX(100%);}}',

    /* --- Responsive ---------------------------------------------------------- */
    /* Mobile: backdrop-filter is costlier per pixel, so soften the blur. */
    '@media (max-width:520px){.jb-root{--jb-blur:14px;}.jb-bubble{max-width:92%;font-size:14.5px;}.jb-list{padding:14px 12px;}.jb-head{font-size:18px;padding:13px 15px;}.jb-form{margin:0 8px 8px;}.jb-calc{padding:13px;}}',
    '@media (max-width:360px){.jb-form{gap:8px;padding:10px;}.jb-send{width:42px;height:42px;}}',

    /* --- Reduced motion: kill drift, count-up (JS-gated), and all transforms.
       Keep opacity fades — they aid comprehension and don't trigger vestibular
       issues. Hard requirement, not a nicety. */
    '@media (prefers-reduced-motion:reduce){',
    '.jb-orb,.jb-dot,.jb-think-dots i,.jb-form.jb-armed .jb-send{animation:none!important;}',
    '.jb-row{animation:jb-fade 200ms var(--jb-ease) both;}',
    '.jb-calc{animation:jb-fade 220ms var(--jb-ease) both;}',
    '.jb-send,.jb-btn,.jb-input,.jb-control{transition:none;}',
    '.jb-send:active,.jb-btn:active{transform:none;}',
    /* Feedback stays, motion goes: the skeleton holds still and the button
       label alone says "Calculating…" (the spinner is not built at all — see
       setCalculating/renderPending). */
    '.jb-pending{animation:jb-fade 220ms var(--jb-ease) both;}',
    '.jb-bar::after,.jb-spin{animation:none!important;}',
    '.jb-bar::after{display:none;}',
    '}',
    '@keyframes jb-fade{from{opacity:0;}to{opacity:1;}}',
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
    // Pre-existing per-browser session id so history survives a full reload.
    // Predates this redesign and is out of its visual scope; no NEW state is
    // stored. (See report on the §10 "no storage" tension.)
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

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  // --- Markdown ------------------------------------------------------------
  // The model replies in markdown ("- **Net Profit**: $101,916"). Escape
  // EVERYTHING first, then introduce a fixed set of tags — so no model (or
  // echoed user) content can inject markup, and innerHTML below is safe.

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
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      // Links, two forms (BUG-015). The comps property link is LOAD-BEARING
      // (the client's stated substitute for three waived matching criteria),
      // and neither form was parsed — the member saw literal brackets or a
      // dead URL string.
      //  1. [text](url) — the model sometimes dresses the block's bare URL
      //     this way despite relay-verbatim; parse it rather than show
      //     brackets. href is restricted to http(s) so no javascript: URL
      //     can ride in through model output.
      .replace(
        /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      //  2. Bare http(s) URLs — what format.ts actually emits. The preceding
      //     boundary (start/whitespace/paren) keeps URLs already inside an
      //     href="…" attribute from double-linking: those are preceded by a
      //     quote character.
      .replace(
        /(^|[\s(])(https?:\/\/[^\s<>()]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>',
      );
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

  // --- Count-up on the lead figure -----------------------------------------
  // The one flourish worth keeping: the headline number counts up on arrival.
  // Progressive enhancement only — it runs solely in a real browser that
  // reports motion preferences (jsdom has no matchMedia, so the test harness
  // skips it and message text is never touched). Wrapped in try/catch so it can
  // never break rendering, and the final value is always restored verbatim.

  function formatFigure(value, prefix, suffix, decimals) {
    var s = Math.abs(value).toFixed(decimals);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return prefix + parts.join('.') + suffix;
  }

  function countUp(span, finalText, target, prefix, suffix, decimals) {
    var dur = 600;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out
      if (p < 1) {
        span.textContent = formatFigure(target * eased, prefix, suffix, decimals);
        window.requestAnimationFrame(frame);
      } else {
        span.textContent = finalText; // exact original, guaranteed
      }
    }
    span.textContent = formatFigure(0, prefix, suffix, decimals);
    window.requestAnimationFrame(frame);
  }

  function animateLeadFigure(bubble) {
    try {
      // Skip in environments without matchMedia (the jsdom test harness, old
      // browsers): the message text is then left exactly as rendered.
      if (typeof window.matchMedia !== 'function') return;

      // A currency figure >= $1,000, or any percentage.
      var re = /-?\$\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$\d{4,}(?:\.\d+)?|\d{1,3}(?:\.\d+)?%/;
      var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var m = node.nodeValue.match(re);
        if (!m) continue;

        var matchText = m[0];
        var idx = m.index;
        var after = node.splitText(idx);
        after.nodeValue = after.nodeValue.slice(matchText.length);
        // The amber lead figure is a STATIC design choice (§5) — it stays amber
        // even when motion is off. Only the count-up itself is motion-gated.
        var span = el('span', 'jb-fig');
        span.textContent = matchText;
        after.parentNode.insertBefore(span, after);

        if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
          return; // amber, but no count-up
        }

        var prefix = matchText.indexOf('-') === 0 ? '-' : '';
        if (matchText.indexOf('$') !== -1) prefix += '$';
        var suffix = matchText.charAt(matchText.length - 1) === '%' ? '%' : '';
        var dot = matchText.indexOf('.');
        var decimals = dot === -1 ? 0 : matchText.replace('%', '').length - dot - 1;
        var target = Number(matchText.replace(/[^0-9.]/g, ''));
        if (!isFinite(target)) return;

        countUp(span, matchText, target, prefix, suffix, decimals);
        return; // lead figure only — one flourish, not every number
      }
    } catch (e) {
      /* enhancement only — never let it break the message */
    }
  }

  // --- Send icon (inline SVG; the accessible label is a visually-hidden span) -
  function sendButtonInner() {
    return (
      '<span class="jb-sr">Send</span>' +
      '<svg class="jb-send-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M4 12h13M11 6l7 6-7 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    );
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

      // Ambient light behind everything (decorative — hidden from a11y tree).
      var orbs = el('div', 'jb-orbs', { 'aria-hidden': 'true' });
      orbs.appendChild(el('div', 'jb-orb jb-orb-a'));
      orbs.appendChild(el('div', 'jb-orb jb-orb-b'));
      orbs.appendChild(el('div', 'jb-orb jb-orb-c'));
      root.appendChild(orbs);

      var header = el('div', 'jb-head jb-glass');
      header.appendChild(el('span', 'jb-dot', { 'aria-hidden': 'true' }));
      var title = el('span', 'jb-title');
      title.textContent = 'Ask James';
      header.appendChild(title);

      var list = el('div', 'jb-list', {
        role: 'log',
        'aria-live': 'polite',
        'aria-relevant': 'additions',
        'aria-label': 'Conversation with James',
      });

      var form = el('form', 'jb-form jb-glass');
      var input = el('input', 'jb-input', {
        type: 'text',
        placeholder: 'Ask James anything…',
        'aria-label': 'Message James',
        autocomplete: 'off',
      });
      var send = el('button', 'jb-send', { type: 'submit' });
      send.innerHTML = sendButtonInner();
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

      function addBubble(text, who, opts) {
        opts = opts || {};
        var stick = nearBottom();
        var row = el('div', 'jb-row ' + (who === 'user' ? 'jb-user' : 'jb-bot'));
        var bubble = el('div', 'jb-bubble');
        if (who === 'user') {
          bubble.textContent = text; // never parse member input as markup
        } else {
          renderMarkdownInto(bubble, text);
          if (opts.animate) animateLeadFigure(bubble);
        }
        row.appendChild(bubble);
        list.appendChild(row);
        if (stick) list.scrollTop = list.scrollHeight;
        return { row: row, bubble: bubble };
      }

      // Thinking indicator: honest rotating copy, and it warms the whole room
      // (jb-busy on root speeds/warms the orbs) so a 15–20s wait reads as
      // intentional, not stuck. Removed the instant the answer lands.
      function addTyping() {
        var stick = nearBottom();
        var row = el('div', 'jb-row jb-bot jb-think-row');
        var think = el('div', 'jb-think');
        var dots = el('span', 'jb-think-dots', { 'aria-hidden': 'true' });
        dots.innerHTML = '<i></i><i></i><i></i>';
        var label = el('span', 'jb-think-label');
        label.textContent = THINK_COPY[0] + '…';
        think.appendChild(dots);
        think.appendChild(label);
        row.appendChild(think);
        list.appendChild(row);
        root.classList.add('jb-busy');
        if (stick) list.scrollTop = list.scrollHeight;

        // aria-relevant="additions" means these text swaps are not re-announced.
        var i = 0;
        var timer = setInterval(function () {
          i = (i + 1) % THINK_COPY.length;
          label.textContent = THINK_COPY[i] + '…';
        }, 2800);

        return function remove() {
          clearInterval(timer);
          root.classList.remove('jb-busy');
          if (row.parentNode) row.parentNode.removeChild(row);
        };
      }

      // Calculating placeholder: a skeleton of the result card, standing where
      // the answer will land. Reuses the room-warming (jb-busy on root) that the
      // typed-message thinking state already uses, so a calculation reads as the
      // same system doing focused work rather than a bolted-on spinner.
      //
      // Under reduced motion the sweep and the dots are CSS-disabled and the
      // label is plain "Calculating…" — feedback without movement.
      function addPending() {
        var stick = nearBottom();
        var row = el('div', 'jb-row jb-bot');
        var card = el('div', 'jb-pending jb-glass', {
          role: 'status',
          'aria-live': 'polite',
          'data-pending': 'true',
        });

        var head = el('div', 'jb-pending-head');
        if (!prefersReducedMotion()) {
          var dots = el('span', 'jb-think-dots', { 'aria-hidden': 'true' });
          dots.innerHTML = '<i></i><i></i><i></i>';
          head.appendChild(dots);
        }
        var label = el('span', 'jb-pending-label');
        label.textContent = 'Calculating…';
        head.appendChild(label);
        card.appendChild(head);

        // Lead figure first, then two supporting lines — the shape of the
        // result card it is standing in for.
        var bars = el('div', 'jb-pending-bars', { 'aria-hidden': 'true' });
        bars.appendChild(el('div', 'jb-bar jb-bar-lead'));
        bars.appendChild(el('div', 'jb-bar'));
        bars.appendChild(el('div', 'jb-bar'));
        card.appendChild(bars);

        row.appendChild(card);
        list.appendChild(row);
        root.classList.add('jb-busy');
        if (stick) list.scrollTop = list.scrollHeight;

        return function remove() {
          root.classList.remove('jb-busy');
          if (row.parentNode) row.parentNode.removeChild(row);
        };
      }

      // Opening message: local and instant. The greeting and the pre-numbers
      // disclaimer are static copy — a model can forget them, static text can't.
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

      // --- Inline calculator form -----------------------------------------
      // Fields are whatever the server sent in render_form, which is derived
      // from the calculator tool schemas. The widget renders the descriptor and
      // knows nothing about which fields exist — add one to a schema and it
      // shows up here with no change to this file.

      function unitSuffix(field) {
        if (field.unit === 'usd') return ' ($)';
        if (field.unit === 'months') return ' (months)';
        if (field.unit === 'sf') return ' (sq ft)';
        // Decimals are sent to the calculator as decimals (0.12 = 12%). The UI
        // does NOT convert: a percent-to-decimal slip is a silent 100x error on
        // a financial number, so the expected form is stated instead.
        if (field.unit === 'decimal') return ' (decimal, e.g. 0.12)';
        return '';
      }

      /** One labelled control. Optional fields are pre-filled with their default. */
      function buildField(field) {
        var wrap = el('div', 'jb-field');
        var id = 'jb-f-' + field.name + '-' + Math.random().toString(36).slice(2, 8);

        var label = el('label', 'jb-label', { for: id });
        label.appendChild(document.createTextNode(field.label));
        var suffix = unitSuffix(field);
        if (suffix) {
          var unit = el('span', 'jb-unit');
          unit.textContent = suffix;
          label.appendChild(unit);
        }
        if (field.required) {
          var star = el('span', 'jb-req', { 'aria-hidden': 'true' });
          star.textContent = '*';
          label.appendChild(star);
        }

        var control;
        if (field.type === 'enum') {
          control = el('select', 'jb-control', { id: id, name: field.name });
          (field.options || []).forEach(function (option) {
            var node = el('option', null, { value: option });
            node.textContent = option;
            control.appendChild(node);
          });
        } else {
          control = el('input', 'jb-control', {
            id: id,
            name: field.name,
            type: 'text',
            inputmode: 'decimal',
            autocomplete: 'off',
          });
        }
        if (field.required) control.setAttribute('required', 'required');
        if (field.description) control.setAttribute('title', field.description);

        // Defaults are shown, but an untouched default is NOT submitted — the
        // tool applies it and reports it in defaults_applied, which is what the
        // answer discloses. Sending it back would erase that disclosure.
        if (field['default'] !== undefined && field['default'] !== null) {
          control.value = String(field['default']);
          control.setAttribute('data-default', String(field['default']));
        }

        wrap.appendChild(label);
        wrap.appendChild(control);

        // Session pre-fill (CONTRACT §8.1) — the ARV bound to this session's
        // comps run. DELIBERATELY NOT data-default: this is a required
        // field's value, and an untouched pre-fill must SUBMIT so the server
        // sees an explicit ARV (and runs its relay/override guards on it).
        // The label is the guarantee, enforced structurally: a prefill with
        // NO label is DECLINED outright — a bare number with no provenance
        // reads as something the member typed, which is the §8 bug in
        // miniature. Value and label render together or not at all.
        if (field.prefill && field.prefill.value !== undefined && field.prefill.label) {
          control.value = String(field.prefill.value);
          var note = el('div', 'jb-prefill-note');
          note.textContent = field.prefill.label; // textContent — never markup
          wrap.appendChild(note);
        }
        return wrap;
      }

      function renderCalculatorForm(spec) {
        var stick = nearBottom();
        var row = el('div', 'jb-row jb-bot');
        var card = el('div', 'jb-calc jb-glass', {
          role: 'group',
          'aria-label': spec.title + ' calculator inputs',
          'data-calculator': spec.calculator,
        });

        var title = el('p', 'jb-calc-title');
        title.textContent = spec.title + ' calculator';
        var sub = el('p', 'jb-calc-sub');
        sub.textContent = 'Fill in the required fields and hit Calculate.';
        card.appendChild(title);
        card.appendChild(sub);

        (spec.required || []).forEach(function (field) {
          card.appendChild(buildField(field));
        });

        // Optional fields are collapsed: they already carry James's standard
        // defaults, so the common path is to touch none of them.
        var optional = spec.optional || [];
        var advBody = null;
        if (optional.length) {
          var adv = el('div', 'jb-adv');
          var toggle = el('button', 'jb-adv-toggle', {
            type: 'button',
            'aria-expanded': 'false',
          });
          toggle.textContent = 'Show advanced options (' + optional.length + ')';
          advBody = el('div', 'jb-adv-body');
          advBody.style.display = 'none';
          optional.forEach(function (field) {
            advBody.appendChild(buildField(field));
          });
          toggle.addEventListener('click', function () {
            var open = advBody.style.display !== 'none';
            advBody.style.display = open ? 'none' : 'block';
            toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
            toggle.textContent =
              (open ? 'Show' : 'Hide') + ' advanced options (' + optional.length + ')';
          });
          adv.appendChild(toggle);
          adv.appendChild(advBody);
          card.appendChild(adv);
        }

        var actions = el('div', 'jb-calc-actions');
        var calcBtn = el('button', 'jb-btn', { type: 'button' });
        calcBtn.textContent = 'Calculate';
        var cancelBtn = el('button', 'jb-calc-cancel', { type: 'button' });
        cancelBtn.textContent = 'Cancel';
        actions.appendChild(calcBtn);
        actions.appendChild(cancelBtn);
        card.appendChild(actions);

        var errorNode = el('div', 'jb-calc-error', { role: 'alert' });
        card.appendChild(errorNode);

        function dismiss() {
          if (row.parentNode) row.parentNode.removeChild(row);
        }

        /** Read the controls. Untouched optional defaults are omitted. */
        function collectValues() {
          var values = {};
          var controls = card.querySelectorAll('.jb-control');
          Array.prototype.forEach.call(controls, function (control) {
            var name = control.getAttribute('name');
            var value = control.value == null ? '' : String(control.value).trim();
            var fallback = control.getAttribute('data-default');
            if (fallback !== null && value === fallback) return; // unchanged default
            if (!value) return;
            values[name] = value;
          });
          return values;
        }

        // Click-once. `submitting` is set SYNCHRONOUSLY inside the handler, so a
        // rapid double-click cannot start a second calculation: the second event
        // returns here before the first fetch has even been dispatched. The
        // disabled attribute is the visible half of the same guarantee.
        var submitting = false;
        var calcLabel = calcBtn.textContent;

        /**
         * The click acknowledgement. Called synchronously on click — nothing is
         * awaited before it, so there is no frame in which the member has
         * clicked and nothing has changed.
         */
        function setCalculating(on) {
          submitting = on;
          card.setAttribute('data-busy', on ? 'true' : 'false');
          calcBtn.disabled = on;
          cancelBtn.disabled = on;
          if (on) calcBtn.setAttribute('aria-busy', 'true');
          else calcBtn.removeAttribute('aria-busy');
          Array.prototype.forEach.call(card.querySelectorAll('.jb-control'), function (c) {
            c.disabled = on;
          });

          if (!on) {
            calcBtn.textContent = calcLabel;
            return;
          }
          calcBtn.textContent = '';
          // Under reduced motion the label alone carries it — no spinner node.
          if (!prefersReducedMotion()) calcBtn.appendChild(el('span', 'jb-spin'));
          calcBtn.appendChild(document.createTextNode('Calculating…'));
        }

        calcBtn.addEventListener('click', function () {
          if (submitting || busy) return;
          errorNode.textContent = '';
          Array.prototype.forEach.call(card.querySelectorAll('.jb-control'), function (c) {
            c.removeAttribute('aria-invalid');
          });

          // Required fields are validated SERVER-side against the same schema;
          // this only flags them locally so the member sees which box to fix.
          var values = collectValues();
          var blank = (spec.required || []).filter(function (field) {
            return values[field.name] === undefined;
          });
          if (blank.length) {
            blank.forEach(function (field) {
              var node = card.querySelector('[name="' + field.name + '"]');
              if (node) node.setAttribute('aria-invalid', 'true');
            });
            errorNode.textContent =
              'Please fill in: ' +
              blank
                .map(function (f) {
                  return f.label;
                })
                .join(', ') +
              '.';
            return;
          }

          // Acknowledge first, network second.
          setCalculating(true);
          submitCalculatorForm(spec, values, dismiss, errorNode, setCalculating);
        });

        cancelBtn.addEventListener('click', function () {
          if (submitting) return; // a run is in flight; nothing to cancel into
          dismiss();
        });

        row.appendChild(card);
        list.appendChild(row);
        if (stick) list.scrollTop = list.scrollHeight;
      }

      /**
       * Run a form submission.
       *
       * Every exit path resolves the calculating state — success, a 400, a
       * network failure, or a timeout. A spinner that never stops is worse than
       * the dead gap this replaces, so the timeout exists specifically so there
       * is no branch where the member is left watching it.
       */
      function submitCalculatorForm(spec, values, dismiss, errorNode, setCalculating) {
        started = true;
        setBusy(true);
        var removePending = addPending();
        var settled = false;

        /** Clear the calculating state exactly once, whichever way this ends. */
        function settle(message) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          removePending();
          setBusy(false);
          setCalculating(false);
          if (message) errorNode.textContent = message;
        }

        // Bounded: fetch has no timeout of its own, so a hung connection would
        // otherwise leave the button spinning indefinitely.
        var controller =
          typeof window.AbortController === 'function' ? new window.AbortController() : null;
        var timer = window.setTimeout(function () {
          if (controller) controller.abort();
          settle('That took too long to come back. Try Calculate again.');
        }, 90000);

        var init = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            member_email: memberEmail,
            form_submission: { calculator: spec.calculator, values: values },
          }),
        };
        if (controller) init.signal = controller.signal;

        fetch(apiUrl + '/chat', init)
          .then(function (res) {
            return res.json().then(
              function (data) {
                return { ok: res.ok, status: res.status, data: data };
              },
              function () {
                // A non-JSON body (proxy error page) must not read as success.
                return { ok: false, status: res.status, data: {} };
              },
            );
          })
          .then(function (result) {
            if (settled) return; // timed out already; ignore the late arrival
            // A 400 is a validation answer about THIS form — keep the form up
            // with the message on it rather than dropping a dead-end error
            // bubble the member cannot act on.
            if (!result.ok) {
              if (result.status === 400 && result.data && result.data.error) {
                settle(result.data.error);
                return;
              }
              settle("Couldn't reach the calculator — try Calculate again in a few seconds.");
              return;
            }
            settle();
            dismiss();
            // Echo the server's own transcript line so the chat matches what a
            // later /history replay will show.
            if (result.data.user_message) addBubble(result.data.user_message, 'user');
            // The result card transitions in with the existing entry animation
            // and the lead-figure count-up, straight out of the skeleton.
            addBubble(result.data.output || "I didn't catch that — try again.", 'bot', {
              animate: true,
            });
          })
          .catch(function () {
            settle("Couldn't reach the calculator — try Calculate again in a few seconds.");
          });
      }

      function submitMessage(override, skipEcho) {
        var text = typeof override === 'string' ? override : input.value.trim();
        if (!text || busy) return;
        if (typeof override !== 'string') {
          input.value = '';
          form.classList.remove('jb-armed');
        }
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
            addBubble(data.output || "I didn't catch that — try again.", 'bot', { animate: true });
            // The model decides a form is warranted; the response carries the
            // descriptor. Rendered after the reply so the copy reads first.
            if (data.render_form) renderCalculatorForm(data.render_form);
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

      // Send button hints it is armed only when there is something to send.
      input.addEventListener('input', function () {
        if (input.value.trim()) form.classList.add('jb-armed');
        else form.classList.remove('jb-armed');
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
          data.messages.forEach(function (m, idx) {
            var handle = addBubble(m.content, m.role === 'user' ? 'user' : 'bot');
            // Gentle stagger on a bulk repaint (capped); harmless under
            // reduced-motion, which overrides to a plain fade.
            handle.row.style.animationDelay = Math.min(idx * 40, 320) + 'ms';
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
