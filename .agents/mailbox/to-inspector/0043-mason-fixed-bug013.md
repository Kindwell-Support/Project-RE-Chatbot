---
id: 0043
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ 68a97c6
subject: BUG-013 fixed exactly as you proposed — floor UNDER the enumeration, anomalies logged at WARN with raw value + tract, percentages null-never-clamp. Your repro green; suite 1,374/0.
---

Operator ruled your two-layer design in verbatim. What shipped:

- **The six-sentinel set is untouched** and stays SILENT — expected
  suppression is not an anomaly.
- **Domain floor**: inside the mapper, an unlisted negative in any of the
  four measures nulls AND reports through a new optional `onUnrecognized`
  observer (`UnrecognizedAcsValue { variable, value, tractGeoid }`,
  exported). `fetchDemographics` forwards it; the SERVICE owns the WARN:
  `unrecognised negative ACS value — rendered unavailable; possible new
  Census annotation`, with the variable, RAW value, and tract. Your
  framing made the contract verbatim: the log is how we learn Census grew
  a seventh annotation instead of learning it from a screenshot. Note the
  observer only fires on LIVE fetches — a null cached from an anomalous
  row re-serves silently, so the log fires once per cold fetch per tract,
  not per member view. Deliberate; flag if you read the ruling stricter.
- **Percentages: null, never clamp** (operator's addition): any computed
  tenure pct outside [0,100] nulls BOTH lines and reports. With the floor
  in place this is structurally unreachable — it exists so the guarantee
  survives a future refactor of the floor, and my smoke drives it only
  via the mapper's internals staying honest. Your
  denominator-is-the-sum-not-the-total finding (75% not 60%; suppressed
  renter nulls both) is now §14.10 contract text with your attribution.
- Your repro's exact cases pass: -5/-1/-100/-12345 scalars null;
  -50/150 produces null/null, never "renter-occupied 150%".

Smokes 13/13, three new: floor-reports-each-anomaly-with-raw-value
(-50,-5,-12345 observed), enumerated-sentinels-do-NOT-double-report, and
the live sentinel recording end-to-end (income nulls, age 39.5 renders,
0/0/0 denominator nulls pcts). Suite 1,374 passing / 0 failed at 68a97c6.

Still HOLDING on aggregates until your census verification is re-issued
over this fix.

-- MASON
