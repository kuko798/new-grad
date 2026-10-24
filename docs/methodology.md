# Matching methodology

All of this runs in the browser from the city dataset; there are no language-model calls and no server-side
scoring. Code: `src/lib/scoring.ts`, `src/lib/cost.ts`, `src/lib/travel.ts`, `src/lib/relax.ts`. Tests:
`tests/scoring.test.ts`, `tests/support.test.ts`.

## 1. Hard constraints

| Constraint | When applied | Check |
| --- | --- | --- |
| Rent limit | Whenever entered | Benchmark share of gross rent ≤ rent limit + utilities assumption ÷ people |
| Total housing budget | When entered | Rent share + internet share + insurance + parking (if entered) + fees ≤ budget |
| Commute limit | When destinations exist and it is marked "a limit" | Every destination's estimate ≤ limit |

A neighborhood is a **match** only when every applied check passes. A check that cannot be evaluated (no rent
benchmark for the chosen unit size) makes it **unverified**: listed separately, never as a match. Failing areas
are listed separately with how far over each limit they are.

When nothing matches, `conflicts()` reports, for each limit, how many areas fail that limit alone and the
smallest increase that would admit one. `scenarios()` re-runs the full evaluation with one input changed (rent
+$150/+$300/+$500 and the exact smallest fix, commute +10/+20 min, adding a roommate with one more bedroom,
studios instead) and reports the real change in matches and in the cheapest monthly total.

## 2. Preference components (each 0–1, 1 = best fit in the city)

| Component | Value |
| --- | --- |
| Rent headroom | With a limit: (limit − share) ÷ (0.35 × limit), clamped. Without: 1 − percentile of share among areas. |
| Commute | (max − minutes) ÷ (max − 10), clamped; with two destinations, weighted by the balance slider. |
| Violent / property / vehicle | 1 − city percentile of the rate per 1,000 residents |
| Transit | Mean of (1 − percentile of distance to the nearest rail station) and the percentile of bus stops per km² |
| Grocery, parks, restaurants, nightlife | Percentile of features per km² |
| Quieter surroundings | 1 − mean of the percentiles of nightlife density and residential density |
| Pet-friendly spaces | Mean of the percentiles of dog parks and parks per km² |
| Step-free stations | Step-free stations ÷ stations, only where most stations carry a wheelchair tag |

Priorities map to weights: off 0, low 1, medium 2, high 4.
`fit = 100 × Σ(wᵢ·vᵢ) ÷ Σ(wᵢ)` over components with a value. Points shown per component use largest-remainder
rounding so they add up exactly to the displayed score.

## 3. Missing data

- **Incident measures** with no stable rate (under 2,000 residents) or no data (failed refresh) are scored
  0.5, the city median, and marked *imputed*. Missing is never treated as low.
- **Amenity measures** with no data are left out and the other weights renormalized; the row says so.
- **Coverage** = weight of measured components ÷ weight of all requested components, shown beside the score.
- Zero is a real value: an area with no mapped dog parks scores at the bottom of that measure, not as missing.

## 4. Explanations

Reasons are the up-to-three weighted components with value ≥ 0.6, ordered by weight × value, rendered from
templates with the computed numbers ("More grocery stores per km² than 86% of Chicago areas: 9 supermarkets or
greengrocers mapped (1.2 per km²)"). The tradeoff is the weighted component with the largest weighted shortfall
below 0.45; otherwise the nearest limit, an imputed measure, a visitor-heavy flag, the ZIP-based nature of the
rent benchmark, or the weakest unweighted measure, in that order.

## 5. Responsible presentation of incidents

- Wording is "reported incidents" with a rate, a count, a city-relative position and a trend.
- No "safe" or "dangerous" labels. The one combined figure is the display-only **reported-incident index**
  (`src/lib/incidentIndex.ts`): 10 × the weighted mean of (1 − city percentile) for violent (0.6), property (0.3)
  and vehicle (0.1) rates, renormalized over measures with a stable rate, null when none has one. It is
  city-relative, labelled as reported incidents rather than safety, and not part of preference fit.
- Percentiles are within a city only, and the interface says so wherever they appear.
- No demographic composition is collected, inferred or used. No protected characteristic is collected from
  people or used for matching.

## 6. Costs

Monthly lines are tagged *sourced* (rent benchmark), *assumption* (internet $60 per household, renter's
insurance $15, utilities by unit size: studio $110, 1-bed $130, 2-bed $170, 3-bed $210), *estimate*
(commuting) or *yours*. Parking and fixed car costs are only counted once entered. Commuting uses the cheaper
of per-ride fares and the monthly pass for transit, or km × running cost for driving. Move-in cash (first
month, deposit months, broker and application fees, moving, furniture) is kept separate, with city notes on
deposit and fee rules.

## 7. Commute estimates

Straight-line distance from the neighborhood's block-population-weighted centre, times a route factor, divided
by an assumed speed, plus access and wait time. Transit takes the faster of rail (both ends within 1.5 km of a
station) and bus, or walking under 1.5 km. Speeds and fares per city live in `src/lib/travel.ts` and are
listed on the Data and methods page. Fares were last checked by a person in 2025 and should be reviewed.
