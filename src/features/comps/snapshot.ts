/**
 * Calculation-library snapshot of a comps lookup.
 *
 * Client ruling (Clair): comps are saved as a SNAPSHOT — what the member was
 * shown, as of the day it was pulled, never refreshed — and saved BY ADDRESS.
 * So the entry is named by the subject's resolved address (the provider's
 * canonical form, identical across repeat lookups of the same property), and
 * the result keeps the exact rendered block alongside the comps' facts.
 *
 * Pure: no clock, no I/O. `pulledAt` is passed in.
 */
import type { CompsResult } from './types.js';

export interface CompsSnapshot {
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  /**
   * The comps run this snapshot came from. Recorded for traceability only —
   * a cache-served repeat carries the same id and is STILL saved as its own
   * record (client QA ruling: every run appends).
   */
  runId: string;
}

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildCompsSnapshot(
  outcome: CompsResult,
  renderedBlock: string,
  requestedAddress: string,
  pulledAt: Date,
): CompsSnapshot {
  const subject = outcome.subject;
  const medianPpsf = median(outcome.comps.map((c) => c.pricePerSqft));
  return {
    runId: outcome.runId,
    inputs: {
      property_name: subject.address,
      requested_address: requestedAddress,
    },
    result: {
      calculator: 'comps',
      property_name: subject.address,
      pulled_at: pulledAt.toISOString(),
      run_id: outcome.runId,
      // The member-visible block, verbatim — the snapshot itself.
      rendered_block: renderedBlock,
      // List headline + detail facts, read by the library like any outputs.
      outputs: {
        comp_count: outcome.comps.length,
        ...(medianPpsf !== null ? { median_price_per_sqft: Math.round(medianPpsf) } : {}),
      },
      subject: {
        address: subject.address,
        beds: subject.beds,
        baths: subject.baths,
        living_area: subject.livingArea,
        year_built: subject.yearBuilt,
        property_type: subject.propertyType,
      },
      comps: outcome.comps.map((c) => ({
        address: c.comp.address,
        sold_price: c.comp.soldPrice,
        sold_date: c.comp.soldDate,
        beds: c.comp.beds,
        baths: c.comp.baths,
        living_area: c.comp.livingArea,
        price_per_sqft: Math.round(c.pricePerSqft),
        distance_mi: Math.round(c.distanceMi * 100) / 100,
      })),
      radius_mi: outcome.radiusTierMi,
      recency_months: outcome.recencyTierMonths,
    },
  };
}
