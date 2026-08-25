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
    'I can also pull comparable sales to help you determine ARV on a property. Just give me the full street address, including city and state.',
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
    /* TYPOGRAPHY BARRIER (Phase 3 embed audit): .jb-root explicitly sets
       font-family, font-size, line-height, letter-spacing and color, so
       INHERITED typography from the GHL rich-text container stops here, and
       every font:inherit inside the widget resolves against .jb-root.
       LOAD-BEARING BY OMISSION — unset here and WOULD inherit if the host
       container ever set them: font-weight, font-style, text-align,
       text-transform (none observed in the container's CSS; listed so a
       future rendering mystery starts its search here). Descendant selectors
       from the host are the other reach-in class — see the .jb-bubble p
       !important note below. */
    '.jb-root{',
    '--jb-bg-base:#0A0A0B;--jb-bg-raised:#141416;--jb-bg-sunken:#060607;',
    '--jb-text-primary:#F5F5F7;--jb-text-secondary:rgba(245,245,247,0.62);--jb-text-tertiary:rgba(245,245,247,0.38);',
    '--jb-accent:#F7B211;--jb-accent-hover:#FFC53D;--jb-accent-pressed:#D99A0A;--jb-on-accent:#0A0A0B;',
    '--jb-glass-fill:rgba(255,255,255,0.055);--jb-glass-border:rgba(255,255,255,0.10);--jb-glass-edge:rgba(255,255,255,0.22);',
    '--jb-danger:#FF6B5A;--jb-danger-solid:#D93025;',
    /* §11 token swap: user bubbles are amber, James stays neutral glass. To put
       amber on ALL bubbles, point --jb-bot-* at the accent here — one place. */
    '--jb-user-bg:var(--jb-accent);--jb-user-text:var(--jb-on-accent);',
    '--jb-bot-bg:rgba(255,255,255,0.04);--jb-bot-text:var(--jb-text-primary);--jb-bot-border:var(--jb-glass-border);',
    '--jb-ease:cubic-bezier(0.22,1,0.36,1);--jb-blur:24px;--jb-radius:18px;',
    /* S4.1 — the floor. Supported down to a 320px container; at 300px the
       widget stops adapting (min-width) and the HOST page scrolls
       horizontally instead. Stated consequence, not an accident: a scrollable
       300px widget beats 280px of wrapped nonsense. */
    'position:relative;display:flex;flex-direction:column;height:100%;min-height:420px;min-width:300px;overflow:hidden;',
    /* V-2: the 1px light border is GONE (operator call). It is free here, and
       that was checked rather than assumed: the portal sets
       body{background-color:var(--gray-50)} = #f9fafb, so a #0A0A0B widget on
       a near-white page is bounded by ~20:1 contrast — the border was only
       ever a faint inner edge ON the dark side, never the thing separating
       widget from page. Radius kept. */
    'background:var(--jb-bg-base);border-radius:var(--jb-radius);',
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
    'border-radius:0;border-left:none;border-right:none;border-top:none;font-weight:600;font-size:20px;letter-spacing:-0.01em;',
    /* V-2: drop the inset top highlight, KEEP the drop shadow — with the
       highlight gone the shadow is the only thing separating header from
       transcript, and losing both would flatten them together. Overridden
       HERE rather than edited on .jb-glass, which also dresses the composer,
       the calculator cards and the gate card; this call was the header. Wins
       on source order: same (0,1,0) specificity, declared later. */
    'box-shadow:0 8px 32px rgba(0,0,0,0.4);}',
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
    /* !important is LOAD-BEARING here, not sloppiness (ruled): the GHL
       lesson container (.editor-content.rich-text-viewer) sets
       `p { margin: 0 !important }` by DESCENDANT SELECTOR, which .jb-root
       scoping cannot stop — scoping keeps our styles from leaking OUT, not a
       parent's from reaching IN. Without this, James's multi-paragraph
       answers — comps output, step-by-step explanations, the widget's most
       valuable content — collapse into unspaced text. */
    '.jb-bubble p{margin:0 0 8px !important;}',
    '.jb-bubble p:last-child{margin-bottom:0 !important;}',
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
    '.jb-input{flex:1 1 auto;min-width:0;padding:12px 18px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);',
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
    // Only-a-link lines render as buttons (§14.18) — same anchor semantics,
    // button presentation. Colors ride the existing accent variable.
    '.jb-btnrow{margin:6px 0 4px;}',
    // Text rides --jb-on-accent (near-black), the widget's own token for
    // text on the amber accent — white was wrong against #F7B211.
    '.jb-btn-link{display:inline-block;padding:6px 14px;border-radius:8px;background:var(--jb-accent);color:var(--jb-on-accent) !important;text-decoration:none;font-size:12.5px;font-weight:600;line-height:1.4;}',
    '.jb-btn-link:hover{opacity:0.88;}',
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
    /* --- S4.1 CONTAINER TIERS ------------------------------------------
       Every width breakpoint is keyed on jb-w-* classes toggled from the
       ROOT'S OWN measured width, not on @media viewport queries. The widget
       lives in a GHL lesson COLUMN: a 500px column in a 1400px viewport fires
       no viewport query at all, so the rail stayed inline at 216px and the
       conversation got ~284px — exactly the cramming the old 560px query
       existed to prevent — and /demo renders full-width, so the whole class
       was invisible on the review surface.
       Tiers: jb-w-mid <=700 (S4.3 decram), jb-w-narrow <=560 (overlay rail),
       jb-w-tight <=400 (compact composer). The old viewport tiers at 520 and
       360 are CONSOLIDATED into narrow (560) and tight (400): container
       width runs slightly ahead of the old viewport numbers because the
       column is narrower than the screen that holds it.
       Coarse-pointer rules stay @media — pointer is a device property, not a
       width. */
    '.jb-root.jb-w-mid .jb-form{margin:0 8px 8px;padding:10px;gap:8px;}',
    '.jb-root.jb-w-mid .jb-send{width:40px;height:40px;}',
    '.jb-root.jb-w-mid .jb-side{width:184px;flex-basis:184px;}',
    '.jb-root.jb-w-mid .jb-bubble{max-width:92%;}',
    '.jb-root.jb-w-narrow{--jb-blur:14px;}',
    '.jb-root.jb-w-narrow .jb-bubble{font-size:14.5px;}',
    '.jb-root.jb-w-narrow .jb-list{padding:14px 12px;}',
    '.jb-root.jb-w-narrow .jb-head{font-size:18px;padding:13px 15px;}',
    '.jb-root.jb-w-narrow .jb-calc{padding:13px;}',
    '.jb-root.jb-w-tight .jb-form{gap:8px;padding:10px;}',
    '.jb-root.jb-w-tight .jb-send{width:42px;height:42px;}',

    /* --- Reduced motion: kill drift, count-up (JS-gated), and all transforms.
       Keep opacity fades — they aid comprehension and don't trigger vestibular
       issues. Hard requirement, not a nicety. */
    '@media (prefers-reduced-motion:reduce){',
    '.jb-orb,.jb-dot,.jb-think-dots i,.jb-form.jb-armed .jb-send{animation:none!important;}',
    '.jb-row{animation:jb-fade 200ms var(--jb-ease) both;}',
    '.jb-calc{animation:jb-fade 220ms var(--jb-ease) both;}',
    '.jb-send,.jb-btn,.jb-input,.jb-control{transition:none;}',
    '.jb-side{transition:none;}',
    '.jb-send:active,.jb-btn:active{transform:none;}',
    /* Feedback stays, motion goes: the skeleton holds still and the button
       label alone says "Calculating…" (the spinner is not built at all — see
       setCalculating/renderPending). */
    '.jb-pending{animation:jb-fade 220ms var(--jb-ease) both;}',
    '.jb-bar::after,.jb-spin{animation:none!important;}',
    '.jb-skel::after{animation:none!important;display:none;}',
    '.jb-bar::after{display:none;}',
    '}',
    '@keyframes jb-fade{from{opacity:0;}to{opacity:1;}}',

    /* --- Sidebar (Phase 1 multi-chat) --------------------------------------
       The pane below the header splits into rail + conversation. The rail is
       chrome: it uses the same glass tokens as the header so it reads as one
       surface, and it never competes with the message box for attention. */
    '.jb-body{display:flex;flex:1 1 auto;min-height:0;}',
    '.jb-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0;}',
    '.jb-side{display:flex;flex-direction:column;width:216px;flex:0 0 216px;min-height:0;',
    'border-right:1px solid var(--jb-glass-border);background:rgba(255,255,255,0.02);',
    'transition:width 160ms var(--jb-ease),flex-basis 160ms var(--jb-ease);overflow:hidden;}',
    /* Collapsed is width:0, not display:none — the rail animates shut and its
       controls leave the tab order with it. */
    '.jb-side-collapsed{width:0;flex-basis:0;border-right:none;}',
    '.jb-side-top{padding:10px;flex:0 0 auto;}',
    '.jb-new{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;cursor:pointer;',
    'font:inherit;font-size:12.5px;font-weight:650;color:var(--jb-on-accent);background:var(--jb-accent);',
    'border:none;transition:background 140ms var(--jb-ease);}',
    '.jb-new:hover{background:var(--jb-accent-hover);}',
    '.jb-new:active{background:var(--jb-accent-pressed);}',
    '.jb-side-list{flex:1 1 auto;overflow-y:auto;padding:0 6px 10px;min-height:0;}',
    '.jb-chat-row{display:flex;align-items:center;gap:2px;border-radius:8px;margin-bottom:2px;}',
    '.jb-chat-row:hover{background:rgba(255,255,255,0.05);}',
    '.jb-chat-active{background:rgba(247,178,17,0.14);}',
    '.jb-chat-open{flex:1 1 auto;min-width:0;text-align:left;background:none;border:none;cursor:pointer;',
    /* V-3: 6px -> 10px horizontal so the title and its timestamp sit visibly
       inside the row's rounded hover outline instead of grazing it. The
       action buttons are flex SIBLINGS and occupy layout even at opacity:0,
       so this pushes the title away from them, never underneath. */
    'font:inherit;font-size:12.5px;color:var(--jb-text-secondary);padding:8px 10px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    /* S3.1/S3.2 — row identity. The title and its timestamp stack inside the
       open button so the whole row surface stays one tap target; the time is
       part of the row's identity, not a separate control. */
    '.jb-chat-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.jb-chat-time{display:block;font-size:10.5px;line-height:1.3;color:var(--jb-text-tertiary);margin-top:1px;font-weight:400;}',
    /* The EPHEMERAL placeholder reads as a different kind of thing from a real
       row whose title merely has not arrived: italic, dimmed, and no
       timestamp (it has no last_message_at — nothing has happened in it). */
    '.jb-chat-pending .jb-chat-title{font-style:italic;color:var(--jb-text-tertiary);}',
    '.jb-chat-active .jb-chat-open{color:var(--jb-text-primary);font-weight:600;}',
    '.jb-chat-act{flex:0 0 auto;background:none;border:none;cursor:pointer;padding:4px 5px;border-radius:6px;',
    'color:var(--jb-text-tertiary);font:inherit;font-size:12px;line-height:1;opacity:0;',
    'transition:opacity 120ms var(--jb-ease),color 120ms var(--jb-ease);}',
    /* Row actions appear on hover or keyboard focus — focus-within is what
       keeps them reachable without a mouse. */
    '.jb-chat-row:hover .jb-chat-act,.jb-chat-row:focus-within .jb-chat-act{opacity:1;}',
    '.jb-chat-act:hover{color:var(--jb-text-primary);background:rgba(255,255,255,0.08);}',
    '.jb-chat-act:focus-visible{opacity:1;outline:2px solid var(--jb-accent);outline-offset:1px;}',

    /* S2.1 — ON TOUCH THE ACTIONS ARE ALWAYS VISIBLE.
       opacity:0 revealed on :hover/:focus-within means that on a phone rename
       and delete are not merely hard to reach, they are UNREACHABLE: there is
       no hover, and a tap on the row switches chat rather than focusing it. A
       coarse pointer gets no hover affordance to lose, so nothing is traded. */
    '@media (hover: none),(pointer: coarse){.jb-chat-act{opacity:1;}}',
    /* S2.2 — the in-widget delete confirmation. Replaces the row contents the
       way the rename input already does, so the control is anchored ON the row
       it acts on and needs no space for a title it cannot fit at 216px. */
    '.jb-chat-confirm{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:3px 4px 3px 6px;}',
    '.jb-chat-confirm-q{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    'font-size:12px;color:var(--jb-text-secondary);}',
    '.jb-chat-confirm-yes,.jb-chat-confirm-no{flex:0 0 auto;font:inherit;font-size:11.5px;font-weight:700;',
    'border-radius:6px;padding:5px 12px;cursor:pointer;border:1px solid transparent;}',
    '.jb-chat-confirm-yes{background:var(--jb-danger-solid);color:#FFFFFF;border-color:var(--jb-danger-solid);}',
    '.jb-chat-confirm-no{background:transparent;color:var(--jb-text-secondary);border-color:var(--jb-glass-border);}',
    '.jb-chat-confirm-no:hover{color:var(--jb-text-primary);border-color:var(--jb-text-secondary);}',
    '.jb-chat-confirm-yes:focus-visible,.jb-chat-confirm-no:focus-visible{outline:2px solid var(--jb-accent-hover);outline-offset:1px;}',
    /* A destructive control needs a real tap target where there is no cursor. */
    '@media (hover: none),(pointer: coarse){.jb-chat-confirm-yes,.jb-chat-confirm-no{padding:8px 10px;}}',
    '.jb-chat-rename-input{flex:1 1 auto;min-width:0;font:inherit;font-size:12.5px;padding:6px;',
    'border-radius:6px;border:1px solid var(--jb-glass-edge);background:var(--jb-bg-sunken);',
    'color:var(--jb-text-primary);}',
    '.jb-side-toggle{flex:0 0 auto;background:none;border:none;cursor:pointer;padding:4px 6px;margin-right:2px;',
    'border-radius:6px;color:var(--jb-text-tertiary);font:inherit;font-size:14px;line-height:1;}',
    '.jb-side-toggle:hover{color:var(--jb-text-primary);background:rgba(255,255,255,0.08);}',
    '.jb-side-empty{padding:10px 8px;font-size:12px;color:var(--jb-text-tertiary);}',

    /* --- Honest loading (S1.1/S1.2/S1.3) -----------------------------------
       Three states, three appearances. The rail used to collapse all three
       onto the empty copy, so a member with chats was told they had none for
       as long as the request took. A skeleton is deliberately inert: no text
       to misread, no control to click, and aria-hidden so a screen reader is
       not handed three meaningless rows (the list carries aria-busy instead). */
    '.jb-skel-row{display:flex;align-items:center;padding:8px 6px;margin-bottom:2px;}',
    '.jb-skel{height:9px;border-radius:5px;background:rgba(255,255,255,0.09);',
    'position:relative;overflow:hidden;display:block;}',
    '.jb-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);',
    'background:linear-gradient(90deg,transparent,rgba(255,255,255,0.13),transparent);',
    'animation:jb-sweep 1500ms var(--jb-ease) infinite;}',
    /* Widths carried by MODIFIER classes, not :nth-child — a skeleton may sit
       below real rows or an error notice, and positional selectors would
       re-shuffle the widths depending on what happened to precede them. */
    '.jb-skel-a{width:82%;}.jb-skel-b{width:64%;}.jb-skel-c{width:47%;}',
    '.jb-skel-b::after{animation-delay:150ms;}',
    '.jb-skel-c::after{animation-delay:300ms;}',
    '.jb-side-error{padding:10px 8px;font-size:12px;line-height:1.45;color:var(--jb-text-secondary);}',

    /* --- Phase 3: the member gate (S4) ------------------------------------
       The FIRST thing an ungated session sees — the gate replaces the
       conversation area outright rather than floating over a rendered chat,
       so there is no chat behind it to invite peeking. jb-gated hides the
       rail, its toggle and the composer. */
    '.jb-root.jb-gated .jb-side,.jb-root.jb-gated .jb-side-toggle,.jb-root.jb-gated .jb-form{display:none;}',
    '.jb-gate{max-width:400px;margin:auto;padding:26px 22px;border-radius:16px;text-align:left;width:100%;}',
    '.jb-gate-title{font-size:17px;font-weight:700;margin:0 0 6px;color:var(--jb-text-primary);}',
    '.jb-gate-copy{font-size:13.5px;line-height:1.55;color:var(--jb-text-secondary);margin:0 0 14px;}',
    '.jb-gate-row{display:flex;gap:8px;}',
    '.jb-gate-input{flex:1 1 auto;min-width:0;padding:11px 18px;border-radius:10px;border:1px solid rgba(255,255,255,0.08);',
    'background:var(--jb-bg-sunken);color:var(--jb-text-primary);font-size:16px;font-family:inherit;outline:none;}',
    '.jb-gate-input:focus{border-color:var(--jb-accent);box-shadow:0 0 0 3px rgba(247,178,17,0.22);}',
    '.jb-gate-btn{flex:0 0 auto;border:none;border-radius:10px;padding:11px 18px;background:var(--jb-accent);',
    'color:var(--jb-on-accent);font-weight:700;font-size:14px;font-family:inherit;cursor:pointer;}',
    '.jb-gate-btn:hover{background:var(--jb-accent-hover);}',
    '.jb-gate-btn[disabled]{opacity:0.6;cursor:default;}',
    '.jb-gate-btn:focus-visible,.jb-gate-retry:focus-visible{outline:2px solid var(--jb-accent-hover);outline-offset:2px;}',
    /* The three failure states are DIFFERENT PROBLEMS: copy distinguishes all
       three, and only could-not-check gets a retry control. */
    '.jb-gate-status{margin:12px 0 0;font-size:13px;line-height:1.5;color:var(--jb-danger);min-height:1em;}',
    '.jb-gate-status[data-kind="lookup_failed"]{color:var(--jb-text-secondary);}',
    '.jb-gate-retry{margin-top:10px;background:transparent;border:1px solid var(--jb-accent);color:var(--jb-accent);',
    'border-radius:8px;padding:6px 13px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;}',
    '.jb-gate-retry:hover{background:var(--jb-accent);color:var(--jb-on-accent);}',
    '.jb-side-retry{margin-top:8px;background:transparent;border:1px solid var(--jb-accent);',
    'color:var(--jb-accent);border-radius:7px;padding:5px 11px;font-size:12px;font-weight:700;',
    'font-family:inherit;cursor:pointer;transition:background 160ms var(--jb-ease),color 160ms var(--jb-ease);}',
    '.jb-side-retry:hover{background:var(--jb-accent);color:var(--jb-on-accent);}',
    '.jb-side-retry:focus-visible{outline:2px solid var(--jb-accent-hover);outline-offset:2px;}',

    /* Transcript skeleton: the SHAPE of a restored conversation — alternating
       sides, varied line counts — rather than a spinner, so the pane reads as
       "your conversation is coming back" instead of "something is happening". */
    '.jb-hist-skel{display:flex;flex-direction:column;gap:12px;}',
    '.jb-hist-line{display:flex;}',
    '.jb-hist-line.jb-hist-right{justify-content:flex-end;}',
    '.jb-hist-block{max-width:70%;border-radius:var(--jb-radius);padding:13px 15px;',
    'background:var(--jb-bot-bg);border:1px solid var(--jb-bot-border);',
    'border-left:2px solid var(--jb-accent);border-top-left-radius:5px;',
    'display:flex;flex-direction:column;gap:8px;min-width:130px;}',
    '.jb-hist-right .jb-hist-block{background:rgba(247,178,17,0.10);',
    'border:1px solid rgba(247,178,17,0.18);border-top-right-radius:5px;',
    'border-top-left-radius:var(--jb-radius);}',
    '.jb-hist-block .jb-skel{height:11px;}',
    /* Narrow hosts (a GHL lesson column) get the rail closed by default via
       the same collapsed class the toggle uses; nothing here is layout-only. */
    /* S4.2 — below the narrow tier the rail is a DRAWER: closed by default,
       slid in by the header toggle, dismissed by scrim tap, outside click, or
       Escape. The old behaviour had no scrim and no exit but the toggle. */
    '.jb-root.jb-w-narrow .jb-side{position:absolute;z-index:3;height:100%;width:216px;flex-basis:216px;',
    'background:var(--jb-bg-raised);box-shadow:0 8px 32px rgba(0,0,0,0.45);',
    'transform:translateX(-105%);transition:transform 200ms var(--jb-ease);}',
    '.jb-root.jb-w-narrow.jb-drawer-open .jb-side{transform:translateX(0);}',
    /* The desktop collapse preference must not leave a width-0 drawer: at
       narrow, the transform is the only thing that hides the rail. */
    '.jb-root.jb-w-narrow .jb-side.jb-side-collapsed{width:216px;flex-basis:216px;border-right:1px solid var(--jb-glass-border);}',
    '.jb-root.jb-w-narrow .jb-body{position:relative;}',
    /* The scrim: sits between the conversation and the drawer, tap closes.
       Display-gated on BOTH classes so it can never shade a wide layout. */
    '.jb-scrim{display:none;}',
    '.jb-root.jb-w-narrow.jb-drawer-open .jb-scrim{display:block;position:absolute;inset:0;z-index:2;',
    'background:rgba(0,0,0,0.45);}',
    /* S4.2 scroll lock — scoped INSIDE the widget subtree, never the host
       page: the drawer covers the widget, not the portal, so the page behind
       keeps scrolling and nothing outlives a GHL lesson swap by construction.
       Derived from the same class as the drawer, so they cannot desync. */
    '.jb-root.jb-drawer-open .jb-list{overflow:hidden;}',

    /* --- BUG-046: THE FORM-CONTROL DEFENSIVE LAYER ------------------------
       The gate's email input and the composer BOTH already set
       font-size:16px, and both still rendered at roughly double size in the
       portal. A property that is SET cannot be overridden by inheritance —
       inheritance only fills gaps — so this was never an omission: the host
       WINS THE CASCADE. Our form-control font rules sit at specificity
       (0,1,0), one class, and the winning host rule is (0,1,1).

       THE WINNING SELECTOR, captured from the live portal:
         .membership-preview-remote button, .membership-preview-remote input,
         .membership-preview-remote optgroup, .membership-preview-remote select,
         .membership-preview-remote textarea { font-size: 100% }
       Note WHAT it is: a browser-normalize RESET ("form controls inherit page
       typography"), not hostile styling — the intent is benign and the
       collision is structural. Note also WHERE: .membership-preview-remote is
       a PORTAL-WIDE wrapper, not the lesson-body container, so it reaches the
       widget wherever it mounts. And note its element list — button, input,
       optgroup, select, textarea — which is the 19-control exposure set
       confirmed by the selector itself rather than by our audit alone.

       THE GENERAL LESSON, same class as the .jb-bubble p margin fix one layer
       up: .jb-root scoping stops our styles leaking OUT; it does nothing
       about a parent's DESCENDANT SELECTORS reaching IN. Scoping is not
       isolation.

       Mechanism: element selectors under .jb-root lift us to (0,1,1),
       MATCHING that selector exactly rather than merely out-shouting it, with
       !important as the belt should the host rule ever become important.
       Placed last in the sheet so source order backs the specificity.

       STILL OPEN (not fixed here): `font-size: 100%` resolves against the
       PARENT's computed size, and .jb-root declares 15px — so if the chain
       were intact these controls would render 15px, not ~2x. Something in
       the ancestor chain is computing much larger, which means a host rule is
       also beating a NON-control rule of ours. This layer pins the controls
       regardless of what 100% resolves to, but it does not explain or fix
       that ancestor. See the report. */
    '.jb-root input,.jb-root select,.jb-root textarea,.jb-root button{',
    'font:inherit !important;letter-spacing:normal !important;text-transform:none !important;}',

    /* The layer above normalises everything to .jb-root's type. These
       re-assert each control's OWN size at (0,2,0) — two classes — so they
       outrank the (0,1,1) layer. Both sides are !important, so specificity
       decides and source order is NOT relied on (verified, not assumed). */
    '.jb-root .jb-input,.jb-root .jb-gate-input,.jb-root .jb-control{font-size:16px !important;}',
    /* Padding, same (0,2,0) tier. Declared per-control rather than as one
       shared rule because the VERTICAL values legitimately differ (12 vs
       11) and a shared shorthand would flatten that difference. */
    '.jb-root .jb-input{padding:12px 18px !important;}',
    '.jb-root .jb-gate-input{padding:11px 18px !important;}',
    '.jb-root .jb-btn,.jb-root .jb-gate-btn{font-size:14px !important;font-weight:700 !important;}',
    '.jb-root .jb-calc-cancel{font-size:14px !important;}',
    '.jb-root .jb-adv-toggle{font-size:13px !important;font-weight:700 !important;}',
    '.jb-root .jb-side-toggle{font-size:14px !important;line-height:1 !important;}',
    '.jb-root .jb-retry,.jb-root .jb-gate-retry{font-size:12.5px !important;font-weight:700 !important;}',
    '.jb-root .jb-side-retry{font-size:12px !important;font-weight:700 !important;}',
    '.jb-root .jb-new{font-size:12.5px !important;font-weight:650 !important;}',
    '.jb-root .jb-chat-open{font-size:12.5px !important;text-align:left !important;',
    'min-width:0 !important;overflow:hidden !important;}',
    '.jb-root .jb-chat-title{max-width:100% !important;overflow:hidden !important;',
    'text-overflow:ellipsis !important;white-space:nowrap !important;}',
    '.jb-root .jb-chat-active .jb-chat-open{font-weight:600 !important;}',
    '.jb-root .jb-chat-act{font-size:12px !important;line-height:1 !important;}',
    '.jb-root .jb-chat-rename-input{font-size:12.5px !important;}',
    '.jb-root .jb-chat-confirm-yes,.jb-root .jb-chat-confirm-no{',
    'font-size:11.5px !important;font-weight:700 !important;padding:5px 12px !important;}',
    '.jb-root .jb-chat-confirm-yes{background:var(--jb-danger-solid) !important;',
    'color:#FFFFFF !important;border-color:var(--jb-danger-solid) !important;}',
    '@media (hover: none),(pointer: coarse){',
    '.jb-root .jb-chat-confirm-yes,.jb-root .jb-chat-confirm-no{padding:8px 14px !important;}}',

    /* ::placeholder guard — LOAD-BEARING. Do not remove it as redundant.
       This comment previously said the opposite, and the correction is worth
       more than the rule.

       THE EVIDENCE: live, the control measured 15px while its placeholder
       measured 32px. A placeholder that INHERITED from its control cannot
       differ from it, so something targets ::placeholder directly and the
       control fix alone does not reach it.

       HOW THE ABSENCE WAS MISREAD: the earlier ruling — "nothing in the
       matched list targets ::placeholder, so fixing the control fixes the
       placeholder" — was inferred from a DevTools matched-rules pane scoped
       to the INPUT ELEMENT. Such a pane cannot show pseudo-element rules at
       all, so the absence was a property of the instrument, not of the
       stylesheet. Absence of evidence read as evidence of absence; the
       operator recorded the error as his own.

       Specificity here: `::placeholder` is a pseudo-ELEMENT, so it counts in
       the element column — `.jb-root input::placeholder` is (0,1,2). With
       !important it also survives an !important host rule, because
       important-vs-important is settled by specificity. Measured against five
       host shapes (bare, input::placeholder, class-scoped, doubly
       class-scoped, and !important): all five held. */
    '.jb-root input::placeholder,.jb-root textarea::placeholder{',
    'font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;}',

    /* --- V-1: SCROLLBARS, SCOPED TO OUR OWN SCROLL CONTAINERS -------------
       Every selector here is prefixed with .jb-list or .jb-side-list. A bare
       `::-webkit-scrollbar` inside this injected sheet would restyle the HOST
       PAGE's scrollbars — the reach-OUT direction of exactly the bug class
       BUG-046 was the reach-IN direction of. We do not do to GHL what
       .membership-preview-remote did to us.
       Not verifiable on /demo (no host scrollbars worth protecting there), so
       the guarantee is the selector prefix, checked in source. */
    '.jb-list::-webkit-scrollbar,.jb-side-list::-webkit-scrollbar{width:10px;height:10px;}',
    '.jb-list::-webkit-scrollbar-track,.jb-side-list::-webkit-scrollbar-track{background:transparent;}',
    /* transparent border + background-clip gives the thumb breathing room
       without a track that reads as a light channel on a near-black panel. */
    '.jb-list::-webkit-scrollbar-thumb,.jb-side-list::-webkit-scrollbar-thumb{',
    'background:rgba(255,255,255,0.14);border-radius:6px;',
    'border:2px solid transparent;background-clip:content-box;}',
    '.jb-list::-webkit-scrollbar-thumb:hover,.jb-side-list::-webkit-scrollbar-thumb:hover{',
    'background:rgba(255,255,255,0.26);border:2px solid transparent;background-clip:content-box;}',
    '.jb-list::-webkit-scrollbar-corner,.jb-side-list::-webkit-scrollbar-corner{background:transparent;}',
    /* Firefox — also scoped; `thin` is narrower than its default. */
    '.jb-list,.jb-side-list{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.18) transparent;}',
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

  // --- Chat registry (Phase 1 multi-chat) ------------------------------------
  //
  // Replaces getSessionId(). One chat IS one session id: chat_messages and
  // session_state are keyed on it verbatim, so switching chats isolates both
  // the transcript AND the comps/ARV context with no server-side plumbing.
  //
  // Storage keys, all localStorage:
  //   james-bot-device            'device:<uuid>' — the owner key (see below)
  //   james-bot-active-chat       last active chat id, so a reload lands back
  //   james-bot-sidebar-collapsed '1' when the rail is shut
  //   james-bot-session           RETIRED. Never read, never written — ERASED
  //                               on mount (see clearRetiredKeys).
  /**
   * Phase 3: THE CLIENT STOPS ASSERTING AN OWNER (ruled). Identity is the
   * HMAC token from POST /auth, in SESSIONSTORAGE deliberately: it survives a
   * refresh and dies on tab close — not localStorage (must not outlive the
   * tab), not a cookie (the widget is third-party to the API origin and
   * cookie blocking would break it outright).
   */
  var TOKEN_KEY = 'james-bot-token';
  /** RETIRED with Phase 3 — never read, never written, ERASED on mount like
   * james-bot-session before it: the widget no longer asserts device owners,
   * and a live-looking key invites the next reader to build on it. */
  var DEVICE_KEY = 'james-bot-device';
  var ACTIVE_KEY = 'james-bot-active-chat';
  var COLLAPSE_KEY = 'james-bot-sidebar-collapsed';
  var LEGACY_KEY = 'james-bot-session';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null; // Safari private mode / storage disabled — degrade, never throw.
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* nothing to do: the chat still works, it just will not survive a reload */
    }
  }

  /**
   * The owner key. Unguessable and device-scoped ON PURPOSE (ruling R2):
   * member_email is client-asserted and 'unknown' on ~18% of turns, so keying
   * the chat LIST on it would let anyone enumerate another member's chats by
   * guessing an address. This keeps today's exposure posture exactly — holding
   * the key is the capability, same as holding a session id already is.
   *
   * PHASE 3 rewrites these values server-side to 'email:<verified-addr>' on
   * first verified login per device, which is when chats become cross-device.
   * Nothing here needs to change for that.
   */
  function sessionGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null; // storage disabled — the member re-auths per pageload
    }
  }

  function sessionSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      /* the session still works; it will not survive a refresh */
    }
  }

  function sessionRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (e) {
      /* nothing to remove */
    }
  }

  /**
   * W1 LEGACY ADOPTION IS GONE (operator ruling). Adoption necessarily meant a
   * CLIENT asserting ownership of a transcript, and with gating live from day
   * one that assertion would land directly in a VERIFIED email account with no
   * later rewrite step able to refuse it. Dropping it makes the attack
   * structurally impossible instead of merely checked: the widget never reads
   * a session id out of storage, so planting one cannot surface a chat.
   *
   * The retired key is ERASED rather than ignored. Leaving a live-looking
   * 'james-bot-session' in every member's browser invites the next reader to
   * build a wrong model on it; deleting a key we have decided never to honour
   * says what we decided.
   */
  function clearRetiredKeys() {
    try {
      window.localStorage.removeItem(LEGACY_KEY);
      window.localStorage.removeItem(DEVICE_KEY); // retired with Phase 3
    } catch (e) {
      /* storage disabled — nothing to erase, and nothing depends on it */
    }
  }

  /**
   * fetch that can only ever REJECT, never throw.
   *
   * The widget's founding rule is that no network call can break mounting, and
   * `fetch` itself is a host-page global: a monkeypatched or hostile one can
   * throw synchronously, and that throw would escape mount() and leave the
   * member with no chat at all. A rejected promise routes into the same
   * degradation paths every other failure uses.
   */
  function safeFetch(url, init) {
    try {
      return window.fetch(url, init);
    } catch (e) {
      return Promise.reject(e);
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

      // A line that is ONLY a link renders as a BUTTON (general rule, no
      // comps coupling). The http(s) restriction gates the button exactly as
      // it gates the inline anchor — and it matters MORE here: a button is a
      // more inviting target, so a model-authored javascript: URL must fail
      // this match and fall through to inlineMarkdown, whose link regexes
      // also refuse it — it renders as inert literal text, never a control.
      var onlyMd = line.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
      var onlyBare = !onlyMd && /^https?:\/\/[^\s<>()]+$/.test(line) ? line : null;
      if (onlyMd || onlyBare) {
        closeList();
        var btnHref = onlyMd ? onlyMd[2] : onlyBare;
        var btnText = onlyMd ? onlyMd[1] : onlyBare;
        html +=
          '<p class="jb-btnrow"><a class="jb-btn-link" href="' + btnHref +
          '" target="_blank" rel="noopener noreferrer">' + btnText + '</a></p>';
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
    // VESTIGIAL, KEPT (P3 hard contract): the widget now collects and
    // verifies the email itself, so this option plays no part in identity —
    // but removing it from the signature would force a hand-edit of the live
    // GHL snippet, which is not in version control. Accepted and ignored for
    // auth; it still rides the /chat body's member_email field, which the
    // server treats as telemetry, never identity.
    var memberEmail = options.memberEmail || 'unknown';
    // The owner key is per-device and long-lived; the chat id is per-chat and
    // changes on every switch. `sessionId` is whatever chat is active right
    // now — every /chat and /history call reads it at call time, never closes
    // over it, so an in-flight request cannot post to the chat you just left.
    // (Phase 3: `var deviceKey` stood here — the client no longer asserts an
    // owner, so the variable went with the header it fed. The P1 pin on the
    // call-time sessionId mechanism was re-pointed to exclude the deleted
    // line; the mechanism itself is unchanged.)
    var sessionId = null;
    /**
     * The session token, or null when the member has not passed the gate.
     * SESSION identity, not conversation state — deliberately NOT in
     * resetChatState's list (P2): a chat switch changes which conversation is
     * open, never who the member is. It is cleared in exactly one place —
     * authExpired(), when the server says the session is over.
     */
    var authToken = null;
    var lastAuthEmail = ''; // re-auth prefill only; never sent unverified

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
      var sideToggle = el('button', 'jb-side-toggle', {
        type: 'button',
        'aria-label': 'Toggle chat list',
        'aria-expanded': 'true',
        title: 'Chats',
      });
      sideToggle.textContent = '☰';
      header.appendChild(sideToggle);
      header.appendChild(el('span', 'jb-dot', { 'aria-hidden': 'true' }));
      var title = el('span', 'jb-title');
      title.textContent = 'Ask James';
      header.appendChild(title);

      // Rail + conversation. The list and the form move INSIDE .jb-main so the
      // rail sits beside the whole conversation column rather than above it.
      var body = el('div', 'jb-body');
      var side = el('aside', 'jb-side', { 'aria-label': 'Your chats' });
      var sideTop = el('div', 'jb-side-top');
      var newChatBtn = el('button', 'jb-new', { type: 'button' });
      newChatBtn.textContent = '+  New chat';
      sideTop.appendChild(newChatBtn);
      var sideList = el('div', 'jb-side-list', { role: 'list' });
      side.appendChild(sideTop);
      side.appendChild(sideList);
      var main = el('div', 'jb-main');

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

      main.appendChild(list);
      main.appendChild(form);
      var scrim = el('div', 'jb-scrim', { 'aria-hidden': 'true' });
      body.appendChild(side);
      body.appendChild(scrim);
      body.appendChild(main);
      root.appendChild(header);
      root.appendChild(body);
      target.appendChild(root);

      /**
       * S4.1 — width classes from the root's OWN width. ResizeObserver where
       * it exists (universal in practice); fallback is a mount-time measure
       * plus window resize, which tracks column changes that come from
       * viewport changes and misses only host-side column resizes at equal
       * viewport — a degradation, not a different system: same classes,
       * same CSS, nothing duplicated to drift.
       *
       * Lifecycle: the observer watches a node inside the widget's own
       * subtree, so a GHL lesson swap that discards the subtree ends it —
       * nothing external holds a reference. The document guard covers jsdom
       * teardown (the MutationObserver class).
       */
      function applyWidthClasses() {
        if (typeof document === 'undefined') return;
        var w = root.clientWidth;
        if (!w) return; // display:none or not yet laid out — keep last classes
        root.classList.toggle('jb-w-mid', w <= 700);
        root.classList.toggle('jb-w-narrow', w <= 560);
        root.classList.toggle('jb-w-tight', w <= 400);
        // Crossing a tier re-derives the drawer. Leaving narrow CLEARS the
        // flag, not just the class: a flag that survived the wide layout
        // would silently reopen the drawer on the next narrowing — a drawer
        // nobody asked for, covering the conversation.
        if (!isNarrow()) {
          drawerOpen = false;
          applyCollapsed(storageGet(COLLAPSE_KEY) === '1');
        }
        applyDrawer();
      }
      if (typeof window.ResizeObserver === 'function') {
        new window.ResizeObserver(applyWidthClasses).observe(root);
      } else {
        window.addEventListener('resize', applyWidthClasses);
      }
      applyWidthClasses();

      function isNarrow() {
        return root.classList.contains('jb-w-narrow');
      }

      /**
       * S4.2/S4.5 — the drawer's ONE renderer. The root class (which carries
       * the scrim and the scroll lock in CSS) is DERIVED from the flag here,
       * so flag and presentation cannot desync. `drawerOpen` is transient
       * per-chat-ish state and joins resetChatState; the persisted COLLAPSE
       * preference is a different thing (how I like my rail) and applies only
       * at wide widths.
       */
      function applyDrawer() {
        var open = Boolean(drawerOpen) && isNarrow();
        root.classList.toggle('jb-drawer-open', open);
        if (isNarrow()) {
          side.setAttribute('aria-hidden', open ? 'false' : 'true');
          sideToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
      }

      function closeDrawer() {
        if (!drawerOpen) return;
        drawerOpen = false;
        applyDrawer();
      }

      // Collapsed state is remembered per device (W3) — wide widths only.
      function applyCollapsed(collapsed) {
        if (collapsed) side.classList.add('jb-side-collapsed');
        else side.classList.remove('jb-side-collapsed');
        side.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
        sideToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
      applyCollapsed(storageGet(COLLAPSE_KEY) === '1');
      sideToggle.addEventListener('click', function () {
        if (isNarrow()) {
          // The drawer. NOT persisted: a reload must open on the
          // conversation, never under a drawer left standing.
          drawerOpen = !drawerOpen;
          applyDrawer();
          return;
        }
        var collapsed = !side.classList.contains('jb-side-collapsed');
        applyCollapsed(collapsed);
        storageSet(COLLAPSE_KEY, collapsed ? '1' : '0');
      });

      // The scrim needs NO click handler of its own: the document capture
      // listener below fires before any bubble could reach one, and the scrim
      // is outside the drawer, so a scrim tap IS an outside click. A dedicated
      // handler here would be dead code that no test could distinguish from
      // the working mechanism — the mutation driver proved exactly that.

      // Escape closes the drawer — unless an inner control already used it
      // (the rename input and the delete confirm both preventDefault their
      // Escape), so cancelling a rename does not also yank the drawer away.
      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        closeDrawer();
      });

      /**
       * Outside click. This is the ONE registration outside the widget's
       * subtree, and it is a listener, not a DOM write: nothing about the
       * page is mutated. It self-removes on the first event after the
       * subtree is discarded (a GHL lesson swap has no unmount hook to tell
       * us sooner), so at most one dead no-op firing survives a swap.
       */
      function onDocumentClick(event) {
        if (typeof document === 'undefined') return; // jsdom teardown
        if (!root.isConnected) {
          document.removeEventListener('click', onDocumentClick, true);
          return;
        }
        if (!drawerOpen || !isNarrow()) return;
        if (side.contains(event.target) || sideToggle.contains(event.target)) return;
        closeDrawer();
      }
      document.addEventListener('click', onDocumentClick, true);

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

      // --- Per-chat state (Phase 1 multi-chat) -----------------------------
      // Everything below that belongs to the CONVERSATION is cleared by
      // resetChatState(). Registry state (the chats list and the collapsed
      // rail) is deliberately NOT — the sidebar must survive a switch. The
      // active chat is `sessionId`; there is no second variable for it.
      var busy = false;
      var started = false;
      var chats = [];
      /**
       * S1.1 — the rail has THREE states, not two.
       *
       * `chats.length === 0` was painted as "No chats yet" from the moment of
       * mount, BEFORE /chats had been asked. For a returning member with a
       * full sidebar that is not a slow UI, it is a false statement, and it
       * held for the entire request (measured at 618ms locally).
       *
       *   'loading'  not asked yet, or asked and still out
       *   'ready'    asked and answered — an empty list here really IS empty
       *   'error'    asked and failed, which is NOT the same as empty
       *
       * REGISTRY state, so like `chats` it is deliberately NOT in
       * resetChatState: it describes the chat LIST, which outlives any one
       * conversation. Clearing it on a switch would flip a rail that has
       * already loaded back to skeletons on every chat change.
       */
      var chatsState = 'loading';
      /**
       * R6a/R6b: THE placeholder. Non-null means `sessionId` names a chat that
       * has no database row yet — one mechanism serving all three first-chat
       * cases (an empty list, "+ New chat", and W1 legacy adoption), because
       * two code paths that merely look alike drift.
       *
       * Placeholders are EPHEMERAL: never written to localStorage, never in
       * the registry, gone on reload. Five "+ New chat" clicks give five rows
       * and zero writes; a reload collapses them to one fresh placeholder,
       * which is correct — nothing was in them.
       */
      var placeholderId = null;
      var renamingId = null;
      /**
       * S2.2 — the row holding an open delete confirmation, or null.
       *
       * A SCALAR, like renamingId and placeholderId: only one destructive
       * question can be open at a time, so a second one cannot be left
       * hanging off-screen where the member cannot see what they agreed to.
       */
      var confirmingId = null;
      /**
       * S1.2 — the transcript skeleton, held in ONE variable so there is
       * exactly one thing to tear down. Conversation state: it belongs to the
       * chat whose history is being fetched, so it is enumerated in
       * resetChatState below.
       */
      var historySkeleton = null;
      /**
       * R3-b — the welcome bubble's row, so suppression can remove it when a
       * transcript exists. The NODE dies with list.innerHTML on reset; the
       * REFERENCE is cleared in resetChatState (FINDING-019 class).
       */
      var welcomeRow = null;
      /**
       * FINDING-027 — the turns painted into THIS pane since the last reset,
       * as {role, content}. A late /history snapshot can already contain the
       * newest of these (the fetch was ISSUED before the member sent, but the
       * server read the table AFTER their turn landed), and prepending it
       * verbatim would paint their message twice. The prepend trims the
       * snapshot suffix that matches these before inserting.
       */
      var liveTurns = [];
      /**
       * S3.3 — the single pending title refetch, or null. REGISTRY state like
       * `chats` and `chatsState`, deliberately NOT in resetChatState: the
       * refetch repairs the rail's titles, which outlive any one conversation,
       * and cancelling it on a chat switch would lose the title of the chat
       * just left. Single-flight: while one is pending, no second is armed.
       */
      var titleRefetchTimer = null;
      /**
       * S4.2/S4.5 — the drawer below the narrow tier. Transient, never
       * persisted, joins resetChatState. Distinct from the persisted collapse
       * preference: one is "how I like my rail", the other is "a panel is
       * momentarily covering things".
       */
      var drawerOpen = false;
      /**
       * Generation counter — bumped by every reset. Async callbacks capture
       * the generation they began in and bail if it has moved.
       *
       * Aborting in-flight fetches is the first line of defence; this is the
       * second, and it is the one that holds when AbortController is missing,
       * when a response has already arrived and is merely queued behind a
       * microtask, or when a .catch would otherwise paint a connection error
       * into a chat the member has already left. Without it, chat A's answer
       * lands in chat B — the exact leak W4 exists to close.
       */
      var generation = 0;
      var inFlight = [];

      /** Register a cancellable operation. Every network call in this widget goes through it. */
      function beginOp() {
        var op = {
          gen: generation,
          controller:
            typeof window.AbortController === 'function' ? new window.AbortController() : null,
          cleanup: null,
        };
        inFlight.push(op);
        return op;
      }

      function endOp(op) {
        var index = inFlight.indexOf(op);
        if (index !== -1) inFlight.splice(index, 1);
      }

      /** True when this operation belongs to a chat the member has left. */
      function stale(op) {
        return op.gen !== generation;
      }

      /**
       * The member has committed content to this chat (S1.2).
       *
       * The skeleton comes down HERE as well as in loadHistory's .then because
       * those are two different moments: the fetch can still be out when the
       * member sends, and a skeleton left standing above their own message
       * claims their conversation is still loading while they are already
       * having it.
       *
       * This is not a second reset path (P2) — nothing is reset. It is the one
       * place that records "this chat now has member content", and a skeleton
       * is by definition the stand-in for content that has not arrived, so the
       * two move together or they drift apart.
       */
      function markStarted() {
        started = true;
        clearHistorySkeleton();
      }

      /** The static welcome — local and instant, and re-shown on every reset. */
      function showWelcome() {
        welcomeRow = addBubble(OPENING_MESSAGE, 'bot').row;
      }

      /**
       * R3-b (S4.4 pulled forward by ruling): the welcome is SUPPRESSED when a
       * transcript exists — a returning member must not read "Hi! I'm James…"
       * above yesterday's conversation. Only visibility changes; the
       * contract-pinned OPENING_MESSAGE string is untouched, and new chats and
       * placeholders still open on it.
       */
      function removeWelcome() {
        if (!welcomeRow) return;
        var row = welcomeRow;
        welcomeRow = null;
        if (row.parentNode) row.parentNode.removeChild(row);
      }

      function setBusy(state) {
        busy = state;
        send.disabled = state;
      }

      /**
       * THE CHAT-SWITCH RESET (W4). One function, one explicit list — the
       * variables are enumerated here rather than cleared at their use sites
       * so that "what belongs to a chat" is answerable by reading one place.
       *
       * Deliberately NOT reset, each for a stated reason:
       *   chats                 registry, not conversation — the sidebar must
       *                         still be there after the switch
       *   chatsState            registry for the same reason (S1.1): it
       *                         describes the LIST, not this conversation.
       *                         Resetting it would send an already-loaded rail
       *                         back to skeletons on every chat switch.
       *   sidebar collapsed     a device preference, not chat state
       *   authToken             SESSION identity, not conversation state
       *                         (S4, ruled EXCLUDED): a chat switch changes
       *                         which conversation is open, never who the
       *                         member is. Cleared only by authExpired().
       *   apiUrl / memberEmail  mount configuration
       *   busy/started/etc.     ARE reset, below
       */
      function resetChatState() {
        // 1. Invalidate every callback that is already scheduled.
        generation += 1;
        // 2. Cancel in-flight network work and any timer it owns (the
        //    calculator's 90s timeout, the thinking-copy interval).
        for (var i = 0; i < inFlight.length; i++) {
          var op = inFlight[i];
          try {
            if (op.cleanup) op.cleanup();
          } catch (e) {
            /* a cleanup must never block the rest of the reset */
          }
          try {
            if (op.controller) op.controller.abort();
          } catch (e) {
            /* aborting an already-settled fetch throws in some engines */
          }
        }
        inFlight.length = 0;
        // 3. Transcript DOM. This is also what clears any open or half-filled
        //    calculator form and the ARV pre-fill VALUES rendered into it —
        //    that state lives only in those nodes (server-side it is keyed by
        //    session_id, which is the chat id we are leaving).
        list.innerHTML = '';
        // 3b. FINDING-019 again, for the history skeleton (S1.2): the NODE
        //     went with the innerHTML above, but the REFERENCE did not. A live
        //     reference to a detached node makes the next clearHistorySkeleton
        //     a silent no-op — it would null out its own handle and leave the
        //     NEXT chat's skeleton on screen forever. Enumerated here rather
        //     than cleared at a call site, per the rule this list exists for.
        historySkeleton = null;
        // 3c. The welcome row reference (R3-b): its node went with the
        //     innerHTML above; a live reference would make the next
        //     removeWelcome a no-op on a detached node (FINDING-019 class).
        //     showWelcome below re-sets it.
        welcomeRow = null;
        // 3d. The live-turn record (FINDING-027): it describes the pane just
        //     cleared. Carrying it into the next chat would let that chat's
        //     prepend trim MESSAGES IT NEVER SHOWED.
        liveTurns = [];
        // NOT reset, alongside chats/chatsState: titleRefetchTimer. It is
        // registry work — the title it fetches belongs to the rail, not to
        // the conversation being left, and its callback touches only
        // registry state.
        // 4. Pending/typing indicators: their rows went with the DOM above;
        //    this clears the room-warming class they set on the ROOT, which
        //    would otherwise persist into the next chat.
        root.classList.remove('jb-busy');
        // 5. Send lock.
        busy = false;
        send.disabled = false;
        // 6. History-restore guard: the next chat must be allowed to repaint.
        started = false;
        // 7. Composer contents and its armed hint.
        input.value = '';
        form.classList.remove('jb-armed');
        // 8. Scroll position.
        list.scrollTop = 0;
        // 9. Any half-open inline rename in the rail.
        renamingId = null;
        // 9aa. The drawer (S4.5): a reset lands the member in a fresh pane,
        //      and a drawer left standing would cover the very thing the
        //      switch produced. Closing it here is also what gives
        //      close-on-chat-pick for free — every switch runs this reset.
        //      The scroll-lock class is DERIVED from the flag in applyDrawer,
        //      so the two cannot desync.
        drawerOpen = false;
        applyDrawer();
        // 9a. Any open delete confirmation (S2.2). Same reasoning as the
        //     rename, with more at stake: a half-taken DESTRUCTIVE question
        //     must not survive into another chat, where the row it refers to
        //     may not even be on screen any more.
        confirmingId = null;
        // 9b. FINDING-019: the placeholder is per-chat state, so clearing it
        //     belongs HERE rather than on the next line of each caller. Every
        //     caller that wants one sets it AFTER this returns.
        placeholderId = null;
        // 10. The welcome state the member should land in.
        showWelcome();
      }

      // --- Chat registry plumbing -----------------------------------------

      /**
       * Every /chats call. The owner key rides a HEADER, never the query
       * string: it is an unguessable bearer capability this phase, and query
       * strings land in access logs, proxy logs and Referer headers.
       */
      function chatsApi(pathname, init) {
        init = init || {};
        // Phase 3: identity is the TOKEN. The widget asserts no owner —
        // x-james-owner is gone from every request it makes.
        var headers = { authorization: 'Bearer ' + (authToken || '') };
        if (init.body) headers['content-type'] = 'application/json';
        init.headers = headers;
        return safeFetch(apiUrl + pathname, init).then(function (res) {
          if (res.status === 401) {
            // The session is over (expired / rejected). Kick off re-auth and
            // still reject so in-flight callers stop cleanly.
            return res.json().then(
              function (body) {
                authExpired(body && body.reason);
                throw new Error('HTTP 401');
              },
              function () {
                authExpired('expired');
                throw new Error('HTTP 401');
              },
            );
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          if (res.status === 204) return null;
          return res.json();
        });
      }

      /**
       * Make `id` the active chat. Persisted ONLY for real chats: a
       * placeholder that survived a reload would be a chat the server has
       * never heard of, pinned forever (R6a).
       */
      function persistActive(id) {
        sessionId = id;
        if (id) storageSet(ACTIVE_KEY, id);
      }

      /**
       * R6b: the ONE first-chat mechanism. An empty list and "+ New chat"
       * both land here. It takes no id: a placeholder is always a NEW chat,
       * never an adopted one.
       *
       * No row is written. R6: nothing is persisted until a message is sent.
       */
      function startPlaceholder() {
        resetChatState(); // clears placeholderId; we set the new one after
        placeholderId = uuid();
        sessionId = placeholderId; // NOT persistActive — placeholders are ephemeral
        renderSidebar();
      }

      /**
       * "just now" / "5m ago" / "2h ago" / "Yesterday" / "4d ago" / a date.
       * Returns NULL for anything unparsable rather than a NaN string — the
       * caller simply renders no time element (R3-d).
       *
       * Staleness bound, stated: times are computed at RENDER, and the rail
       * re-renders on member interactions (sends, switches, refetches), never
       * on a timer. An idle tab's "2h ago" can age without updating until the
       * next interaction; that is the accepted cost of having no timer loop.
       */
      function relativeTime(iso) {
        if (!iso) return null;
        var t = Date.parse(iso);
        if (isNaN(t)) return null;
        var s = Math.floor((Date.now() - t) / 1000);
        if (s < 60) return 'just now';
        var m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        var d = Math.floor(h / 24);
        if (d === 1) return 'Yesterday';
        if (d < 7) return d + 'd ago';
        var date = new Date(t);
        return date.getMonth() + 1 + '/' + date.getDate() + '/' + date.getFullYear();
      }

      function chatLabel(chat) {
        return (chat && chat.title) || 'New chat';
      }

      /** One rail row: open, rename, delete. Rename swaps in an input in place. */
      function chatRow(chat) {
        var row = el('div', 'jb-chat-row', { role: 'listitem', 'data-chat-id': chat.id || '' });
        if (chat.id && chat.id === sessionId) {
          row.className += ' jb-chat-active';
        }

        if (renamingId && chat.id === renamingId) {
          var field = el('input', 'jb-chat-rename-input', {
            type: 'text',
            'aria-label': 'Rename chat',
          });
          field.value = chatLabel(chat);
          function commit(save) {
            if (renamingId !== chat.id) return;
            var next = field.value.trim();
            renamingId = null;
            if (save && next && next !== chat.title) submitRename(chat, next);
            else renderSidebar();
          }
          field.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(true);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              commit(false);
            }
          });
          field.addEventListener('blur', function () {
            commit(true);
          });
          row.appendChild(field);
          // Focus after the row is in the DOM, on the next frame — focusing a
          // detached node is a no-op.
          window.setTimeout(function () {
            if (field.parentNode) field.focus();
          }, 0);
          return row;
        }

        // S2.2: the confirm REPLACES the row, exactly as the rename input
        // does. window.confirm is gone - a native dialog inside a GHL SPA
        // embed is fragile, reads as the page breaking rather than as the
        // widget asking, and mobile browsers can suppress it outright, which
        // would have made delete a silently dead control.
        if (confirmingId && chat.id === confirmingId) {
          // The GROUP and the confirming BUTTON must not share a label: a
          // duplicate makes the pair ambiguous to a screen reader, and any
          // selector for the action would match the wrapper first.
          var ask = el('div', 'jb-chat-confirm', {
            role: 'group',
            'aria-label': 'Delete confirmation',
          });
          var askQ = el('span', 'jb-chat-confirm-q');
          askQ.textContent = 'Delete?';
          ask.appendChild(askQ);

          var yes = el('button', 'jb-chat-confirm-yes', {
            type: 'button',
            'aria-label': 'Confirm delete chat',
          });
          yes.textContent = 'Delete';
          yes.addEventListener('click', function () {
            confirmingId = null;
            deleteChat(chat.id);
          });
          ask.appendChild(yes);

          var no = el('button', 'jb-chat-confirm-no', {
            type: 'button',
            'aria-label': 'Cancel delete chat',
          });
          no.textContent = 'Cancel';
          no.addEventListener('click', function () {
            confirmingId = null;
            renderSidebar();
          });
          ask.appendChild(no);

          // Escape backs out, matching the rename input's contract.
          ask.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            confirmingId = null;
            renderSidebar();
          });

          row.appendChild(ask);
          // Focus the confirming action on the next frame - focusing a
          // detached node is a no-op. Reaching it already took one deliberate
          // activation, and Escape is the way out.
          window.setTimeout(function () {
            if (yes.parentNode) yes.focus();
          }, 0);
          return row;
        }

        if (chat.pending) row.className += ' jb-chat-pending';
        var open = el('button', 'jb-chat-open', { type: 'button' });
        var titleSpan = el('span', 'jb-chat-title');
        titleSpan.textContent = chatLabel(chat);
        open.appendChild(titleSpan);
        // S3.1 — relative time from last_message_at, which every server row
        // carries and nothing read until now. Tolerant of absence BY DESIGN
        // (R3-d): locally synthesized rows (the started-race merge, the kept
        // active chat, placeholders) have no timestamp, and "NaN ago" would be
        // worse than nothing. A placeholder never shows one — nothing has
        // happened in it.
        var rel = chat.pending ? null : relativeTime(chat.last_message_at);
        if (rel) {
          var time = el('span', 'jb-chat-time');
          time.textContent = rel;
          open.appendChild(time);
        }
        open.setAttribute('title', chatLabel(chat));
        open.addEventListener('click', function () {
          if (chat.pending) return; // already here
          switchToChat(chat.id);
        });
        row.appendChild(open);

        if (!chat.pending) {
          var rename = el('button', 'jb-chat-act', {
            type: 'button',
            'aria-label': 'Rename chat',
            title: 'Rename',
          });
          rename.textContent = '✎';
          rename.addEventListener('click', function () {
            confirmingId = null; // one open question at a time
            renamingId = chat.id;
            renderSidebar();
          });
          row.appendChild(rename);

          var del = el('button', 'jb-chat-act', {
            type: 'button',
            'aria-label': 'Delete chat',
            title: 'Delete',
          });
          del.textContent = '✕';
          del.addEventListener('click', function () {
            // Step ONE of two. Nothing destructive happens here. This control
            // sits beside the one you tap to SWITCH chats, and on touch both
            // are now permanently visible (S2.1) - so without a second step a
            // single mis-tap would archive a conversation.
            renamingId = null; // one open question at a time
            confirmingId = chat.id;
            renderSidebar();
          });
          row.appendChild(del);
        }
        return row;
      }

      /** One inert placeholder row: nothing to read, nothing to click. */
      function skeletonRow(variant) {
        var row = el('div', 'jb-skel-row', { 'aria-hidden': 'true' });
        row.appendChild(el('span', 'jb-skel jb-skel-' + variant));
        return row;
      }

      /**
       * S1.3 — what the rail says when the list could not be fetched.
       *
       * The old code had no such branch: a 503 or a dead network fell through
       * to the same "No chats yet" an empty account sees, which tells a member
       * their chats are GONE when they are merely unreachable.
       */
      function chatsErrorNotice() {
        var box = el('div', 'jb-side-error', { role: 'status' });
        var line = el('div');
        line.textContent = "Couldn't load your chats.";
        box.appendChild(line);
        var retry = el('button', 'jb-side-retry', { type: 'button' });
        retry.textContent = 'Try again';
        retry.addEventListener('click', function () {
          refreshChatList();
        });
        box.appendChild(retry);
        return box;
      }

      function renderSidebar() {
        sideList.innerHTML = '';
        sideList.setAttribute('aria-busy', chatsState === 'loading' ? 'true' : 'false');
        var rows = chats.slice();
        // R6d: a placeholder sorts to the top until it becomes real; after the
        // first send it takes its place in normal last_message_at order.
        if (placeholderId) rows.unshift({ id: placeholderId, title: null, pending: true });

        // The failure is reported ABOVE whatever rows we do have, not only
        // when the rail is empty: the boot catch leaves the member holding a
        // placeholder, so rows.length is 1 and an empty-only branch would
        // never fire — the failure would be silent in exactly the case that
        // produces it.
        if (chatsState === 'error') sideList.appendChild(chatsErrorNotice());

        for (var i = 0; i < rows.length; i++) sideList.appendChild(chatRow(rows[i]));

        if (chatsState === 'loading') {
          // Skeletons go AFTER any real rows. During a load the member may
          // already hold a placeholder and that row is theirs — it must not be
          // displaced by a guess at what else is coming.
          var variants = ['a', 'b', 'c'];
          for (var s = 0; s < variants.length; s++) {
            sideList.appendChild(skeletonRow(variants[s]));
          }
          return;
        }

        // 'ready' and genuinely empty — the ONLY state this copy is true in.
        //
        // KEEP THIS BRANCH (operator ruling; R-1 reversed). It LOOKS
        // unreachable — R6b mints a placeholder the moment an empty list
        // resolves, and BUG-024 mints the delete fallback synchronously — and
        // an earlier pass concluded exactly that and slated it for deletion.
        // The conclusion was wrong: at the time, deleting your only chat left
        // the rail zero-row for the entire DELETE round trip (BUG-024), and
        // this branch was the only thing that filled the gap. Two agents
        // reproduced that window independently before the deletion shipped.
        //
        // A fallback with a proven history of firing is not dead code. Do not
        // delete this on a reachability argument — that argument has already
        // been wrong once.
        if (chatsState === 'ready' && !rows.length) {
          var empty = el('div', 'jb-side-empty');
          empty.textContent = 'No chats yet.';
          sideList.appendChild(empty);
        }
      }

      /**
       * S1.3 retry — re-fetch the LIST and nothing else.
       *
       * Deliberately NOT bootChats. Boot decides which chat is active, and
       * re-running that decision here would yank a member out of the chat they
       * are already in — its empty-list branch calls startPlaceholder, which
       * resets the pane outright. A retry has to repair the rail without
       * touching the conversation, so this writes `chats` and nothing else.
       *
       * The cost, stated: a member whose boot failed stays in the placeholder
       * the catch gave them rather than being moved to their most recent chat.
       * The rail shows the real list, one click away. Non-destructive beats
       * clever here.
       */
      function refreshChatList() {
        chatsState = 'loading';
        renderSidebar();
        var op = beginOp();
        chatsApi('/chats', { method: 'GET' })
          .then(function (rows) {
            if (stale(op)) return;
            var server = Array.isArray(rows) ? rows : (rows && rows.chats) || [];
            // Never drop the chat the member is actually IN — the same rule
            // bootChats applies on its `started` branch. Without it, a retry
            // that arrives while the list is momentarily empty (deleted from
            // another device) would erase the live chat from the rail while
            // the member sits in it.
            //
            // Only for a REAL chat: a placeholder has no row yet and is
            // rendered from placeholderId by renderSidebar, so adding it to
            // `chats` as well would draw it twice.
            var keepActive = sessionId && sessionId !== placeholderId;
            for (var i = 0; i < server.length; i++) {
              if (server[i].id === sessionId) keepActive = false;
            }
            chats = keepActive ? [{ id: sessionId, title: null }].concat(server) : server;
            chatsState = 'ready';
            renderSidebar();
          })
          .catch(function () {
            if (stale(op)) return;
            chatsState = 'error';
            renderSidebar();
          })
          .then(function () {
            endOp(op);
          });
      }

      function submitRename(chat, title) {
        var previous = chat.title;
        chat.title = title; // optimistic: the rail should not lag the keystroke
        renderSidebar();
        var op = beginOp();
        chatsApi('/chats/' + encodeURIComponent(chat.id), {
          method: 'PATCH',
          body: JSON.stringify({ title: title }),
        })
          .catch(function () {
            chat.title = previous; // server said no — put the old name back
            if (!stale(op)) renderSidebar();
          })
          .then(function () {
            endOp(op);
          });
      }

      /** Take the transcript skeleton down. Idempotent — every path may call it. */
      function clearHistorySkeleton() {
        if (!historySkeleton) return;
        var node = historySkeleton;
        historySkeleton = null;
        if (node.parentNode) node.parentNode.removeChild(node);
      }

      /**
       * The shape of a conversation coming back, not a spinner: alternating
       * sides and varied line counts, so the pane says "your history is
       * loading" rather than "something is happening somewhere".
       */
      function showHistorySkeleton() {
        clearHistorySkeleton();
        var wrap = el('div', 'jb-hist-skel', { 'aria-hidden': 'true' });
        var shapes = [
          { side: '', lines: ['a', 'b'] },
          { side: ' jb-hist-right', lines: ['c'] },
          { side: '', lines: ['a', 'b', 'c'] },
        ];
        for (var i = 0; i < shapes.length; i++) {
          var line = el('div', 'jb-hist-line' + shapes[i].side);
          var block = el('div', 'jb-hist-block');
          for (var n = 0; n < shapes[i].lines.length; n++) {
            block.appendChild(el('span', 'jb-skel jb-skel-' + shapes[i].lines[n]));
          }
          line.appendChild(block);
          wrap.appendChild(line);
        }
        historySkeleton = wrap;
        list.appendChild(wrap);
      }

      /**
       * S1.3 — /history failing used to be silent, on the reasoning that
       * "history is a nicety". For a RETURNING member it is not: their
       * conversation is simply missing, and silence is indistinguishable from
       * an empty chat, so the failure reads as data loss.
       *
       * Suppressed once the member has started — they are having a live
       * conversation, and an error about restoring an old one is noise they
       * cannot act on and did not ask for.
       */
      function showHistoryError() {
        if (started) return;
        var handle = addBubble("Couldn't load this conversation's earlier messages.", 'bot');
        var retry = el('button', 'jb-retry', { type: 'button' });
        retry.textContent = 'Retry';
        retry.addEventListener('click', function () {
          if (handle.row.parentNode) handle.row.parentNode.removeChild(handle.row);
          loadHistory();
        });
        handle.bubble.appendChild(retry);
      }

      /**
       * FINDING-027 — a late snapshot is PREPENDED above the live turns, not
       * discarded. Before this, a member who typed during a slow /history had
       * their old conversation silently thrown away for the session.
       *
       * BUG-031 — the duplication defence is a PREFIX rule, not a suffix
       * trim. The fetch can be ISSUED before the member sends and still be
       * READ by the server after their turn landed, so the snapshot can
       * already contain the very turns this pane is showing — and with a
       * second tab or device appending after them (A6: two tabs are
       * supported), those turns are NOT the snapshot's tail. A suffix matcher
       * is structurally blind to a mid-array match, so the subject changed:
       * prepend only the snapshot PREFIX that precedes the live exchange's
       * FIRST occurrence, and discard the rest. Everything after the live
       * exchange is either the live exchange itself or turns that arrived
       * after it — and turns that arrived after the member's live turn do not
       * belong ABOVE it in a chronological pane. Discarding them is correct,
       * not lossy: they surface on the next natural refetch.
       *
       * A cut point is a snapshot index where the snapshot matches liveTurns
       * (oldest-first) and the match either COVERS ALL live turns or EXTENDS
       * TO THE SNAPSHOT'S END. Both arms are load-bearing:
       *  - full coverage alone would miss the partial-persistence tail (the
       *    member's second exchange still in flight, only the first written —
       *    appendExchange writes user+assistant together, so a snapshot can
       *    end mid-liveTurns but never mid-exchange);
       *  - reaches-the-end alone would let a ONE-turn match anywhere cut the
       *    snapshot, eating genuine history that merely repeats the member's
       *    text ("yes", asked twice a week apart).
       *
       * The LAST qualifying occurrence wins (ruling corrected from first):
       * when the member's live text ALSO appears earlier as genuine history —
       * an identical calculator run a week ago, with identical deterministic
       * output — the first occurrence is that genuine pair, and cutting there
       * leaves an empty prefix that throws every real turn away. The live
       * exchange is the LATEST thing the pane knows it painted, so the last
       * qualifying occurrence is it, and everything before it prepends:
       * genuine duplicates survive, turns that arrived after the member's
       * turn are still discarded.
       *
       * TWO UNQUALIFIABLE SHAPES are inherent in (role, content) data and
       * are ACCEPTED BY RULING (FINDING-034) — do not add a third arm, do not
       * write a test for them:
       *
       *  - WRONG OCCURRENCE CHOSEN: a post-live identical arrival (another
       *    device sends the same text and receives the same deterministic
       *    reply before this fetch resolves) is indistinguishable from the
       *    live copy; the last occurrence is then the arrival, and the true
       *    live copy prepends. Needs a semantic coincidence to occur.
       *
       *  - NO OCCURRENCE QUALIFIES (INSPECTOR): the member sends twice while
       *    /history is out, the server's read catches only the first
       *    exchange, and ANY post-live turn from another tab lands after it.
       *    The partial live run is then mid-array — arm A cannot fire (not
       *    full coverage), arm B cannot fire (does not reach the end) — so
       *    nothing is cut and the member's own first exchange prepends above
       *    itself. Strictly more reachable: it needs no coincidence, only a
       *    second tab being used.
       *
       * WHY NEITHER IS FIXED HEURISTICALLY: a third arm letting a partial run
       * qualify mid-array cannot tell [q1, reply, other...] apart from
       * genuine older history sharing that shape — so it would CUT genuine
       * history in the mirror case, which is D.E2/D.E3, the failure that has
       * already cost two corrections. And the asymmetry is the ruling:
       * duplication is VISIBLE, bounded to the session, and fixed by a
       * reload; deletion is SILENT and indistinguishable from data loss.
       * When the data cannot decide, fail toward showing too much.
       *
       * THE DECIDABLE FIX, deferred, and costed here so nobody under-scopes
       * it: message identity in the transcript retires this whole class —
       * both shapes above, BUG-031's family, and FINDING-032's whitespace
       * fragility — because the heuristic exists only because role+content is
       * all we have. It needs TWO contract changes, not one: /history must
       * return message ids, AND /chat must return the persisted ids of each
       * turn so the widget can label its own live turns. /history alone does
       * not suffice — the pane would have ids for the snapshot and none for
       * itself.
       *
       * FINDING-032 (recorded, not fixed): the comparison is an EXACT string
       * compare. Its correctness rests on two facts that live elsewhere — the
       * widget trims input.value before echoing, and memory.ts stores
       * verbatim — so today's server cannot produce a tail differing only by
       * whitespace. If either end ever normalises (trimming server-side,
       * collapsing whitespace, markdown-stripping), the compare stops
       * matching and duplication returns. No test pins this because the input
       * cannot currently occur.
       */
      function prependHistory(messages) {
        var cutAt = messages.length; // no live turns found: prepend everything
        if (liveTurns.length) {
          for (var i = 0; i < messages.length; i++) {
            var m = 0;
            while (
              m < liveTurns.length &&
              i + m < messages.length &&
              messages[i + m].role === liveTurns[m].role &&
              String(messages[i + m].content) === String(liveTurns[m].content)
            ) {
              m++;
            }
            if (m > 0 && (m === liveTurns.length || i + m === messages.length)) {
              cutAt = i; // LAST qualifying occurrence wins — keep scanning
            }
          }
        }
        var keep = messages.slice(0, cutAt);
        if (!keep.length) return;
        removeWelcome();
        // Built directly rather than through addBubble: addBubble appends and
        // follows the bottom, and a prepend must do neither.
        var frag = document.createDocumentFragment();
        keep.forEach(function (m) {
          var row = el('div', 'jb-row ' + (m.role === 'user' ? 'jb-user' : 'jb-bot'));
          var bubble = el('div', 'jb-bubble');
          if (m.role === 'user') bubble.textContent = m.content;
          else renderMarkdownInto(bubble, m.content);
          row.appendChild(bubble);
          frag.appendChild(row);
        });
        var before = list.scrollHeight;
        list.insertBefore(frag, list.firstChild);
        // Scroll compensation: the member is reading their own exchange, and
        // content growing ABOVE it must not shove it out of view.
        list.scrollTop += list.scrollHeight - before;
      }

      /** Repaint the transcript for whichever chat is active. Never gates the UI. */
      function loadHistory() {
        if (!sessionId) return;
        var op = beginOp();
        // R3-c GATE, captured at ISSUE time: only a fetch that was already out
        // when the member committed content may prepend. A fetch issued AFTER
        // they sent (the pre-send error's Retry, clicked late) reads a table
        // that already holds their turn, and prepending it would need the trim
        // to be perfect rather than a second line of defence.
        var issuedBeforeStarted = !started;
        // Guarded on `started` even though every call site today reaches here
        // with it false (boot returns early when it is true; switchToChat
        // resets it). That keeps S1.2's rule true BY CONSTRUCTION rather than
        // by audit: a future caller cannot slip a skeleton in underneath a
        // message the member has already sent.
        if (!started) showHistorySkeleton();
        // A chat switch inerts the skeleton through the same mechanism it uses
        // for the thinking indicator and the calculator timer.
        op.cleanup = clearHistorySkeleton;
        var init = {
          headers: { accept: 'application/json', authorization: 'Bearer ' + (authToken || '') },
        };
        if (op.controller) init.signal = op.controller.signal;
        safeFetch(apiUrl + '/history?session_id=' + encodeURIComponent(sessionId), init)
          .then(function (res) {
            if (res.status === 401) {
              return res.json().then(
                function (body) {
                  authExpired(body && body.reason);
                  throw new Error('HTTP 401');
                },
                function () {
                  authExpired('expired');
                  throw new Error('HTTP 401');
                },
              );
            }
            // A non-ok response now THROWS rather than resolving to null. It
            // used to share the "nothing to paint" path with an empty
            // transcript, which is how a 503 came to look identical to a chat
            // with no messages in it.
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (data) {
            if (stale(op)) return; // the member switched away mid-flight
            clearHistorySkeleton();
            if (!data || !data.messages || !data.messages.length) return;
            if (started) {
              // FINDING-027: the member got there first — their conversation
              // keeps its place, and the older transcript lands ABOVE it.
              if (issuedBeforeStarted) prependHistory(data.messages);
              return;
            }
            // R3-b: a transcript exists, so the welcome does not (S4.4 pulled
            // forward by ruling — suppression only, the string is untouched).
            removeWelcome();
            data.messages.forEach(function (m, idx) {
              var handle = addBubble(m.content, m.role === 'user' ? 'user' : 'bot');
              handle.row.style.animationDelay = Math.min(idx * 40, 320) + 'ms';
            });
            list.scrollTop = list.scrollHeight;
          })
          .catch(function () {
            if (stale(op)) return;
            clearHistorySkeleton();
            showHistoryError();
          })
          .then(function () {
            endOp(op);
            // Belt and braces. The two branches above each clear it, but a
            // skeleton that outlives its fetch is worse than no skeleton at
            // all — it claims a conversation is still arriving when nothing is
            // coming — so no branch is trusted to be the only one.
            if (!stale(op)) clearHistorySkeleton();
          });
      }

      /**
       * Q4 (ruled) — ONE pointer-aware focus rule for both switch paths.
       * On fine pointers, switching and new-chat both refocus the composer.
       * On coarse pointers NEITHER does — focusing pops a keyboard over half
       * the pane, and a member who tapped an old chat almost certainly came
       * to READ it. Consistency is one RULE, not one behaviour regardless of
       * cost.
       */
      function refocusComposer() {
        var coarse =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(hover: none), (pointer: coarse)').matches;
        if (!coarse) input.focus();
      }

      /** Switch chats: full reset, then repaint from the server (W4). */
      function switchToChat(id) {
        if (!id || id === sessionId) return;
        resetChatState();
        persistActive(id);
        renderSidebar();
        loadHistory();
        refocusComposer();
      }

      /**
       * W2 + R6: "+ New chat" is LOCAL and writes NOTHING. It clears the pane,
       * shows the welcome state, and mints a placeholder; the row appears only
       * when a message is actually sent. Idle clicking therefore cannot
       * accumulate empty chats anywhere but on this screen, and a reload
       * collapses them.
       */
      function startNewChat() {
        startPlaceholder();
        refocusComposer();
      }

      /**
       * The id to post with — SYNCHRONOUS on purpose.
       *
       * Boot always leaves either a real chat or a placeholder active, so this
       * normally just hands back the current id. The row is not created by a
       * round trip of its own: /chat inserts it server-side when the id has no
       * row yet and the request carries the owner header (touchChat's
       * self-heal). One fewer round trip on the only latency path a member
       * feels, and no failure mode where the create succeeds but the message
       * does not.
       */
      function ensureChatId() {
        if (sessionId) return sessionId;
        // Mints the placeholder WITHOUT going through startPlaceholder: this
        // runs mid-send, after the member's message has been echoed and the
        // thinking indicator is up, and resetChatState would wipe both.
        placeholderId = uuid();
        sessionId = placeholderId; // ephemeral until the turn lands (R6a)
        renderSidebar();
        return sessionId;
      }

      /**
       * A placeholder becomes real the moment its first turn lands: the server
       * has now written the row (touchChat), so it may be remembered across a
       * reload and take its place in the rail.
       */
      function materialisePlaceholder() {
        if (!placeholderId || placeholderId !== sessionId) return;
        var id = placeholderId;
        placeholderId = null;
        persistActive(id);
        chats.unshift({ id: id, title: null });
        renderSidebar();
      }

      /**
       * W5: deleting the active chat falls back to the most recent remaining
       * one; deleting the last one leaves a PLACEHOLDER (R6/R6b — the same
       * mechanism an empty list uses), so the rail is never empty and no row
       * is written for a chat nobody has spoken in.
       */
      function deleteChat(id) {
        var wasActive = id === sessionId;
        chats = chats.filter(function (chat) {
          return chat.id !== id;
        });
        // BUG-024: the fallback is minted SYNCHRONOUSLY, before the DELETE is
        // even issued. It used to live in the .then below, which left the rail
        // zero-row — and the member chatless — for the whole round trip; both
        // agents found the window independently. The deferral was ordering,
        // not conditionality: the .then ran this fallback on success AND
        // failure alike, so nothing is lost by running it now. It also
        // removes the stale(op) window outright — there is no deferred
        // callback left to go stale.
        //
        // The switch (or placeholder) runs BEFORE beginOp — deliberate, and
        // KEEP it this way — but be precise about why (FINDING-029): it is
        // NOT currently load-bearing. chatsApi attaches no abort signal (only
        // loadHistory and the two /chat sends wire op.controller.signal into
        // their fetch), so no /chats call can be aborted by a reset and both
        // orderings behave identically today. The moment chatsApi gains
        // signal wiring — a plausible robustness change — the reversed order
        // would let the DELETE be aborted by its OWN chat-switch reset and
        // the archive would be lost. This ordering is insurance for that
        // change, not a mechanism in play now. No test pins it: at the
        // shipped code no assertion can distinguish the orderings, and a
        // test that measures nothing is worse than a comment that says so.
        if (wasActive) {
          if (chats.length) switchToChat(chats[0].id);
          else startPlaceholder();
        } else {
          renderSidebar();
        }
        var op = beginOp();
        chatsApi('/chats/' + encodeURIComponent(id), { method: 'DELETE' })
          .catch(function () {
            /* the row is already gone from the rail; a failed archive re-appears on reload */
          })
          .then(function () {
            endOp(op);
          });
      }

      /**
       * R6c: the boot sequence, with its ordering now EXPLICIT.
       *
       * The chat list resolves FIRST and every first-chat decision is taken
       * after it. That ordering is the fix for BUG-020: adoption and the
       * empty-list case are both client-side now precisely so they can see
       * each other — the server cannot read localStorage, so it could never
       * know a legacy session was about to be adopted, and any server-side
       * auto-create was guaranteed to race it.
       *
       * No /history is issued for a legacy session before that decision.
       */
      function bootChats() {
        var op = beginOp();

        // NOTHING HAPPENS BEFORE THE LIST RESOLVES. No repaint of the
        // remembered chat, no placeholder, no /history — the chat list is the
        // only thing that may decide which chat is active.
        //
        // There WAS an optimistic repaint here: it painted the stored
        // ACTIVE_KEY chat immediately to save a round trip. It is removed
        // because it was the last surviving racer of BUG-020's shape — a
        // first-chat decision taken before the list could contradict it. It
        // could paint (and fetch /history for) a chat deleted on another
        // device, then yank it away when the list arrived. The cost is one
        // serial round trip on a returning member's first paint; the price of
        // keeping it is a rule that holds "except here".
        chatsApi('/chats', { method: 'GET' })
          .then(function (rows) {
            if (stale(op)) return;
            var server = Array.isArray(rows) ? rows : (rows && rows.chats) || [];

            // THE RACE THAT MATTERS: a member can type and send before this
            // list arrives. `started` says they did. Taking over the active
            // chat here would repaint another conversation over the message
            // they just sent, so the list is merged for the rail only and the
            // active chat is left exactly where they put it.
            if (started) {
              var known = false;
              for (var j = 0; j < server.length; j++) {
                if (server[j].id === sessionId) known = true;
              }
              chats = known ? server : [{ id: sessionId, title: null }].concat(server);
              chatsState = 'ready';
              renderSidebar();
              return;
            }

            if (server.length) {
              // This device already has chats, so W1 adoption does not apply
              // AT ALL — the legacy key belongs to a session that has already
              // been dealt with, or to a device that has moved on.
              chats = server;
              chatsState = 'ready';
              var preferred = storageGet(ACTIVE_KEY);
              var chosen = null;
              for (var i = 0; i < chats.length; i++) {
                if (chats[i].id === preferred) chosen = chats[i];
              }
              // Newest activity first, so chats[0] is where a returning member
              // most likely left off.
              // Nothing was painted before this point, so there is no prior
              // state to reconcile against — the list simply decides.
              persistActive((chosen || chats[0]).id);
              renderSidebar();
              loadHistory();
              return;
            }

            // Empty list: start clean. There is no second decision to race
            // any more — the widget never adopts a session id from storage.
            chats = [];
            // Asked, answered, and genuinely empty — the one state in which
            // "No chats yet" is a true statement.
            chatsState = 'ready';
            startPlaceholder();
          })
          .catch(function () {
            if (stale(op)) return;
            // S1.3: the list could not be fetched. That is NOT an empty
            // account, and the rail must not say it is.
            chatsState = 'error';
            // No list: still give the member somewhere to type. Nothing is
            // written, so a dead API cannot create anything either.
            if (!sessionId) startPlaceholder();
            // startPlaceholder renders; if the member already has a chat we
            // still need a repaint to show the failure.
            else renderSidebar();
          })
          .then(function () {
            endOp(op);
          });
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
        markStarted();
        setBusy(true);
        var removePending = addPending();
        var settled = false;
        // Tracked like a message send: a chat switch aborts the request and
        // clears the 90s timer below, and `stale` stops the result painting
        // into the wrong chat.
        var op = beginOp();
        op.cleanup = function () {
          settled = true; // a reset is not a settle-with-message; just stop the timers
          if (timer) clearTimeout(timer);
          removePending();
        };

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
        var controller = op.controller;
        var timer = window.setTimeout(function () {
          if (controller) controller.abort();
          settle('That took too long to come back. Try Calculate again.');
        }, 90000);

        var init = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + (authToken || ''),
          },
          body: JSON.stringify({
            // Read at CALL time, never closed over at render time: a form card
            // rendered in chat A can only ever submit into chat A because the
            // reset removes the card, but reading late keeps that true by
            // construction rather than by timing.
            session_id: sessionId,
            member_email: memberEmail,
            form_submission: { calculator: spec.calculator, values: values },
          }),
        };
        if (controller) init.signal = controller.signal;

        safeFetch(apiUrl + '/chat', init)
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
            if (stale(op)) return; // the member switched chats mid-calculation
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
            if (result.data.user_message) {
              addBubble(result.data.user_message, 'user');
              liveTurns.push({ role: 'user', content: String(result.data.user_message) });
            }
            // The result card transitions in with the existing entry animation
            // and the lead-figure count-up, straight out of the skeleton.
            addBubble(result.data.output || "I didn't catch that — try again.", 'bot', {
              animate: true,
            });
            liveTurns.push({ role: 'assistant', content: String(result.data.output || '') });
            materialisePlaceholder();
            bumpActiveChat();
            scheduleTitleRefetch();
          })
          .catch(function () {
            if (stale(op)) return;
            settle("Couldn't reach the calculator — try Calculate again in a few seconds.");
          })
          .then(function () {
            endOp(op);
          });
      }

      function submitMessage(override, skipEcho) {
        var text = typeof override === 'string' ? override : input.value.trim();
        if (!text || busy) return;
        if (typeof override !== 'string') {
          input.value = '';
          form.classList.remove('jb-armed');
        }
        markStarted();
        if (!skipEcho) {
          addBubble(text, 'user');
          // FINDING-027: recorded once per ECHO, so a retry (skipEcho) does
          // not double it — the bubble it describes is still on screen.
          liveTurns.push({ role: 'user', content: text });
        }
        setBusy(true);
        var removeTyping = addTyping();
        // Tracked so a chat switch can abort the request AND stop the thinking
        // indicator's interval; `stale` then stops every callback below from
        // painting into a chat the member has left.
        var op = beginOp();
        op.cleanup = removeTyping;

        // The chat id for a "New chat" (W2) is minted here, on first send —
        // never on the click itself, so idle clicking cannot spawn rows.
        var chatId = ensureChatId();
        var init = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + (authToken || ''),
          },
          body: JSON.stringify({
            message: text,
            session_id: chatId,
            member_email: memberEmail,
          }),
        };
        if (op.controller) init.signal = op.controller.signal;

        safeFetch(apiUrl + '/chat', init)
          .then(function (res) {
            if (res.status === 401) {
              // Mid-session expiry (S4): tear down the thinking state, keep
              // the member's unsent text for after re-auth, and open the gate.
              // The conversation itself is preserved SERVER-side — re-auth
              // reruns boot, ACTIVE_KEY lands back in this chat, and /history
              // repaints it.
              removeTyping();
              pendingResendText = text;
              return res.json().then(
                function (body) {
                  authExpired(body && body.reason);
                  return null;
                },
                function () {
                  authExpired('expired');
                  return null;
                },
              );
            }
            // BUG-016 ruling: an archived chat answers 404 and never enters the
            // agent loop. That send must fail QUIETLY — the chat is gone, so an
            // error bubble in a pane that is about to be replaced is noise.
            if (res.status === 404) return { gone: true };
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (data) {
            if (stale(op) || !data) return;
            if (data.gone) {
              removeTyping();
              chatGone();
              return;
            }
            removeTyping();
            addBubble(data.output || "I didn't catch that — try again.", 'bot', { animate: true });
            liveTurns.push({ role: 'assistant', content: String(data.output || '') });
            // The model decides a form is warranted; the response carries the
            // descriptor. Rendered after the reply so the copy reads first.
            if (data.render_form) renderCalculatorForm(data.render_form);
            materialisePlaceholder();
            bumpActiveChat();
            scheduleTitleRefetch();
          })
          .catch(function () {
            if (stale(op)) return;
            removeTyping();
            showError(text);
          })
          .then(function () {
            endOp(op);
            if (stale(op)) return; // the reset already restored the input
            setBusy(false);
            input.focus();
          });
      }

      /**
       * Move the active chat to the top of the rail after a completed turn,
       * mirroring the server's last_message_at bump so the order the member
       * sees does not wait for the next reload.
       */
      /**
       * The active chat no longer exists (deleted from another tab or device).
       * Drop it and land the member somewhere real, without an error bubble.
       */
      function chatGone() {
        var goneId = sessionId;
        chats = chats.filter(function (chat) {
          return chat.id !== goneId;
        });
        if (chats.length) switchToChat(chats[0].id);
        else startPlaceholder();
      }

      function bumpActiveChat() {
        for (var i = 0; i < chats.length; i++) {
          if (chats[i].id !== sessionId) continue;
          var chat = chats.splice(i, 1)[0];
          // R3-d: mirror the server's last_message_at bump locally, for the
          // same reason the row moves to the top without waiting for a
          // reload — a chat answered seconds ago reading "2h ago" while
          // sitting first in the rail looks broken.
          chat.last_message_at = new Date().toISOString();
          chats.unshift(chat);
          renderSidebar();
          return;
        }
      }

      /**
       * S3.3 — REFETCH-ONCE, the decided alternative to carrying the title in
       * the /chat response. Generation is detached AFTER the reply is sent
       * (touchChat().then(generateChatTitle), first exchange only, guarded by
       * the in-memory pre-turn history), so a response-carried title would
       * mean awaiting an OpenAI round trip on the member's answer path — the
       * exact thing Phase 1 forbids — and the /chat contract is pinned anyway.
       *
       * NOT POLLING, by construction: armed only from a completed turn whose
       * active chat is still untitled, single-flight, and if generation is
       * slower than the delay the next completed turn arms one more. Bounded
       * by member actions; an idle widget never fetches.
       *
       * The refetch is SILENT registry repair: chatsState is not flipped to
       * 'loading', so a populated rail never flashes back to skeletons. On
       * success it also settles an 'error' rail — fresher evidence than the
       * failure.
       *
       * NO beginOp — and the ABSENCE is load-bearing, not an oversight
       * (INSPECTOR-verified): a chat switch must not abort this fetch,
       * because the title belongs to the RAIL, not to the chat being left.
       * Registering it would put it under resetChatState's abort sweep and
       * the title of the chat just left would be lost on every switch.
       *
       * TEARDOWN SAFETY is two separate facts — do not credit one with the
       * other's job (FINDING-035, same class as FINDING-029):
       *  - the `typeof document` guards below exist for JSDOM TEARDOWN only.
       *    In a real browser `document` is never undefined; that branch is
       *    unreachable in production.
       *  - production safety after a GHL lesson swap rests on renderSidebar()
       *    TOLERATING DETACHED NODES: the timer fires against a discarded
       *    subtree, renderSidebar writes into it, and nothing throws
       *    (INSPECTOR attacked this directly). That tolerance is load-bearing
       *    and currently implicit — a renderSidebar refactor that starts
       *    requiring a connected DOM (measuring, querying upward, observing)
       *    removes the REAL protection while both guards here stay green.
       */
      function scheduleTitleRefetch() {
        if (titleRefetchTimer) return; // single-flight
        var active = null;
        for (var i = 0; i < chats.length; i++) {
          if (chats[i].id === sessionId) active = chats[i];
        }
        if (!active || active.title) return; // titled already — nothing to fetch
        titleRefetchTimer = window.setTimeout(function () {
          titleRefetchTimer = null;
          if (typeof document === 'undefined') return; // jsdom teardown ONLY — unreachable in a browser (FINDING-035)
          chatsApi('/chats', { method: 'GET' })
            .then(function (rows) {
              if (typeof document === 'undefined') return; // jsdom teardown ONLY (FINDING-035)
              var server = Array.isArray(rows) ? rows : (rows && rows.chats) || [];
              // Same active-chat preservation refreshChatList applies: the
              // list must never drop the chat the member is sitting in.
              var keepActive = sessionId && sessionId !== placeholderId;
              for (var j = 0; j < server.length; j++) {
                if (server[j].id === sessionId) keepActive = false;
              }
              chats = keepActive ? [{ id: sessionId, title: null }].concat(server) : server;
              chatsState = 'ready';
              renderSidebar();
            })
            .catch(function () {
              /* cosmetic — the next completed turn arms one more attempt */
            });
        }, 4000);
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

      newChatBtn.addEventListener('click', function () {
        startNewChat();
      });

      /**
       * Phase 3 S4 — the member gate.
       *
       * `pendingResendText` carries a message that was in flight when the
       * session expired: after re-auth it is refilled into the composer, so
       * the member loses nothing but the round trip.
       */
      var pendingResendText = '';

      function startAuthedSession() {
        root.classList.remove('jb-gated');
        // The opening message and the rail are painted SYNCHRONOUSLY, before
        // any network call. Nothing below can gate the input box: bootChats
        // resolves the chat list and repaints history afterwards, and every
        // one of its failure paths ends in a usable placeholder.
        resetChatState();
        chats = [];
        chatsState = 'loading';
        renderSidebar();
        if (pendingResendText) {
          input.value = pendingResendText;
          pendingResendText = '';
          form.classList.add('jb-armed');
        }
        // Belt and braces: the chat box is already usable at this point, and
        // nothing about resolving the chat list is allowed to change that.
        try {
          bootChats();
        } catch (e) {
          startPlaceholder();
        }
        refocusComposer();
      }

      /**
       * The gate replaces the conversation area OUTRIGHT (ruled): in an
       * ungated session it is the first thing the member sees — never a modal
       * over a rendered chat, which invites the chat to be visible behind it.
       * No /chats, no /history, no welcome until the token exists.
       */
      function showGate(mode) {
        root.classList.add('jb-gated');
        list.innerHTML = '';
        historySkeleton = null;
        welcomeRow = null;

        var card = el('div', 'jb-gate jb-glass');
        var title = el('h2', 'jb-gate-title');
        title.textContent = mode === 'expired' ? 'Your session ended' : 'Members only';
        card.appendChild(title);
        var copy = el('p', 'jb-gate-copy');
        copy.textContent =
          mode === 'expired'
            ? 'Enter the email on your ProjectRE account to pick up where you left off.'
            : 'Enter the email on your ProjectRE account to start chatting with James.';
        card.appendChild(copy);

        var row = el('div', 'jb-gate-row');
        var emailInput = el('input', 'jb-gate-input', {
          type: 'email',
          placeholder: 'you@example.com',
          'aria-label': 'Your member email',
          autocomplete: 'email',
        });
        if (lastAuthEmail) emailInput.value = lastAuthEmail;
        var submitBtn = el('button', 'jb-gate-btn', { type: 'button' });
        submitBtn.textContent = 'Continue';
        row.appendChild(emailInput);
        row.appendChild(submitBtn);
        card.appendChild(row);

        var status = el('div', 'jb-gate-status', { role: 'status', 'aria-live': 'polite' });
        card.appendChild(status);
        list.appendChild(card);

        /**
         * THE THREE FAILURE STATES, distinct and actionable (ruled):
         *  not_found      — the email is not a member here (fix the email)
         *  denied         — retired or blank field (a account/GHL question)
         *  lookup_failed  — could not check right now (RETRY — the only state
         *                   where trying again without changing anything can
         *                   succeed, so the only one with a retry control)
         */
        function showStatus(kind) {
          status.setAttribute('data-kind', kind);
          status.innerHTML = '';
          var line = el('div');
          if (kind === 'not_found') {
            line.textContent = "We couldn't find that email in the member system. Check it matches the email on your ProjectRE account.";
          } else if (kind === 'denied') {
            line.textContent = 'This email does not currently have course access. If that seems wrong, contact support.';
          } else if (kind === 'invalid_email') {
            line.textContent = 'That does not look like an email address.';
          } else {
            line.textContent = "We couldn't check your access just now — this is on our side, not yours.";
          }
          status.appendChild(line);
          if (kind === 'lookup_failed') {
            var retry = el('button', 'jb-gate-retry', { type: 'button' });
            retry.textContent = 'Try again';
            retry.addEventListener('click', submit);
            status.appendChild(retry);
          }
        }

        var submitting = false;
        function submit() {
          if (submitting) return;
          var email = emailInput.value.trim();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showStatus('invalid_email');
            return;
          }
          submitting = true;
          submitBtn.disabled = true;
          status.innerHTML = '';
          safeFetch(apiUrl + '/auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: email }),
          })
            .then(function (res) {
              return res.json().then(
                function (body) {
                  return { status: res.status, body: body };
                },
                function () {
                  return { status: res.status, body: {} };
                },
              );
            })
            .then(function (result) {
              submitting = false;
              submitBtn.disabled = false;
              if (result.status === 200 && result.body && result.body.token) {
                lastAuthEmail = email;
                authToken = result.body.token;
                sessionSet(TOKEN_KEY, authToken);
                startAuthedSession();
                return;
              }
              lastAuthEmail = email;
              var reason = (result.body && result.body.reason) || 'lookup_failed';
              showStatus(reason === 'invalid_email' ? 'invalid_email' : reason);
            })
            .catch(function () {
              submitting = false;
              submitBtn.disabled = false;
              showStatus('lookup_failed');
            });
        }

        submitBtn.addEventListener('click', submit);
        emailInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        });
        window.setTimeout(function () {
          if (emailInput.parentNode) emailInput.focus();
        }, 0);
      }

      /**
       * Mid-session expiry (S4, ruled): the server said 401. Clear the token
       * (its ONE clearing site), stop the in-flight work, and gate again in
       * 'expired' mode. The conversation is PRESERVED BY ARCHITECTURE rather
       * than by widget state: the transcript lives server-side, ACTIVE_KEY
       * survives in localStorage, and re-auth reruns boot — which lands in
       * the same chat and repaints its history. The member returns to their
       * conversation, not a fresh one.
       */
      var reAuthing = false; // several calls can 401 together; gate once
      function authExpired(reason) {
        if (reAuthing) return;
        reAuthing = true;
        authToken = null;
        sessionRemove(TOKEN_KEY);
        resetChatState();
        showGate(reason === 'expired' ? 'expired' : 'initial');
        window.setTimeout(function () {
          reAuthing = false;
        }, 0);
      }

      clearRetiredKeys();
      authToken = sessionGet(TOKEN_KEY);
      if (authToken) {
        startAuthedSession();
      } else {
        showGate('initial');
      }
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
      // jsdom test teardown destroys `document` while this observer is still
      // connected, and every late firing then throws a ReferenceError — noise
      // that can bury a real failure in the run output. In a browser the
      // document outlives the page, so the guard is a no-op there.
      if (typeof document === 'undefined') {
        observer.disconnect();
        return;
      }
      var target = document.querySelector(targetSelector);
      if (target && target.getAttribute('data-mounted') !== 'true') mount();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.createJamesBot = createJamesBot;
})();
