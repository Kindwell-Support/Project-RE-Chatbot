/**
 * Deterministic calculator-intent routing.
 *
 * WHY THIS EXISTS — the bug it fixes:
 * form rendering used to be the model's judgment call. The only thing that made
 * a form appear was the model choosing to call `request_calculator_form`, at
 * temperature 0.3, decided fresh every turn. So "I want to run a flip" produced
 * a form for one member and a prose "send me your numbers" for the next. Same
 * input, different behaviour — a coin flip, not a hallucination.
 *
 * Prompting harder only moves the probability. The decision had to leave the
 * model's discretion entirely, so it lives here: a pure function over the
 * message text, no model call, no temperature, no history-dependent sampling.
 * Same string in, same route out, every time. runAgent consults this BEFORE the
 * model's first turn and renders the form itself; the model is then told the
 * form is already on screen. It cannot decline.
 *
 * The prompt still says the same thing (see systemPrompt.ts §2) so the
 * model-driven paths agree with this one — but the prompt is the backup, not
 * the mechanism.
 *
 * Design bias: a false positive costs the member one Cancel click; a false
 * negative is the bug being fixed. So the rules lean towards firing — but only
 * on an *action* aimed at a calculator, never on merely mentioning one
 * ("my flip is stalling", "why is the CoC low on this flip").
 */
import type { CalculatorKey } from './formSchema.js';

export type CalculatorIntent =
  /** Render this calculator's form, deterministically. */
  | { kind: 'form'; calculator: CalculatorKey; rule: string }
  /** Calculator intent is real but no calculator was named — ask which. */
  | { kind: 'ask_which_calculator'; rule: string }
  /** Nothing to force; the model handles the turn as it always did. */
  | { kind: 'none'; rule: string };

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * The numbered menu members still type. 1-3 are the calculators; 4-6 are
 * Partnership / Construction / Material Allowance, which have no input form,
 * so they fall through to the model.
 */
const MENU_PICKS: Record<string, CalculatorKey> = {
  '1': 'brrrr',
  '2': 'flip',
  '3': 'land_purchase',
};

/** A whole message that is just a menu number: "2", "2.", " 2) ", '"3"'. */
const MENU_PICK_RE = /^[\s"'(]*([1-6])[\s"').:,-]*$/;

/**
 * Calculator name alternations, as regex SOURCE strings — they get composed
 * into the action/co-occurrence patterns below, so the names are written once.
 */
const NAME_SOURCES: Array<{ calculator: CalculatorKey; source: string }> = [
  { calculator: 'brrrr', source: "b\\s*r{3,}|buy[\\s,-]*rehab[\\s,-]*rent(?:al)?" },
  { calculator: 'flip', source: "fix\\s*(?:and|&|'?n'?)\\s*flips?|flips?" },
  {
    calculator: 'land_purchase',
    source:
      'land|new[\\s-]constructions?|new[\\s-]builds?|ground[\\s-]up|spec\\s+(?:home|house|build)s?',
  },
];

/**
 * Verbs and first-person openers that turn a calculator mention into a request
 * to run one. Deliberately excludes bare "would/should/is" — those read as
 * conversation about a deal, not a request to open a calculator.
 */
const ACTION_SOURCE = [
  'run',
  'rerun',
  're-run',
  'use',
  'using',
  'do',
  'open',
  'start',
  'launch',
  'pull\\s+up',
  'fire\\s+up',
  'price\\s+out',
  'analyz\\w*',
  'underwrit\\w*',
  'evaluat\\w*',
  'calculat\\w*',
  'model',
  'crunch',
  "i\\s+want",
  'i\\s+need',
  'i\\s+wanna',
  "i'?d\\s+like",
  "let'?s",
  'lets',
  'can\\s+you',
  'could\\s+you',
  'help\\s+me',
  'show\\s+me',
  'walk\\s+me\\s+through',
].join('|');

/** The word "calculator" anywhere is itself an unambiguous signal. */
const CALCULATOR_WORD_RE = /\bcalc(?:ulator|s)?\b/i;

interface CompiledName {
  calculator: CalculatorKey;
  /** The name appears at all. */
  present: RegExp;
  /** An action verb, then the name within a short window. */
  action: RegExp;
  /** The name, then "calculator" — "flip calculator", "BRRRR calc". */
  named: RegExp;
}

const COMPILED: CompiledName[] = NAME_SOURCES.map(({ calculator, source }) => ({
  calculator,
  present: new RegExp(`\\b(?:${source})\\b`, 'i'),
  // Non-greedy, capped window, and stopped at sentence boundaries so a verb in
  // one sentence can't reach a calculator name in the next.
  action: new RegExp(`\\b(?:${ACTION_SOURCE})\\b[^.?!]{0,40}?\\b(?:${source})\\b`, 'i'),
  named: new RegExp(`\\b(?:${source})\\b[\\s-]*calc(?:ulator)?\\b`, 'i'),
}));

/**
 * Real calculator intent with no calculator named. Needs an action verb AND a
 * deal noun close together, so "same deal but 4 months" (a carry-forward, not a
 * new request) does not match.
 */
const AMBIGUOUS_RE =
  /\b(?:analyz\w*|underwrit\w*|run|rerun|evaluat\w*|review|look\s+at|go\s+over|price\s+out|crunch|model|check)\b[^.?!]{0,30}?\b(?:deals?|numbers|property|project|purchase|acquisition)\b/i;

/**
 * Informational questions about a calculator topic, e.g. "what do you think of
 * my flip?". These get a real answer, not a form — unless they also carry an
 * explicit run/use/calculator signal ("how do I run a flip?").
 */
const QUESTION_OPENER_RE =
  /^[\s"']*(?:what|why|how|when|where|who|which|whose|does|did|do\s+you|is|are|was|were|explain|tell\s+me|any\s+(?:advice|thoughts))\b/i;
const QUESTION_OVERRIDE_RE = /\b(?:calc(?:ulator|s)?|run|rerun|use|using)\b/i;

/**
 * Phrases that mean "the numbers are already in the conversation". Forcing an
 * empty form in front of these would throw away what the member just gave us,
 * so the model handles them from history instead. Only applied when there IS
 * history — see routeCalculatorIntent.
 */
const CARRY_FORWARD_RE =
  /\b(?:same|those|these|that\s+deal|this\s+deal|as\s+before|already|earlier|previously|keep\s+the|carry\s+(?:it|them|that)\s+(?:over|forward)|numbers\s+i\s+(?:gave|sent|typed|already))\b/i;

/** Filler words stripped when testing whether a message is JUST a name. */
const BARE_FILLER_RE =
  /\b(?:the|a|an|my|our|please|thanks|thank\s+you|ok|okay|yes|calculator|calculators|calc|one|option|deal|deals|numbers|sheet|form)\b/gi;

/**
 * Deal figures in the message. When present, the member has already given the
 * numbers, so the natural-language path calculates directly — no form gets
 * shoved in front of someone who typed everything.
 *
 * Deliberately NOT "contains a digit": a bare menu pick ("2") and "4 months"
 * are not deal figures. A dollar sign, a k/m suffix, a value >= 1000, or two or
 * more separate numbers are.
 */
export function hasDealNumbers(message: string): boolean {
  if (/\$\s*\d/.test(message)) return true;
  if (/\d[\d,.]*\s*(?:k|m|mm|million|thousand)\b/i.test(message)) return true;
  const tokens = message.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (tokens.length >= 2) return true;
  return tokens.some((t) => Number(t.replace(/,/g, '')) >= 1000);
}

/** Is the message nothing but a calculator name (plus filler)? */
function isBareName(message: string, present: RegExp): boolean {
  const withoutName = message.replace(new RegExp(present.source, 'gi'), ' ');
  const remainder = withoutName.replace(BARE_FILLER_RE, ' ').replace(/[^a-z0-9]+/gi, '');
  return remainder.length === 0;
}

/**
 * The rule engine. Pure: text in, route out. No model, no clock, no randomness
 * — call it a thousand times with the same string and get the same answer.
 */
export function detectCalculatorIntent(message: string): CalculatorIntent {
  const text = String(message ?? '').trim();
  if (!text) return { kind: 'none', rule: 'empty message' };

  // 1. A bare menu number is an explicit pick — checked before number detection,
  //    since "2" is a digit but obviously not a deal figure.
  const menu = text.match(MENU_PICK_RE);
  if (menu) {
    const picked = MENU_PICKS[menu[1]];
    return picked
      ? { kind: 'form', calculator: picked, rule: `menu pick "${menu[1]}"` }
      : { kind: 'none', rule: `menu pick "${menu[1]}" has no calculator form` };
  }

  // 2. Numbers already supplied -> calculate directly, never front a form.
  if (hasDealNumbers(text)) {
    return { kind: 'none', rule: 'deal numbers present — calculate directly' };
  }

  // 3. Which calculators are named, and is there an action aimed at one?
  const hasCalculatorWord = CALCULATOR_WORD_RE.test(text);
  const questionGuarded = QUESTION_OPENER_RE.test(text) && !QUESTION_OVERRIDE_RE.test(text);

  const triggered: Array<{ calculator: CalculatorKey; rule: string }> = [];
  const mentioned: CalculatorKey[] = [];

  for (const name of COMPILED) {
    if (!name.present.test(text)) continue;
    mentioned.push(name.calculator);
    if (questionGuarded) continue;

    if (isBareName(text, name.present)) {
      triggered.push({ calculator: name.calculator, rule: 'message is the calculator name alone' });
    } else if (name.named.test(text)) {
      triggered.push({ calculator: name.calculator, rule: 'named "<calculator> calculator"' });
    } else if (hasCalculatorWord) {
      triggered.push({ calculator: name.calculator, rule: 'calculator named + the word "calculator"' });
    } else if (name.action.test(text)) {
      triggered.push({ calculator: name.calculator, rule: 'action verb aimed at the calculator' });
    }
  }

  const distinct = [...new Set(triggered.map((t) => t.calculator))];
  if (distinct.length === 1) {
    const hit = triggered.find((t) => t.calculator === distinct[0])!;
    return { kind: 'form', calculator: hit.calculator, rule: hit.rule };
  }
  if (distinct.length > 1) {
    return { kind: 'ask_which_calculator', rule: `${distinct.join(' and ')} both named` };
  }

  // 4. Genuine calculator intent, no calculator named -> ask which. Suppressed
  //    when a calculator WAS mentioned but the question guard held: that turn is
  //    a conversation about a deal, and the model should just answer it.
  if (mentioned.length === 0) {
    if (AMBIGUOUS_RE.test(text)) {
      return { kind: 'ask_which_calculator', rule: 'deal-analysis intent, no calculator named' };
    }
    if (hasCalculatorWord) {
      return { kind: 'ask_which_calculator', rule: '"calculator" with no calculator named' };
    }
  }

  return { kind: 'none', rule: 'no calculator intent' };
}

/**
 * The routing decision runAgent acts on: detectCalculatorIntent, plus two
 * suppressions that need the conversation.
 *
 * Both suppressions can only ever turn a route OFF (down to 'none'), never
 * change which calculator fires — so the guarantee that a clear, self-contained
 * "run a flip" renders the flip form does not depend on history.
 */
export function routeCalculatorIntent(message: string, history: ChatTurn[] = []): CalculatorIntent {
  const intent = detectCalculatorIntent(message);
  if (intent.kind === 'none') return intent;

  const text = String(message ?? '');

  // The member is pointing at numbers already in the conversation ("same deal
  // but 4 months"). An empty form would discard them.
  if (history.length > 0 && CARRY_FORWARD_RE.test(text)) {
    return { kind: 'none', rule: 'refers back to numbers already in the conversation' };
  }

  // "Which calculator?" is the wrong question when the conversation already
  // says which one. Let the model use the history it has.
  if (intent.kind === 'ask_which_calculator') {
    const priorCalculator = history.some((turn) =>
      COMPILED.some((name) => name.present.test(String(turn.content ?? ''))),
    );
    if (priorCalculator) {
      return { kind: 'none', rule: 'history already establishes the calculator' };
    }
  }

  return intent;
}
