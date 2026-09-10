/**
 * CONTRACT §6.2 — the v2 sold price, and the "market is too thin" lie.
 *
 * After the payload-compatibility fix shipped, the reported Everett address
 * stopped saying "I couldn't find that address on Zillow" and started saying:
 *
 *   "Not enough recent sales to work with: I found 0 usable sold comp(s)
 *    within 3 mi in the last 12 months ... The market there is too thin for
 *    automated comps."
 *
 * It is a dense suburb. A live provider-level run (2026-09-11, no Supabase
 * touched) showed the source data was never the problem:
 *
 *   A. candidates returned              50
 *   H. survive mapCompItems             44   (6 zpid-less noise cards)
 *   B. status SOLD                      44/44
 *   C. have a sold date                 44/44
 *   E. have coordinates                 44/44
 *   D. have a NUMERIC sold price         0/44   <-- the bug
 *   I. survive the hard filters          0
 *
 *   listingSoldPrice.amount numeric      0/44   (the object is {currency:'USD'})
 *   listingPrice.amount     numeric      0/44
 *   listingPrice.formatted  string      44/44   ("$540,000", "$1.27M")
 *
 * Every comp was rejected PRICE_MISSING. The v2 search payload NEVER carries
 * a numeric price; it carries a formatted string. mapMoney now reads that
 * string, but ONLY when it is a complete digit group — abbreviated values
 * ("$1.27M" is any of 1,265,000-1,274,999) still map to null rather than
 * inventing precision (§14.5).
 *
 * `live-v2-sold-cards.json` is recorded from that run: 3 exact-price sold
 * cards, 1 abbreviated, 1 noise card. Public listing data only, and only the
 * fields the mapper reads.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapCompItems } from '../../src/features/comps/providers/apifyZillow.js';
import { selectTiers } from '../../src/features/comps/filter.js';
import { ALGO_VERSION, MIN_COMPS_TO_COMPUTE, RAW_REFETCH_BELOW_VERSION } from '../../src/features/comps/config.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'features', 'comps', '__fixtures__', name),
      'utf8',
    ),
  ) as Array<Record<string, unknown>>;

const LIVE_CARDS = fixture('live-v2-sold-cards.json');
/** Six real Newport Beach sold cards, in-band on every rule except price. */
const NEWPORT_CARDS = fixture('live-v2-newport-cards.json');

/** The real subject the live run resolved, as the detail actor returned it. */
const SUBJECT: SubjectProperty = {
  zpid: '38589080',
  address: '11418 32nd Drive SE, Everett, WA, 98208',
  beds: 4,
  baths: 3,
  livingArea: 2649,
  lotSize: 8712,
  yearBuilt: 1994,
  propertyType: 'SFR',
  lastSoldPrice: null,
  lastSoldDate: null,
  lat: 47.893753,
  lng: -122.18889,
};

describe('CONTRACT §6.2 — v2 sold price', () => {
  it('prices every live v2 card — exact and abbreviated alike', () => {
    // Before the v2 price work every one of these was null -> PRICE_MISSING.
    // 1,270,000 is the "$1.27M" card, admitted by the 2026-09-11 ruling.
    const comps = mapCompItems(LIVE_CARDS);
    const priced = comps.filter((c) => (c.soldPrice ?? 0) > 0);
    expect(comps.length, 'the zpid-less noise card must still be skipped').toBe(LIVE_CARDS.length - 1);
    expect(priced.map((c) => c.soldPrice).sort((a, b) => (a as number) - (b as number)))
      .toEqual([540_000, 560_000, 610_000, 1_270_000]);
  });

  it('maps every other fact on a real sold card alongside the price', () => {
    const card = mapCompItems(LIVE_CARDS).find((c) => c.zpid === '38449474') as RawComp;
    expect(card).toBeDefined();
    expect(card.soldPrice).toBe(540_000);
    expect(card.status).toBe('SOLD');            // listingStatus "sold"
    expect(card.soldDate).toBe('2026-09-08');     // ISO instant -> calendar date (BUG-006)
    expect(card.lat).toBeCloseTo(47.912624, 5);   // coordinates.latitude
    expect(card.lng).toBeCloseTo(-122.22213, 5);
    expect(card.livingArea).toBe(1536);
    expect(card.propertyType).toBe('SFR');
    expect(card.lotSize).toBe(12_632);            // 0.29 acres -> sqft, rounded
    expect(card.detailUrl).toContain('38449474_zpid');
    expect(card.address).toContain('Everett');
  });

  /** One live-shaped card carrying whatever `formatted` string is under test. */
  const pricedBy = (formatted: string) =>
    mapCompItems([{
      zpid: '1', coordinates: { latitude: 47.9, longitude: -122.2 }, listingStatus: 'sold',
      homeType: 'SINGLE_FAMILY', livingArea: 1500, dateSold: '2026-06-30T07:00:00.000Z',
      listingAddress: { full: '1 A St, Everett, WA' }, isValid: true,
      listingPrice: { currency: 'USD', formatted },
    }])[0]?.soldPrice;

  it("reads Zillow's abbreviated millions form", () => {
    // Admitted by client ruling 2026-09-11 (§6.2). Previously null, which made
    // every seven-figure market unservable — see the Newport case below.
    const abbreviated = mapCompItems(LIVE_CARDS).find((c) => c.zpid === '38606592');
    expect(abbreviated?.soldPrice, 'the $1.27M card is still priceless').toBe(1_270_000);
  });

  it('parses the abbreviated forms Zillow actually emits, exactly', () => {
    expect(pricedBy('$1.2M')).toBe(1_200_000);
    expect(pricedBy('$1.27M')).toBe(1_270_000);
    expect(pricedBy('$3.55M')).toBe(3_550_000);
    expect(pricedBy('$9.13M')).toBe(9_130_000);
    expect(pricedBy('$11.0M')).toBe(11_000_000);
    expect(pricedBy('$26.8M')).toBe(26_800_000);
    // The float hazard this rounds away: 3.55 * 1e6 is 3550000.0000000005 in
    // IEEE-754, and a fractional dollar would reach the renderer.
    for (const s of ['$1.2M', '$3.55M', '$9.13M', '$26.8M']) {
      expect(Number.isInteger(pricedBy(s)), `${s} produced a fractional dollar`).toBe(true);
    }
  });

  it('REJECTS anything outside the two supported shapes — never guesses', () => {
    // §6.2 rule 4: this is NOT a general currency parser. Malformed, ambiguous
    // or unsupported input is refused and the comp is rejected PRICE_MISSING,
    // exactly as an absent price would be.
    for (const bad of [
      '$1.234M',                    // finer than Zillow emits — would invent a digit
      '$1.2K', '$1.2B', '$1.2T',    // unsupported magnitudes
      '$1.2 M', '$1.2MM', '$1.2 million', 'about $1.2M', '~$1.2M',
      '$M', 'M', '$.2M', '$-1.2M', '$0M', '$0', '$1,2M',
      '$1.2M+', 'from $1.2M', '$1.2M-$1.4M', 'Sold', '', '   ',
    ]) {
      expect(pricedBy(bad), `"${bad}" was parsed instead of refused`).toBeNull();
    }
  });

  it('a numeric amount still wins wherever the actor provides one', () => {
    const withAmount = (money: Record<string, unknown>) => ({
      zpid: '1', coordinates: { latitude: 47.9, longitude: -122.2 }, listingStatus: 'sold',
      homeType: 'SINGLE_FAMILY', livingArea: 1500, dateSold: '2026-06-30T07:00:00.000Z',
      listingAddress: { full: '1 A St, Everett, WA' }, isValid: true, listingSoldPrice: money,
    });
    // amount present -> used verbatim, formatted ignored even when they disagree.
    expect(mapCompItems([withAmount({ amount: 640_000, formatted: '$999,999' })])[0].soldPrice).toBe(640_000);
    // amount absent -> exact formatted is the same number written differently.
    expect(mapCompItems([withAmount({ currency: 'USD', formatted: '$640,000' })])[0].soldPrice).toBe(640_000);
    // neither -> null, never zero (zero would read as a $0 sale).
    expect(mapCompItems([withAmount({ currency: 'USD' })])[0].soldPrice).toBeNull();
  });

  it('the v1 payload is untouched — its numeric price still wins', () => {
    const v1 = [{
      hdpData: { homeInfo: {
        zpid: 7520659, streetAddress: '1111 W ENCANTO Blvd', city: 'Phoenix', state: 'AZ',
        homeStatus: 'RECENTLY_SOLD', price: 1_010_000, dateSold: 1785481200000, livingArea: 2971,
        bedrooms: 4, bathrooms: 3, latitude: 33.472256, longitude: -112.087654,
        lotAreaValue: 0.53, lotAreaUnit: 'acres', homeType: 'SINGLE_FAMILY',
      } },
      // A v1 card that ALSO carries a disagreeing v2 price must not blend.
      listingPrice: { formatted: '$1.01M' },
    }];
    const [comp] = mapCompItems(v1);
    expect(comp.soldPrice).toBe(1_010_000);
    expect(comp.status).toBe('SOLD');
    expect(comp.soldDate).toBe('2026-07-31');
  });

  it('END TO END: the live pool survives the UNCHANGED hard filters', () => {
    // The business rules are untouched — same 3mi/12mo ladder, same ±20% sqft
    // band, same beds/baths/type/distance rules, same 3-comp minimum. Only the
    // price now arrives.
    const now = new Date('2026-09-11T12:00:00.000Z');
    const comps = mapCompItems(LIVE_CARDS);
    const tier = selectTiers(SUBJECT, comps, now);

    // NOTHING dies on price any more: every card in this fixture carries a
    // price Zillow displayed, in one form or the other.
    expect(tier.rejected.filter((r) => r.reason === 'PRICE_MISSING')).toEqual([]);
    expect(tier.kept.length, 'the priced comps were still all rejected').toBeGreaterThan(0);
    for (const kept of tier.kept) expect(kept.soldPrice).toBeGreaterThan(0);
  });

  // =========================================================================
  // NEWPORT BEACH — the regression this change exists for.
  //
  // Recorded live at production scale (499 candidates, 457 mapped) for
  // 1040 Westwind Way, Newport Beach, CA 92660. In that market 408 of 457
  // prices are abbreviated, and EVERY candidate that reached the price gate
  // carried one — so the exact-only rule kept 0 and the member was told the
  // market was too thin. These six cards each pass every OTHER rule already:
  // same type, inside the ±20% sqft band, beds/baths within 1, under a mile.
  // The price gate was the only thing standing between them and the member.
  // =========================================================================
  describe('Newport Beach: seven-figure comps survive the price gate', () => {
    const NEWPORT_SUBJECT: SubjectProperty = {
      zpid: '2094418839',
      address: '1040 Westwind Way, Newport Beach, CA, 92660',
      beds: 4, baths: 4, livingArea: 4314, lotSize: 10_000, yearBuilt: 1975,
      propertyType: 'SFR', lastSoldPrice: 6_000_000, lastSoldDate: null,
      lat: 33.622692, lng: -117.89785,
    };

    it('prices all six, none by inventing a digit', () => {
      const comps = mapCompItems(NEWPORT_CARDS);
      expect(comps.length).toBe(NEWPORT_CARDS.length);
      for (const c of comps) {
        expect(c.soldPrice, `${c.zpid} priceless`).toBeGreaterThan(1_000_000);
        // Zillow displays 3 significant figures; the parsed value carries
        // exactly that and no more, so it is a whole number of $10k or better.
        expect((c.soldPrice as number) % 10_000, `${c.zpid} carries invented precision`).toBe(0);
      }
    });

    it('and they reach the member through the unchanged filter ladder', () => {
      const now = new Date('2026-09-11T12:00:00.000Z');
      const tier = selectTiers(NEWPORT_SUBJECT, mapCompItems(NEWPORT_CARDS), now);
      expect(tier.rejected.filter((r) => r.reason === 'PRICE_MISSING')).toEqual([]);
      expect(
        tier.kept.length,
        'Newport-style comps are still being dropped — this is the exact case ' +
          'that produced "the market there is too thin" for a dense market',
      ).toBeGreaterThanOrEqual(MIN_COMPS_TO_COMPUTE);
    });
  });

  it('the cache floor forces a refetch of rows whose stored comps lost their price', () => {
    // The rows written between the actor change and this fix hold comps
    // already mapped with soldPrice: null. `rawComps` is the MAPPED comp, so a
    // recompute cannot recover the price at any version — the floor must sit
    // at or above the version those rows carry, or they serve their cached
    // TOO_FEW_COMPS for the rest of the TTL and the fix looks like it failed.
    expect(RAW_REFETCH_BELOW_VERSION).toBeGreaterThanOrEqual(ALGO_VERSION);
  });
});
