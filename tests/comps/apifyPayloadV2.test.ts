/**
 * CONTRACT §6.2 — the SECOND Apify wire format, and the outage it caused.
 *
 * On 2026-09-01 both Zillow actors published the same change: "the output now
 * has only the mapped fields. Zillow raw fields that the mapping does not use
 * are removed." Every field this pipeline read to identify a property was in
 * the removed set:
 *
 *   detail actor:  streetAddress, address.*, latitude, longitude,
 *                  lotSize/lotAreaValue/lotAreaUnits, resoFacts, hasBadGeocode
 *   search actor:  hdpData.homeInfo.* (the whole container), detailUrl,
 *                  address, price, isBuilding
 *
 * Consequence, reproduced below: `mapSubjectItemWithReason` found no street on
 * ANY item -> `{ miss: 'NO_STREET' }` -> `lookupSubject` returned null ->
 * `runComps` returned ADDRESS_NOT_FOUND / not_found -> every member, on every
 * valid address, in every format, was told "I couldn't find that address on
 * Zillow. Double-check the spelling, and include the city and state". The
 * client reported exactly that on four addresses, including
 * "11418 32nd Dr SE, Everett, WA 98208" and
 * "1040 Westwind Way, Newport Beach, CA 92660". And behind it, every search
 * card was skipped, so a subject that DID resolve produced an empty pool.
 *
 * THE V2 FIXTURES ARE NOT INVENTED. Every recorded fixture in
 * `__fixtures__/spike-*.json` predates the removal by weeks, during the window
 * when the actors emitted BOTH formats — so each one already contains the v2
 * fields, carrying real recorded values. `toV2()` projects an item onto the
 * field list the actors' current output documents, which is precisely the
 * removal they shipped. `the projection is real` below proves the projection
 * actually strips the v1 paths, so these cases cannot rot into no-ops.
 *
 * MUTATION CHECK: reverting any one field path in apifyZillow.ts to v1-only
 * fails a case here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ApifyZillowProvider,
  DETAIL_ACTOR,
  SEARCH_ACTOR,
  SEARCH_RESULTS_LIMIT,
  mapCompItems,
  mapDetailBatchItems,
  mapSubjectItemWithReason,
} from '../../src/features/comps/providers/apifyZillow.js';
import { runComps } from '../../src/features/comps/service.js';
import { StubPropertyDataProvider } from '../../src/features/comps/providers/stub.js';
import { FAILURE_COPY } from '../../src/features/comps/format.js';
import type { SubjectProperty } from '../../src/features/comps/types.js';

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'features',
  'comps',
  '__fixtures__',
);

const load = (name: string): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8')) as Array<Record<string, unknown>>;

/**
 * The current output field lists, transcribed from each actor's published
 * output example (apify.com/maxcopell/zillow-detail-scraper and
 * .../zillow-scraper, read 2026-09-10). Anything absent here is what the
 * 2026-09-01 change removed.
 */
const DETAIL_V2_FIELDS = [
  'addressOrUrlFromInput', 'zpid', 'homeType', 'priceChange', 'lastSoldPrice', 'bedrooms', 'bathrooms',
  'livingArea', 'yearBuilt', 'daysOnZillow', 'pageViewCount', 'favoriteCount', 'description', 'zestimate',
  'rentZestimate', 'propertyTaxRate', 'monthlyHoaFee', 'annualHomeownersInsurance', 'listingProvider',
  'photoCount', 'parcelId', 'isZillowOwned', 'buildingAttributes', 'listingPrice', 'listingAddress',
  'coordinates', 'listingStatus', 'propertyUrl', 'listingType', 'bathroomsDetail', 'lotArea',
  'pricePerSquareFoot', 'taxAssessedValue', 'datePosted', 'onMarketDate', 'priceChangedAt', 'dateSold',
  'taxAnnualAmount', 'parking', 'agent', 'broker', 'mls', 'mainImage', 'staticMapUrl', 'virtualTourUrl',
  'propertyFeatures', 'atAGlanceFacts', 'schoolDistricts', 'hoa', 'listingPriceHistory', 'listingTaxHistory',
  'nearbySchools', 'nearbyProperties', 'listingMortgageRates', 'listingPhotos', 'scrapedAt', 'isValid',
  'invalidReason',
] as const;

const SEARCH_V2_FIELDS = [
  'zpid', 'zestimate', 'has3DModel', 'hasVideo', 'hasImage', 'isZillowOwned', 'listingPrice',
  'listingAddress', 'coordinates', 'listingStatus', 'propertyUrl', 'listingSoldPrice', 'cardType',
  'homeType', 'listingType', 'priceChange', 'priceChangedAt', 'priceReduction', 'bedrooms', 'bathrooms',
  'livingArea', 'livingAreaUnit', 'lotArea', 'daysOnZillow', 'rentZestimate', 'taxAssessedValue',
  'mainImage', 'listingPhotos', 'photoCount', 'broker', 'marketingTagline', 'openHouse', 'sourceSearchUrl',
  'dateSold', 'cardHighlight', 'factsAndFeatures', 'marketingTreatments', 'priceIncludesMonthlyFees',
  'isRentalWithBasePrice', 'availabilityDate', 'scrapedAt', 'isValid',
] as const;

/** Drop every key the 2026-09-01 change removed — the v2 wire format. */
const toV2 = (
  fields: readonly string[],
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> =>
  items.map((item) =>
    Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key))),
  );

const v2Detail = (items: Array<Record<string, unknown>>) => toV2(DETAIL_V2_FIELDS, items);
const v2Search = (items: Array<Record<string, unknown>>) => toV2(SEARCH_V2_FIELDS, items);

describe('CONTRACT §6.2 — the v2 Apify payload maps as well as v1', () => {
  it('the projection is real: every v1 path this mapper read is gone from a v2 item', () => {
    // Without this, a projection that quietly kept `streetAddress` would make
    // every case below pass against the unfixed mapper.
    const [subject] = v2Detail(load('spike-subject-real'));
    for (const key of ['streetAddress', 'address', 'latitude', 'longitude', 'lotSize', 'resoFacts', 'hasBadGeocode', 'homeStatus']) {
      expect(subject, `detail item still carries v1 key "${key}"`).not.toHaveProperty(key);
    }
    const [card] = v2Search(load('spike-comps').filter((i) => i.hdpData));
    for (const key of ['hdpData', 'address', 'detailUrl', 'price', 'isBuilding']) {
      expect(card, `search card still carries v1 key "${key}"`).not.toHaveProperty(key);
    }
    // And the v2 fields the fix reads are actually present to be read.
    expect(subject).toHaveProperty('listingAddress');
    expect(subject).toHaveProperty('coordinates');
    expect(card).toHaveProperty('listingStatus');
  });

  // -------------------------------------------------------------------------
  // THE REPORTED BUG. Before the fix both cases returned { miss: 'NO_STREET' }.
  // -------------------------------------------------------------------------
  describe('subject resolution', () => {
    it('a v2 detail item resolves to the SAME subject as the v1 item it came from', () => {
      const recorded = load('spike-subject-real');
      const asked = '1111 W Encanto Blvd, Phoenix, AZ 85007';
      const v1 = mapSubjectItemWithReason(recorded[0], asked);
      const v2 = mapSubjectItemWithReason(v2Detail(recorded)[0], asked);
      expect('subject' in v1, 'the v1 baseline itself must resolve').toBe(true);
      // Field-for-field, including lat/lng (coordinates.*), the composed
      // address (listingAddress.*) and lotSize (lotArea acres -> sqft).
      expect(v2).toEqual(v1);
    });

    it("resolves the client's reported addresses instead of calling them not-found", () => {
      // Shapes taken from the recorded v2 payload, with the two addresses the
      // client reported. Each asserts the WHOLE resolution: not a miss, right
      // zpid, and coordinates present — without coordinates there is no comps
      // search (NO_COORDS is the other silent null this bug flowed through).
      const cases: Array<[string, string, string, string]> = [
        ['11418 32nd Dr SE, Everett, WA 98208', '11418 32nd Dr SE', 'Everett', 'WA'],
        ['11418 32nd dr se everett, wa 98208', '11418 32nd Dr SE', 'Everett', 'WA'],
        ['1040 westwind way newport beach ca 92660', '1040 Westwind Way', 'Newport Beach', 'CA'],
      ];
      for (const [asked, street, city, state] of cases) {
        const item = {
          zpid: 12345678,
          homeType: 'SINGLE_FAMILY',
          bedrooms: 3,
          bathrooms: 2,
          livingArea: 1800,
          yearBuilt: 1978,
          lastSoldPrice: 615000,
          dateSold: '2026-06-12T00:00:00.000Z',
          listingAddress: { street, unit: null, city, state, zipCode: asked.slice(-5), full: `${street}, ${city}, ${state}` },
          coordinates: { latitude: 47.8641, longitude: -122.2072 },
          lotArea: { value: 7200, unit: 'Square Feet', formatted: '7200 Square Feet' },
          listingStatus: 'other',
          isValid: true,
        };
        const mapped = mapSubjectItemWithReason(item, asked);
        expect(mapped, `"${asked}" did not resolve: ${JSON.stringify(mapped)}`).toHaveProperty('subject');
        const subject = (mapped as { subject: { zpid: string; lat: number; address: string } }).subject;
        expect(subject.zpid).toBe('12345678');
        expect(subject.lat).toBeCloseTo(47.8641, 4);
        expect(subject.address).toContain(street);
        expect(subject.address).toContain(state);
      }
    });

    it('a genuine miss is still a genuine miss', () => {
      // The `{ isValid: false }` shape survived the change; the fix must not
      // have turned an honest not-found into a resolution.
      expect(mapSubjectItemWithReason(v2Detail(load('spike-miss'))[0], 'nowhere at all')).toEqual({
        miss: 'INVALID',
      });
    });

    it('the wrong-property guard still fires on v2, where hasBadGeocode no longer exists', () => {
      // v2 dropped the flag that caught these two recorded cases first. The
      // street-prefix guard is now the only defence — and it holds for both,
      // which is why nothing was invented to replace the flag. Running comps
      // against a property the member did not name is worse than failing.
      const coronado = mapSubjectItemWithReason(
        v2Detail(load('spike-subject'))[0], // asked "123 E Coronado Rd", Zillow returned "319 E Coronado Rd #1234"
        '123 E Coronado Rd, Phoenix, AZ',
      );
      expect(coronado).toEqual({ miss: 'STREET_MISMATCH' });
      const unit = mapSubjectItemWithReason(
        v2Detail(load('spike-subject-wrong-unit'))[0], // asked "#429", Zillow returned "#318"
        '12222 N Paradise Village Pkwy S #429, Phoenix, AZ 85032',
      );
      expect(unit).toEqual({ miss: 'STREET_MISMATCH' });
    });
  });

  // -------------------------------------------------------------------------
  // The comp pool. Before the fix mapCompItems returned [] on v2 input.
  // -------------------------------------------------------------------------
  describe('comp cards', () => {
    const recorded = load('spike-comps');

    it('maps every card the v1 payload mapped, with identical facts', () => {
      const v1 = mapCompItems(recorded);
      const v2 = mapCompItems(v2Search(recorded));
      expect(v1.length, 'the v1 baseline must map something').toBeGreaterThan(30);
      expect(v2.length).toBe(v1.length);

      const byZpid = new Map(v2.map((c) => [c.zpid, c]));
      for (const comp of v1) {
        const mirror = byZpid.get(comp.zpid);
        expect(mirror, `zpid ${comp.zpid} was dropped by the v2 mapper`).toBeDefined();
        // soldPrice is compared separately: the recorded v2 fields carried
        // `amount: null` with the figure only in the abbreviated `formatted`
        // string, which mapMoney refuses by design (see its comment). Every
        // other fact must match exactly — same status, same calendar date,
        // same coordinates, same type, same lot conversion, same link.
        const { soldPrice: _v1Price, ...v1Facts } = comp;
        const { soldPrice: _v2Price, ...v2Facts } = mirror as typeof comp;
        expect(v2Facts, `zpid ${comp.zpid}`).toEqual(v1Facts);
      }
    });

    it('reads the sold price from listingSoldPrice/listingPrice.amount', () => {
      // The card shape the actor's current output example documents.
      const card = (extra: Record<string, unknown>) => ({
        zpid: '15076544',
        listingAddress: { street: null, city: 'Everett', state: 'WA', full: '11412 32nd Dr SE, Everett, WA' },
        coordinates: { latitude: 47.8639, longitude: -122.2069 },
        listingStatus: 'sold',
        homeType: 'SINGLE_FAMILY',
        bedrooms: 3,
        bathrooms: 2,
        livingArea: 1760,
        lotArea: { value: 7405, unit: 'sqft', formatted: '7405 sqft' },
        dateSold: '2026-06-30T07:00:00.000Z',
        propertyUrl: 'https://www.zillow.com/homedetails/15076544_zpid/',
        cardType: 'home',
        isValid: true,
        ...extra,
      });
      expect(mapCompItems([card({ listingSoldPrice: { amount: 640000, currency: 'USD', formatted: '$640,000' } })])[0]
        .soldPrice).toBe(640000);
      // No sold price on the card: the headline price is the sale.
      expect(mapCompItems([card({ listingPrice: { amount: 655000, currency: 'USD', formatted: '$655,000' } })])[0]
        .soldPrice).toBe(655000);
      // Abbreviated only, no amount anywhere -> null, never a rounded guess.
      expect(mapCompItems([card({ listingPrice: { amount: null, formatted: '$1.01M' } })])[0].soldPrice).toBeNull();
    });

    it('maps a v2 sold card to status SOLD, which is what the hard filters require', () => {
      // filter.ts / aggregates.ts / service.ts all test `status === 'SOLD'`
      // exactly, so a v2 card reaching them as anything else is rejected as
      // NOT_SOLD and the pool empties. v2 spells the status "sold" where v1
      // spelled it "RECENTLY_SOLD"; mapStatus needed no change for that, and
      // this pins the fact rather than trusting it.
      const statuses = mapCompItems(v2Search(recorded)).map((c) => c.status);
      expect(new Set(statuses)).toEqual(new Set(['SOLD']));
    });

    it('still skips the building/rental noise cards', () => {
      // v1 skipped them by `isBuilding`; v2 removed that flag but marks the
      // same three cards with a null zpid (recorded). 40 items in, 37 comps.
      expect(mapCompItems(v2Search(recorded))).toHaveLength(recorded.length - 3);
      // And an explicitly invalid card never becomes a comp.
      expect(mapCompItems([{ zpid: '1', isValid: false, coordinates: { latitude: 1, longitude: 1 } }])).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // THE PRODUCTION CLASS ITSELF. Everything above drives the exported mappers
  // and the service; this drives `ApifyZillowProvider` — the object buildApp
  // constructs and the one that actually ran during the outage — with its
  // injectable `fetchImpl` standing in for the network, nothing else faked.
  //
  // Added during review: the only other test that constructs this class is the
  // double-gated live one, so its `lookupSubject` branching (null vs
  // RESOLUTION_MISMATCH) had no offline coverage in either wire format. The
  // stub provider cannot reach that branch — it calls `mapSubjectItem`, which
  // discards the miss kind.
  // -------------------------------------------------------------------------
  describe('ApifyZillowProvider over a v2 payload, network faked at fetch', () => {
    const fakeFetch = (items: unknown[]) => {
      const calls: Array<{ url: string; body: unknown }> = [];
      const impl = (async (url: string, init: { body: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return { ok: true, status: 200, json: async () => items };
      }) as unknown as typeof globalThis.fetch;
      return { impl, calls };
    };

    it('resolves the subject and sends the request shape the actor documents', async () => {
      const { impl, calls } = fakeFetch(v2Detail(load('spike-subject-real')));
      const provider = new ApifyZillowProvider('test-token-not-a-real-key', impl);
      const looked = await provider.lookupSubject('1111 W Encanto Blvd, Phoenix, AZ 85007');

      // Before the fix this was `null` — the production not-found path.
      expect(looked).not.toBeNull();
      expect(looked).toHaveProperty('zpid', '7520659');
      expect((looked as SubjectProperty).lat).toBeCloseTo(33.472256, 5);

      // The request itself is unchanged by this fix and still matches the
      // actor's current input schema: plain addresses, verbatim.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain(DETAIL_ACTOR);
      expect(calls[0].body).toEqual({
        addresses: ['1111 W Encanto Blvd, Phoenix, AZ 85007'],
        propertyStatus: 'RECENTLY_SOLD',
      });
    });

    it('still reports a wrong-property match as a mismatch, not as not-found', async () => {
      // The branch the stub provider cannot reach. Copy depends on it: this
      // member hears "I found the building but…", never "no such address".
      const { impl } = fakeFetch(v2Detail(load('spike-subject'))); // asked 123, Zillow returns 319
      const provider = new ApifyZillowProvider('test-token-not-a-real-key', impl);
      expect(await provider.lookupSubject('123 E Coronado Rd, Phoenix, AZ')).toEqual({
        miss: 'RESOLUTION_MISMATCH',
        guard: 'street_prefix',
      });
    });

    it('still reports a genuine miss as null', async () => {
      const { impl } = fakeFetch(v2Detail(load('spike-miss')));
      const provider = new ApifyZillowProvider('test-token-not-a-real-key', impl);
      expect(await provider.lookupSubject('99999 Nowhere Blvd, Nowhereville, ZZ')).toBeNull();
    });

    it('fetches and maps the comp pool', async () => {
      const { impl, calls } = fakeFetch(v2Search(load('spike-comps')));
      const provider = new ApifyZillowProvider('test-token-not-a-real-key', impl);
      const subject = { lat: 33.472256, lng: -112.087654 } as SubjectProperty;
      const comps = await provider.fetchSoldComps(subject, 3, 12);

      expect(comps).toHaveLength(37); // was 0 against the v2 payload before the fix
      expect(new Set(comps.map((c) => c.status))).toEqual(new Set(['SOLD']));
      // The search request is unchanged: one bounded searchUrl, map markers.
      const body = calls[0].body as { searchUrls: Array<{ url: string }>; resultsLimit: number };
      expect(calls[0].url).toContain(SEARCH_ACTOR);
      expect(body.searchUrls[0].url).toContain('recently_sold');
      expect(body.resultsLimit).toBe(SEARCH_RESULTS_LIMIT);
    });
  });

  // -------------------------------------------------------------------------
  // Detail enrichment (§14.14) — the join key survived, two facts moved.
  // -------------------------------------------------------------------------
  it('the detail batch still joins on addressOrUrlFromInput and still carries parking', () => {
    const recorded = load('spike-detail-batch5');
    const v1 = mapDetailBatchItems(recorded);
    const v2 = mapDetailBatchItems(v2Detail(recorded));
    expect(v1.length).toBeGreaterThan(0);
    expect(v2.map((i) => i.addressOrUrlFromInput)).toEqual(v1.map((i) => i.addressOrUrlFromInput));
    expect(v2.map((i) => i.zpid)).toEqual(v1.map((i) => i.zpid));
    for (const [i, item] of v2.entries()) {
      expect(item.detail?.parkingSpaces).toEqual(v1[i].detail?.parkingSpaces);
      expect(item.detail?.daysOnMarket).toEqual(v1[i].detail?.daysOnMarket);
      expect(item.detail?.yearBuilt).toEqual(v1[i].detail?.yearBuilt);
      // resoFacts is gone; the style moved to propertyFeatures.
      expect(item.detail?.architecturalStyle).toEqual(v1[i].detail?.architecturalStyle);
    }
  });

  // -------------------------------------------------------------------------
  // End to end through the service, over the REAL mappers (stub replays raw
  // payloads). This is the member-visible assertion.
  // -------------------------------------------------------------------------
  it('runComps no longer answers a valid address with "I couldn\'t find that address on Zillow"', async () => {
    const notFound = FAILURE_COPY.ADDRESS_NOT_FOUND({ resolution: 'not_found' });
    const outcome = await runComps('1111 W Encanto Blvd, Phoenix, AZ 85007', {
      provider: new StubPropertyDataProvider(
        v2Detail(load('spike-subject-real')),
        v2Search(load('spike-comps')),
      ),
      now: () => new Date('2026-08-15T12:00:00.000Z'),
    });
    // The subject resolved. Whatever happens further down the pipeline, the
    // member is not told their address does not exist.
    expect(outcome.ok ? '' : outcome.message).not.toBe(notFound);
    expect(outcome.ok ? 'ADDRESS_FOUND' : outcome.code).not.toBe('ADDRESS_NOT_FOUND');
  });
});
