/**
 * The pre-fill label as the MEMBER sees it.
 *
 * `form.test.ts` proves the server payload carries a labelled prefill. That is
 * not the same as the member seeing it: a correct number rendered into the box
 * with the label dropped on the floor is exactly the failure the label exists
 * to prevent — the ARV looks like something they typed.
 *
 * So this asserts the rendered DOM, one surface further out.
 *
 * It also covers a path nothing else does: `prefill.label` contains
 * `subjectAddress`, which traces back to a string the MEMBER typed
 * (member -> normalize -> provider -> session_state -> label -> DOM). If the
 * widget ever rendered it as markup instead of text, that is stored XSS with a
 * member-controlled payload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CALCULATOR_FORMS } from '../../src/agent/formSchema.js';

const WIDGET_SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../widget/widget.js'),
  'utf-8',
);

function loadWidget(): void {
  delete (window as never as Record<string, unknown>).createJamesBot;
  new Function(WIDGET_SRC).call(window);
}

/** The real flip descriptor, with a prefill attached to after_repair_value. */
function flipFormWithPrefill(prefill: Record<string, unknown> | undefined) {
  const base = CALCULATOR_FORMS.flip;
  return {
    ...base,
    required: base.required.map((f) =>
      f.name === 'after_repair_value' ? { ...f, ...(prefill ? { prefill } : {}) } : f,
    ),
  };
}

async function openWithForm(prefill: Record<string, unknown> | undefined) {
  const posts: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
    if (String(url).includes('/history')) return new Promise(() => {});
    posts.push(JSON.parse(init!.body!));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        output: 'Fill in the form below.',
        render_form: flipFormWithPrefill(prefill),
      }),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  loadWidget();
  const div = document.createElement('div');
  div.id = 'james-bot';
  document.body.appendChild(div);
  (window as never as { createJamesBot: (o: unknown) => void }).createJamesBot({
    apiUrl: 'https://api.example.com',
    target: '#james-bot',
  });

  const input = document.querySelector<HTMLInputElement>('#james-bot .jb-input')!;
  input.value = 'I want to run a flip';
  document
    .querySelector<HTMLFormElement>('#james-bot form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 10));
  return { posts };
}

const arvControl = () =>
  document.querySelector<HTMLInputElement>('#james-bot .jb-calc [name="after_repair_value"]');
const card = () => document.querySelector<HTMLElement>('#james-bot .jb-calc');

/**
 * RE-POINTED (§14.8 / §14.15). These fixtures were `arvSource: 'comps'` with a
 * "Pre-filled from your comps on ..." label — a shape that can no longer reach
 * this widget at all: `formPrefill.ts:54` returns the form untouched for any
 * block that is not `'manual'`, so the server never emits a comps prefill.
 * Testing the label surface with it meant BUG-008's guarantee was only ever
 * exercised against a payload production cannot produce.
 *
 * The MANUAL ARV is the shape that still pre-fills, and it still carries the
 * whole label requirement — a number in the box that the member did not type,
 * with nothing saying where it came from, reads as their own input.
 */
const LABEL =
  'Pre-filled from the ARV you set for 123 MAIN STREET, SEATTLE, WA 98101 — edit to override.';
const PREFILL = {
  value: 403000,
  subjectAddress: '123 MAIN STREET, SEATTLE, WA 98101',
  arvSource: 'manual',
  label: LABEL,
};

/**
 * §14.15's second shape: a manual ARV the member gave without naming a
 * property. `subjectAddress` is null, so the label names no address — but it
 * is still a label, and the value still pre-fills.
 */
const UNBOUND_PREFILL = {
  value: 450000,
  subjectAddress: null,
  arvSource: 'manual',
  label: 'Pre-filled from the ARV you set earlier — edit to override.',
};

describe('the pre-fill label as the member sees it', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders the value into the box AND the label beside it', async () => {
    await openWithForm(PREFILL);

    // POSITIVE PRECONDITION: the card and the field exist at all.
    expect(card(), 'no calculator card rendered').not.toBeNull();
    const control = arvControl();
    expect(control, 'the ARV field did not render').not.toBeNull();

    expect(control!.value, 'the pre-filled ARV never reached the input').toBe('403000');

    const note = card()!.textContent ?? '';
    expect(note, 'the pre-fill label is not visible to the member').toContain('Pre-filled');
    expect(note, 'the rendered label does not name the source property').toContain('123 MAIN');
    expect(note.toLowerCase(), 'the member is not told they can change it')
      .toMatch(/edit|override|change/);
  });

  it('an UNBOUND manual ARV pre-fills too, and is still labelled', async () => {
    // §14.15: an ARV the member set without naming a property. The label
    // names no address — there is none — but the requirement is unchanged.
    // Without this case the labelled path is only tested with an address
    // present, and the null-binding shape reaches the member untested.
    await openWithForm(UNBOUND_PREFILL);

    expect(card(), 'no calculator card rendered').not.toBeNull();
    const control = arvControl();
    expect(control, 'the ARV field did not render').not.toBeNull();
    expect(control!.value, 'an unbound manual ARV did not reach the input').toBe('450000');

    const note = card()!.textContent ?? '';
    expect(note, 'an unbound pre-fill arrived with no label at all').toContain('Pre-filled');
    expect(note.toLowerCase(), 'the member is not told they can change it')
      .toMatch(/edit|override|change/);
    // It must not invent a property, and must not render the retired placeholder.
    expect(note, 'the widget invented an address for an unbound ARV').not.toMatch(/\d+ [A-Z][A-Z ]+(STREET|ST|AVE)/);
    expect(note.toLowerCase(), 'the retired placeholder reached the member')
      .not.toContain('manual entry');
  });

  it('a value with NO label does not render a bare number, or the word "undefined"', async () => {
    // A correct number with no label is a FAIL — it reads as something the
    // member typed. And the naive `note.textContent = prefill.label` renders
    // the literal string "undefined" when the label is missing, which is worse.
    await openWithForm({ value: 403000, subjectAddress: '123 MAIN STREET', arvSource: 'manual' });

    expect(card(), 'no card rendered').not.toBeNull();
    const text = card()!.textContent ?? '';
    expect(text, 'the widget rendered the literal word "undefined" at the member')
      .not.toMatch(/undefined/i);

    // MEASURED, not tolerated. This was written as "either it declines to
    // pre-fill, or it supplies its own label" — an `if` around the assertion.
    // The widget DECLINES, every time, so the branch never executed and the
    // assertion inside was dead: the case was green on the "undefined" check
    // alone. A guard written to tolerate the correct path is what killed it.
    //
    // Declining IS BUG-008's fix, so it is asserted directly. If the widget
    // ever starts supplying its own label instead, this fails and the
    // alternative is spelled out in the message rather than hidden in a branch.
    const control = arvControl();
    expect(
      control!.value,
      'an UNLABELLED value was pre-filled into the box — it reads as something ' +
        'the member typed. If the widget now supplies its own label instead, ' +
        'assert that here; do not restore the conditional.',
    ).toBe('');
    expect(text, 'a pre-fill note was rendered for a value that was not pre-filled')
      .not.toContain('Pre-filled');
  });

  it('renders the label as TEXT, never as markup', async () => {
    // `subjectAddress` traces back to a string the member typed. If the label
    // were injected as HTML this is stored XSS with a member-controlled
    // payload, delivered to whoever opens that session.
    const nasty = '<img src=x onerror="window.__pwned=1">123 MAIN ST';
    await openWithForm({
      ...PREFILL,
      subjectAddress: nasty,
      label: `Pre-filled from your comps on ${nasty} — edit to override.`,
    });

    expect(card(), 'no card rendered').not.toBeNull();
    expect(
      document.querySelector('#james-bot .jb-calc img'),
      'the label was rendered as markup — member-controlled HTML reached the DOM',
    ).toBeNull();
    expect((window as never as Record<string, unknown>).__pwned).toBeUndefined();
    // The text is still shown, escaped.
    expect(card()!.textContent ?? '').toContain('123 MAIN ST');
  });

  it('the member can edit the pre-filled value and the edit is what submits', async () => {
    const { posts } = await openWithForm(PREFILL);
    const control = arvControl()!;
    expect(control.value).toBe('403000');

    // The member overtypes it.
    control.value = '375000';
    control.dispatchEvent(new window.Event('input', { bubbles: true }));

    for (const [name, value] of [
      ['purchase_price', '300000'],
      ['rehab_budget', '60000'],
      ['holding_months', '4'],
    ] as const) {
      const el = document.querySelector<HTMLInputElement>(
        `#james-bot .jb-calc [name="${name}"]`,
      )!;
      el.value = value;
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    }

    document.querySelector<HTMLButtonElement>('#james-bot .jb-calc .jb-btn')!.click();
    await new Promise((r) => setTimeout(r, 10));

    const submission = posts.find((p) => p.form_submission) as
      | { form_submission: { values: Record<string, unknown> } }
      | undefined;
    expect(submission, 'the form never submitted').toBeDefined();
    expect(
      Number(submission!.form_submission.values.after_repair_value),
      'the pre-filled value was submitted instead of the member edit',
    ).toBe(375000);
  });

  it('no prefill on the descriptor leaves the field empty', async () => {
    await openWithForm(undefined);
    expect(card(), 'no card rendered').not.toBeNull();
    const control = arvControl();
    expect(control, 'the ARV field did not render').not.toBeNull();
    expect(control!.value, 'the widget invented a value with no prefill').toBe('');
    expect(card()!.textContent ?? '').not.toContain('Pre-filled');
  });
});
