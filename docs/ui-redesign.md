# Your Next Corner UI redesign

Direction: The sentence is the layout, seed 365513178. Geist and the existing blue action color were retained. The supplied Human Destroyer reference informed the oversized type, dark opening, photographic presence, and full-width changes in surface color.

On this page, the name Your Next Corner becomes a large invitation with a real city view inserted into its first line. The live element is city search, backed by the existing manifest and selection flow.

Inventory: new graduates, first job, hard rent limit, workplace or school destination, daily priorities, neighborhood polygons, 40 covered cities, browser-local preferences, three-place comparison, source dates, missing-data transparency, saved shortlist.

Argument and copy: Find your next corner (the product and one action); Start with a city (real coverage and searchable choices); Picture your everyday (rent, commute, priorities, shortlist); Look a little closer (named city photographs); Behind the numbers (sources and limitations); Your next chapter starts somewhere (brand close and saved/compare links).

Content adaptations: the dealt process slider was replaced with a readable run-in sequence because the product already has real onboarding, rather than making visitors operate a second demonstration. The portrait biography and contact footer were adapted to source transparency and neighborhood discovery because this product has neither a person biography nor a public contact address. No random redraws. No invented reviews, metrics, sample neighborhoods, or testimonials.

ROUND 1
Seen in one second: Large invitation to find a place, with Chicago inside the headline.
Idea (one sentence): The next corner becomes a window into a real city.
Live thing: Search covered cities and open the existing neighborhood planner.
Layout words by section: hero=typographic / cities=searchable index / how=split reading column / imagery=asymmetric photographs / methods=statement / footer=large type
Scores: design 7.5 · usability 7 · creativity 7 · content 8 → overall 7.3
Caps applied: unresolved image and tablet overflow limited the initial render to 6.0.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Tablet photo grid overflow in tablet-page-01: use minmax(0, ...) and min-width:0 for intrinsic image columns.
2. Missing Brooklyn photo in desktop-page-01: download the licensed local image and update its precise caption.
3. Legacy decorative homepage rail competes with navigation: removed on the homepage only; planner rail retained.

ROUND 2
Seen in one second: Find your next corner, above a city panorama.
Idea (one sentence): The brand's next corner is a photographic opening into the city you will choose.
Live thing: City search, selection, and expansion using real coverage data.
Layout words by section: hero=typographic / cities=searchable index / how=split reading column / imagery=asymmetric photographs / methods=statement / footer=large type
Scores: design 8 · usability 8 · creativity 7 · content 8 → overall 7.8
Caps applied: creativity capped at 7; the city-window concept could also serve another relocation product.
Top three problems (most visible first), each with the screenshot it shows in and the fix:
1. Photography favors Chicago (desktop-page-02); captions name places accurately, with a Brooklyn view for contrast. Future commissioned neighborhood photography could broaden geographic coverage.
2. On phones the eight-city index is long (mobile-page-01); search precedes it and all 40 cities remain collapsed by default.
3. No video; retained lightweight local photographs and a reduced-motion-aware image entrance, keeping search usable without downloading ambient footage.

Final visual inspection: 0 FAIL at 1440, 768, 390. One warning: no video. All seven final screenshot sheets opened. Source lint: 0 FAIL, 0 WARN. Two-line hero at each size; body 16px, smallest homepage text 13px. The original hero wrapped to three lines and numerous homepage labels were 7–10px.

Photography is local, with linked source and license information at /images/credits.html and machine-readable metadata at /images/credits.json. Four unique photographs: Chicago skyline from downtown by Diego Delso (CC BY-SA 3.0); Chicago Skyline August 2026 by NorbertNagel (CC BY-SA 4.0); Chicago Skyline Sunrise March 15 2026 by NorbertNagel (CC BY-SA 4.0); Union Street Gowanus October 2021 HDR panorama by King of Hearts (CC BY-SA 4.0). Files retain their licenses; the display uses object-fit crops. No generated or bundled stock illustrations, no sample data to replace.

Validation: production build passed; 49/49 unit tests passed; full desktop and phone browser walkthrough passed 50/50 checks, including address lookup, ranking, map, sorting, preferences, saved places, sharing, comparison limits, no-match, network retry, and tile-failure fallback. Local production server returned 200 with image/jpeg for photographs and text/html for the credits page. Hosting rewrite excludes /images/. React 18 image attribute warning found during the first walkthrough was removed before the passing run.

## Planner follow-through — November 5, 2026

The Explore, Compare, Saved and Data screens now share the landing page's charcoal navigation, paper ground, blue actions, Geist typography, square controls and city photography. The app-screen direction was Editorial greeting, seed 594680126, retaining the brand palette and type; no redraws. The name is present in a shared masthead, with a compact five-column bottom navigation on phones.

The mobile shell uses minmax(0, 1fr), constrained content, wrapping result controls, and a comparison table whose horizontal scroll stays inside its own region. Its frozen labels have opaque backgrounds flush with that region. Data now has jump links, readable prose sections and wrapping source tables. Explore's active navigation also recognizes all supported cities instead of only the original four. Existing data, ranking, sources, preferences, saving and comparison behavior remain unchanged.

App critique: the first screen answers which city is being explored, what is saved, what is compared, or how the sources work. Real fit scores retain the blue data accent; none of the figures or baselines changed. Empty states supply a real next action and reuse the licensed Chicago photo by Diego Delso (CC BY-SA 3.0), linked to the existing credits page directly beneath the image. No new imagery or sample records.

Final visual assessment: design 8, usability 8, creativity 7, content 8; weighted 7.8. The remaining tradeoff is the density of neighborhood explanations; these remain available rather than being hidden behind additional controls. Empty screens intentionally leave space after their single next action. Titles are slightly larger than the app skill's usual recommendation to match the requested landing-page style. The inspector flags the map side as unused canvas and the long results list as below-fold blocks; the map is the actual complementary content, with its rendered tiles separately verified in the browser walkthrough.

Validation: production build and 49 unit tests passed; full desktop/phone workflow passed all 50 checks. Empty screens were checked at 390, 768 and 1440 pixels. The added scripts/ui-responsive.mjs checks populated Saved, Compare, Data and Explore at 320, 390, 428, 768 and 1440 pixels, including contained comparison scrolling and opening the preferences drawer. All 20 combinations passed with no page overflow. Final Saved and Explore inspector runs returned zero failures. Screenshots were reviewed at all three inspector widths. Chromium/Edge tested; physical iOS Safari was not available.
