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
import { mapCompItems, mapSubjectItem } from './apifyZillow.js';
import type { PropertyDataProvider } from './types.js';

export class StubPropertyDataProvider implements PropertyDataProvider {
  readonly name = 'stub';

  constructor(
    private readonly rawSubjectItems: Array<Record<string, unknown>>,
    private readonly rawCompItems: Array<Record<string, unknown>>,
  ) {}

  async lookupSubject(rawAddress: string): Promise<SubjectProperty | null> {
    if (this.rawSubjectItems.length === 0) return null;
    return mapSubjectItem(this.rawSubjectItems[0], rawAddress);
  }

  async fetchSoldComps(): Promise<RawComp[]> {
    return mapCompItems(this.rawCompItems);
  }
}
