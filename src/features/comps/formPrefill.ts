/**
 * ARV pre-fill for the inline calculator FORM surface (CONTRACT §8.1).
 *
 * The form is a second entry point into the same calculators, so it must
 * carry the same guarantees as the chat surface — a guard that exists on one
 * path and not the other is worse than no guard, because the tests look
 * green. The rules here mirror §8's chat rules exactly:
 *
 *  - no comps block          -> no default, EVER (no fabrication)
 *  - address mismatch        -> blank, never a silent carry
 *  - pre-fill present        -> visibly labelled with the bound address;
 *                               no label means no pre-fill, by construction
 *                               (label and value live in the same object)
 *
 * Pure function over (form, block, message) — INSPECTOR drives it directly.
 * It returns a CLONE when it attaches anything: the static CALCULATOR_FORMS
 * are shared module state and must never accumulate per-session data.
 */
import type { CalculatorForm, FormField } from '../../agent/formSchema.js';
import { normalizeAddress } from './normalize.js';
import { findConflictingAddress, type CompsStateBlock } from './tools.js';

/** The one field a session may pre-fill. */
const ARV_FIELD = 'after_repair_value';

/** Calculators that consume an ARV; land never pre-fills. */
const ARV_CALCULATORS: ReadonlyArray<CalculatorForm['calculator']> = ['flip', 'brrrr'];

export function prefillLabel(block: CompsStateBlock): string {
  if (block.arvSource === 'comps') {
    return `Pre-filled from your comps on ${block.subjectAddress} — edit to override.`;
  }
  // BUG-011: null = unbound; the old 'manual entry' literal is coerced to
  // null on read (sessionState.ts), so no placeholder can reach a label.
  return block.subjectAddress
    ? `Pre-filled from the ARV you set for ${block.subjectAddress} — edit to override.`
    : 'Pre-filled from the ARV you set earlier — edit to override.';
}

/**
 * Attach the session ARV to a form descriptor, or return the form untouched.
 * `userMessage` is the member's CURRENT message — the same mismatch
 * discriminator the chat path uses: naming a different property means the
 * stored ARV must not follow them onto it.
 */
export function applyFormArvPrefill(
  form: CalculatorForm,
  block: CompsStateBlock | null,
  userMessage: string,
): CalculatorForm {
  if (!ARV_CALCULATORS.includes(form.calculator)) return form;
  // MANUAL ARVs ONLY (CONTRACT §14.8): the computed comps ARV is removed, so
  // a leftover 'comps' block from a cached session must never pre-fill.
  if (block && block.arvSource !== 'manual') return form;
  if (!block || !(block.arv > 0)) return form;
  // BUG-011: only a BOUND ARV can mismatch. A null binding pre-fills
  // regardless of what the message names — nothing claims it belongs to any
  // property, and the label says "you set earlier", not an address.
  if (
    block.subjectAddress !== null &&
    findConflictingAddress(userMessage, block.subjectAddress, normalizeAddress)
  ) {
    return form;
  }

  const decorate = (field: FormField): FormField =>
    field.name === ARV_FIELD
      ? {
          ...field,
          prefill: {
            value: block.arv,
            subjectAddress: block.subjectAddress,
            arvSource: block.arvSource,
            confidence: block.arvConfidence,
            label: prefillLabel(block),
          },
        }
      : field;

  return {
    ...form,
    required: form.required.map(decorate),
    optional: form.optional.map(decorate),
  };
}
