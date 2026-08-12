/**
 * Stub provider — replays recorded raw payloads through the REAL mapping
 * functions, so the mapper itself is exercised on every offline run. This is
 * what the default test suite drives; the network never enters the picture.
 *
 * Data in, data out: the constructor takes raw payload arrays (load the
 * __fixtures__/spike-*.json files or hand-build smaller ones). No fs access
 * here — keeping the module dependency-free means it can be constructed in
 * any test without ceremony.
 */
import type { RawComp, SubjectProperty } from '../types.js';
import { mapCompItems, mapDetailBatchItems, mapSubjectItem } from './apifyZillow.js';
import type { DetailBatchItem, PropertyDataProvider } from './types.js';

export class StubPropertyDataProvider implements PropertyDataProvider {
  readonly name = 'stub';

  /**
   * Present ONLY when detail items were provided (assigned in the
   * constructor): a stub without them is a provider genuinely lacking the
   * capability, and the service must not treat it as detail-capable —
   * consume budget for it, or log its "failure". Optionality mirrors the
   * data, exactly like the real seam.
   */
  fetchDetailBatch?: (addresses: string[], opts?: { timeoutMs?: number }) => Promise<DetailBatchItem[]>;

  /** Same optionality rule for the neighbourhood fetch (§14.16.1). */
  fetchNeighborhoodSales?: (
    subject: SubjectProperty,
    radiusMi: number,
    windowMonths: number,
    opts?: { timeoutMs?: number },
  ) => Promise<RawComp[]>;

  constructor(
    private readonly rawSubjectItems: Array<Record<string, unknown>>,
    private readonly rawCompItems: Array<Record<string, unknown>>,
    rawDetailItems?: Array<Record<string, unknown>>,
    rawNeighborhoodItems?: Array<Record<string, unknown>>,
  ) {
    if (rawDetailItems) {
      this.fetchDetailBatch = async (addresses: string[]) => {
        // Replay ONLY the requested addresses (matching the real actor,
        // which answers what it was asked), but in RECORDED order —
        // deliberately NOT input order, so a positional join fails loudly in
        // tests (§14.14 rule 1).
        const requested = new Set(addresses);
        return mapDetailBatchItems(rawDetailItems).filter((i) => requested.has(i.addressOrUrlFromInput));
      };
    }
    if (rawNeighborhoodItems) {
      this.fetchNeighborhoodSales = async () => mapCompItems(rawNeighborhoodItems);
    }
  }

  async lookupSubject(rawAddress: string): Promise<SubjectProperty | null> {
    if (this.rawSubjectItems.length === 0) return null;
    return mapSubjectItem(this.rawSubjectItems[0], rawAddress);
  }

  async fetchSoldComps(): Promise<RawComp[]> {
    return mapCompItems(this.rawCompItems);
  }
}
