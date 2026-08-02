# [PRD] Sprig — Digital Twin & Simulation Layer for the Backyard Garden

> Canonical, spec-aware PRD for Harness OS. **Part A** is the product framing (condensed
> from the original `PRD_Template.md`, which remains as the verbose reference). **Part B**
> is the SDD-ready layer — it compiles directly into a machine-readable spec via
> `create_spec`, and its acceptance criteria seed the RED test gate. A traditional PRD
> describes *what features exist*; an SDD-ready PRD also pins *what the system must NOT
> do* and *which state transitions are valid*, so a probabilistic agent can't drift.
>
> **Source of truth for domain facts:** `docs/Exterior Design.pdf` (29 pages of hand-drawn
> plans, sun studies, construction notes, and photos from last year's renovation). Every
> dimension, grid layout, and plant placement referenced below traces back to that
> document. Where a number in this PRD is approximate, the PDF page cited is authoritative
> — re-verify against it before it becomes a hard spec constraint.

## Part A — Product framing

### Problem / opportunity

We (the user and their girlfriend) built two raised garden beds and a small backyard
ecosystem (deck, garage, rain barrels, trellis, solar string lights) last year, and
captured the entire design process — hand-drawn grid plans, per-cell plant assignments,
sun/shadow studies, construction cut lists, and a running garden journal — in a single
paper/PDF notebook. That information is rich but static and trapped in a scanned
document: there's no way to *see* the garden as a system, test "what if" changes (more
water here, less sun there), or track how the real garden's state (what's planted where,
how it's doing) evolves over a season without flipping through 29 pages of photos and
handwriting.

### Why now

The beds are built and already have a full first season of real data behind them (the
grid plan, the journal, the sun study) — this is the best moment to digitize before the
paper notes fade from memory or get harder to reconstruct. It's also a personal
experiment: validate whether a "digital twin + simulation" approach is fun and useful
before investing further (e.g., real sensors, more beds, sharing it with others).

### Target users

- **Primary:** the user and their girlfriend — the two people who designed, built, and
  tend this specific garden. They already know the physical garden intimately; the tool
  needs to match their mental model (the grid, the two beds, the journal), not teach them
  gardening.
- **Secondary:** none yet. This is explicitly a private, single-household project.
- **Explicitly not for (yet):** other households, multi-garden/multi-tenant use, public
  sharing, or commercial growers. Nothing here should assume more than one garden or more
  than two users — but nothing should be designed to actively *prevent* extending to that
  later either.

### Definition of success

Per the user's own framing — and a follow-up decision that **3D viewing is the single
biggest factor for making this compelling**, not an optional nice-to-have — success is
layered as follows. Note that the 3D viewer and the water/light simulation are no longer
sequential tiers; they ship together as one must-have, because the simulation's whole
point is to be *seen* happening in the 3D scene.

1. **Must-have (initial release):**
   a. Every fact captured in `docs/Exterior Design.pdf` about the **2 garden beds** — grid
      geometry, per-cell plant assignment, dimensions, photos — exists as structured
      digital data in this project.
   b. A **3D viewer** renders the 2 beds on a simple ground plane, with an **orbit
      camera**: drag to rotate around the garden, scroll/pinch to zoom, pan to shift
      focus. Plants render as stylized/low-poly shapes per grid cell (a placeholder
      fidelity level, expected to be revisited once there's something real to look at).
   c. **Water and light are live, in the 3D scene.** Watering a cell renders its soil
      visibly darker and wet-looking versus its dry state. Light is driven by a
      **simulated time-of-day** control, not an abstract brightness dial: moving through
      the day repositions natural sunlight/shadow per the captured sun study (p.5–8,
      p.26), and moving into dusk/night switches the scene into a night look and turns
      on the **solar string lights** on the garden-bed trellis (p.17, p.18, p.27) —
      mirroring how they actually work (charge by day, glow by night). Dusk/dawn timing
      is anchored to the garden's **real geographic location** (computed sunrise/sunset
      for that specific spot), not an arbitrary clock number. The 3D view *is* how the
      simulation's effect is observed, not a separate mode bolted on afterward.
   e. **The daily clock also drives baseline watering, not just light.** The real garden
      has an automated irrigation system — a hose connecting the two beds that runs
      every morning at **8:00 AM for 10 minutes**, watering all cells in both beds. In
      REAL view mode, when simulated/real time crosses that daily window, all cells
      visibly wet automatically, with no user action needed — mirroring how sunrise/
      sunset automatically drives the light system. Manual per-cell watering (already
      described above) remains available as a SIMULATION-mode override/experiment on
      top of this real daily baseline, not a replacement for it.
   d. Light/shadow for must-have is **baked from the captured sun study** (p.5–8, p.26) —
      the 4 recorded snapshots are used as reference/interpolated light levels per cell.
      No 3D geometry for the tree/garage/deck is required yet; real, computed shadows
      (which do need that geometry) are the near-term follow-on below.
2. **Near-term follow-on (right after must-have, not deferred indefinitely):**
   a. A **free-fly walkthrough** camera mode (move through the yard first-person, not
      just orbit around it), layered on top of the orbit camera once the base 3D scene
      has enough substance to walk through.
   b. **Computed real-time shadows**: rough blockout geometry for the real shadow-casters
      (the big tree, garage, deck — per `docs/Exterior Design.pdf` p.2) positioned using
      the garden's real location and the yard layout, so the engine casts actual shadows
      from the live sun position instead of relying on the 4 baked snapshots. Naturally
      pairs with (a) since both add real yard geometry beyond the 2 beds.
3. **Stretch / optional success:** the rest of the backyard modeled in 3D (deck, garage,
   fence, Maple tree, playset, fire pit, garden entrance arch, and yard decor —
   bird/squirrel feeder, solar fountain+planter, flower planter boxes), the solar
   string lights on the garden-bed trellis *and* the separately-powered "Smart String
   Light" near the entrance/deck (two distinct lighting systems), the rain barrel(s)
   (count and plumbing tbd — see open questions), simulation expanded to moisture
   (distinct from water applied), CO2, and weather/rain, and a fidelity upgrade for
   plant models beyond stylized/low-poly if the low-poly look doesn't hold up once
   built.

Not vanity metrics: "digitized both beds with zero missing grid cells," "can orbit/zoom
the 3D scene smoothly," and "moving the water/light dial visibly changes the 3D scene
live" are the three outcomes that matter first. A polished 3D renderer that doesn't react
to the simulation, or a simulation with no visual payoff, would each be a miss on their
own.

### UX / design principles

1. **The grid is the source of truth.** Both beds are physically laid out as labeled
   grids (see `docs/Exterior Design.pdf` p.1, p.11–12, p.15) — the digital model must let
   a user pick a plant *per grid cell*, not just "assign plants to a bed" in the abstract.
2. **Real data first, simulation second.** The garden journal (actual planting dates,
   what's really growing where, real watering/weather notes) is ground truth and must
   never be silently overwritten by a hypothetical simulation run.
3. **Faithful over decorative.** The 3D/visual representation should read as *this
   specific garden* (twin beds, trellis, solar lights, rain barrels by the downspout) —
   not a generic garden template. If a choice must be made between visual polish and
   fidelity to the real layout, fidelity wins at this stage.
4. **Time of day *is* the light system, not a slider next to it.** The sun/shadow study
   (p.5–8, p.26) captures how light moves across the yard through the day — advancing
   simulated time repositions natural light/shadow from that captured data, and crossing
   into dusk/night is what triggers the solar string lights to switch on. Dusk/dawn
   timing itself comes from real sunrise/sunset for the garden's actual location (pure
   astronomical calculation or a free/keyless data source — no weather API needed for
   this part). This is explicitly meant to feel like a "mini simulation game" day/night
   cycle, not a brightness percentage. An independent "make it cloudier" dial, and any
   real rain/cloud data, is a weather-phase concept (already deferred), not part of this
   time-of-day system.
5. **Start simple, layer complexity.** Two dials (water, light) before four (+moisture,
   +CO2) before a full weather engine. Each layer should be able to ship and be useful on
   its own.
5a. **The daily clock drives baseline water too, not just light.** The real garden's
   automated irrigation (hose connecting both beds, 8:00 AM daily, 10-minute run,
   waters all cells) is the same *kind* of fact as real sunrise/sunset — a real-world
   schedule the simulated clock should trigger automatically in REAL mode, not something
   the user has to manually replicate. Manual per-cell watering in SIMULATION mode is an
   override/experiment layered on top of this real baseline, not a substitute for it.
6. **Orbit before walk.** The camera model ships in two deliberate steps: an orbit camera
   (always framed on the garden, can't get lost) first, then a free-fly walkthrough once
   the scene has enough built out to make walking through it worthwhile. Don't build
   walkthrough collision/bounds logic before the orbit experience is solid.
7. **Simulation state must never be mistaken for real state.** Because the 3D view now
   renders live simulation feedback, the viewer must make it visually unambiguous whether
   it's showing the real/current garden or a hypothetical simulation run — a "what if I
   watered more" render must never look identical to "this is actually happening."

### Scope TL;DR

**In:** digitizing the two raised garden beds exactly as designed and journaled (grid
layout, per-cell plant data, dimensions, photos) — including the real **automated
irrigation system** (hose connecting both beds, 8:00 AM daily, 10-minute run, all cells);
a **3D viewer with an orbit camera** (drag/zoom/pan) rendering the 2 beds on a simple
ground plane with stylized/low-poly plant geometry per cell; a **watering interaction**
(both the real daily schedule, automatic in REAL mode, and a manual per-cell override in
SIMULATION mode) that visibly darkens/wets a cell's soil; and a **simulated time-of-day
cycle**, anchored to the garden's real location, that drives natural light/shadow (baked
from the captured sun study) and switches the garden-bed solar string lights on at real
dusk — all live inside that same 3D view.

**Out (for now, explicitly deferred, not rejected):** free-fly walkthrough camera and
computed real-time shadows (both next in line right after must-have, not "someday"
items, since both need real yard blockout geometry); the rest of the backyard (deck,
garage, fence, playset, fire pit) beyond a simple ground plane and shadow-caster
blockouts; real weather/rain/cloud data and full CO2/moisture simulation (a real weather
API is explicitly out of scope for must-have — only real sunrise/sunset, not weather,
is used); a fidelity upgrade past stylized/low-poly plants; live hardware sensors feeding
real-time data; multi-user or multi-garden support; mobile apps; any monetization or
sharing features. These should be designed so they can be added without reworking the
core bed/grid/plant/3D-scene model — not built now.

### Constraints & assumptions / open questions & risks

**Constraints**
- No tech stack has been chosen yet (deliberately — this PRD is stack-agnostic).
- All domain data originates from one source document (`docs/Exterior Design.pdf`),
  which mixes hand-drawn diagrams, real photos, and handwritten notes (some in a mix of
  English and Vietnamese) — data extraction will be manual/semi-manual transcription,
  not OCR-perfect.
- This is a two-person, single-garden project — no need to over-engineer for scale, but
  the data model (bed → grid → cell → plant) should stay clean enough to extend later.

**Confirmed domain facts** (from a full re-read of all 29 pages of
`docs/Exterior Design.pdf`; compass cross-validated against user-supplied dated photos):
- Page-drawn compass — **up = West, down = East, left = South, right = North** —
  confirmed independently across 7 separate pages (p.9, 11, 12, 13, 14, 15, 26), not
  just one. Very high confidence.
- **Bed 1 (columns 1–4) sits south of Bed 2 (columns 5–8)** — the two beds run along a
  south-to-north line.
- Within both beds, **row A (top) = west end, row H (bottom) = east end**. The source
  document itself labels row A "Partial shade" and row H "Full Sun" — a real, structural
  west-to-east light gradient, independent of and layered on top of the hourly sun study
  (p.5–8).
- "NE facing" is written on both p.9 and p.26 describing the garden's overall
  orientation — consistent with row H (east end) being the sunrise/full-sun side.
- The shade tree is specifically a **Maple** (named on the detailed site-plan page; an
  earlier draft of the same sketch just calls it "Big Tree").
- **Real bed dimensions, confirmed on four separate pages: 4ft wide × 8ft long each
  bed, wood-framed** (not concrete block — see correction below). Total twin-bed
  footprint: 2ft path + 4ft bed + 3ft center path + 4ft bed + 2ft path = **15ft** total
  width.
- The trellis spans between the two beds, is roughly **12ft × 10ft** framed in 2x2/2x4
  lumber, and anchors to a **roof structure** ("Trellis to Roof," p.14/15) at the path
  between the beds — not fully freestanding. Covered in hog/cattle-panel mesh (2"×3"
  opening, 16 gauge) and one ~32ft solar string-light set.
- Cross-validated: solar panels on the trellis (visible in user-supplied photos) are
  aimed at sunrise (east), matching row H's "Full Sun" designation; the tree's overhang
  visible in the same photos falls over the row-A/west side, matching "Partial shade."
- **Real absolute distances, confirmed by the user directly (not just estimated from
  photos):**
  - **Left bed (Bed 1, south) to fence ≈ 74in (~6.2ft).** The p.25 "74in" figure is both
    the left bed's own length *and* its clearance to the fence (the two happen to match).
  - **Left bed (Bed 1, south) to the Maple tree ≈ 76in (~6.3ft).** The p.25 "76in" figure
    likewise double-duties as the bed's length and its clearance to the tree.
    (Correcting an earlier guess: this p.25 block calc is **part of the twin veggie bed
    project after all**, not a separate structure as I'd wrongly concluded — it's giving
    real clearance distances, not conflicting dimensions.)
  - **Fence to the Maple tree ≈ 15ft (183in)** — the p.2 "183in/15ft" arch figure I'd
    guessed might mark the trellis position is actually this fence-to-tree distance;
    that earlier guess was wrong.
  - **The Maple tree has a 10ft-diameter ring of decorative stones around its base** —
    the "d=10ft" circular feature on p.2 I couldn't identify before.
  - These distances aren't necessarily collinear/summable (74+76≠183 and that's fine —
    real yards aren't laid out on one straight line), but together they give real,
    usable clearance data for the computed-shadow follow-on phase, better than the
    photo-based estimation originally planned as the fallback. Garage distance is still
    not documented anywhere and still needs the photo-based approach.
  - The unlabeled **"GAR"/"DEN" structures near the Maple tree are the two garden beds
    themselves** — "GARDEN" split across the two bed rectangles on that overview
    sketch, the same way "GARDEN JOURNAL" splits across the two grids on p.14/15.
    Not a separate shed or structure as I'd wondered.
- **Correction:** there is **no dedicated rain barrel plumbing diagram anywhere in the
  29-page document** — the earlier citation to "p.28" was wrong; p.28 is actually a
  trellis/materials reference sheet with no rain barrel content. Only **one** barrel is
  visually identifiable in the wide site photo (p.27); "2 barrels, 50 gal each" is a fact
  from the user directly, not independently corroborated in the document. Plumbing
  topology remains unknown — see open questions.
- **Major addition, caught by the user, not found in the document itself, and now
  further confirmed by user-supplied close-up photos: there is a real automated drip
  irrigation system**, not just manual watering. Physically, it's a **rigid PVC
  manifold**: each bed has its own shut-off valve at the inner corner facing the center
  path, joined by a horizontal PVC pipe at **ground level** connecting the two beds
  together — this is the literal "hose connecting between 2 beds." A black poly drip-line
  grid is laid across each bed's soil surface, and it visibly lines up with the 4×8
  planning grid — **each `GridCell` corresponds to roughly one physical drip-irrigation
  square**, not just a planning abstraction. The system runs every morning at **8:00 AM
  for 10 minutes**, watering all cells in both beds equally (schedule/coverage confirmed
  by the user directly; the physical plumbing detail is from the photos). The water
  source feeding this manifold appears to be a standard garden hose from an outdoor
  spigot (visible entering the system in one wide photo) — consistent with a hose-end
  mechanical/battery timer, which is exactly the kind of hardware that produces a precise
  daily 10-minute schedule. **This is very likely a separate water source from the rain
  barrels**, not one plumbed through the other — worth confirming, not assumed either
  way. This reframes water the same way the compass reframed light: not just "a grid,"
  but a **Garden Grid Irrigation/Watering System** with its own real, physical hardware
  and automatic daily schedule.
  (Retracting a prior guess: the horizontal bars I'd seen on p.13 across rows B/D/F/G and
  first thought might be irrigation lines, then dismissed as a trellis arc, are still
  most likely the trellis arc — the real irrigation grid shown in these photos is a much
  finer soil-level poly-tube grid, not a few thick bars across select rows.)
- Two **separate lighting systems** exist, not one: solar string lights on the veggie-bed
  trellis (charge by day, glow by night), and a distinct **"Smart String Light"** near
  the garden entrance arch/deck (implies app/WiFi or mains power — an electrical outlet
  is marked nearby on the yard layout). Previously conflated into a single system.
- **Companion planting is real and used throughout** — a grid cell can hold more than
  one plant (e.g., "Tomato + Basil" in the same cell; marigold/nasturtium scattered as
  pest-deterrent companions across many cells in both draft versions). The `GridCell`
  schema's single `plant_id` is wrong and needs to support multiple plants per cell.
- Version reconciliation is now precise: **p.11 = "Version #01"** (fully transcribed —
  different plant palette than the final; includes a honeydew melon trained vertically
  down column 8, spelling H-O-N-E-Y-D-E-W one letter per row); **p.12 and p.13 = both
  "Version #02"** (near-duplicate drafts of the same iteration); **p.14 and p.15 = both
  "Version 2.0"** (the final, current-season grid). The transcription/reconciliation work
  is now largely done through this review, not just a flagged future task.
- The yard layout also documents: a deck footprint (~197in × 167.5in, multiple step
  heights), an L-shaped playset (22ft×10ft + a 5ft×7ft sub-area), a fire pit, an
  electrical outlet and two downspouts near the deck, a garden entrance arch, a
  bird/squirrel feeder, a solar fountain+planter combo, and two flower planter boxes —
  none of this was captured in the original PRD pass.

**Assumptions**
- The two raised beds' grid geometry (4 columns × 8 rows each, per the p.1 template and
  confirmed in the p.11/12/14/15 filled-in versions) is stable and won't be physically
  rebuilt mid-project.
- "3D" means: an orbit camera (drag/rotate, zoom, pan) over the two beds on a simple
  ground plane, with stylized/low-poly plant geometry — not a photorealistic deliverable.
  This fidelity level is a starting assumption the user may revise once there's a working
  prototype to actually look at (flagged explicitly as likely to be revisited).
- Free-fly walkthrough camera is real scope, sequenced immediately after the orbit camera
  ships — not an indefinitely-deferred stretch item like full backyard modeling.
- "Watering" a cell in the must-have is an **instant visual state change** (dry → wet
  soil), not a gradual drying/moisture-decay simulation over time — that's the
  already-deferred "moisture" concept (distinct from water applied), which stays phase
  two+. Must-have water is a toggle-like visual, not a decay curve.
- The rain barrel(s) are assumed fed by roof downspouts (two downspouts are marked near
  the deck on the yard layout, p.2) — but this is an assumption, not a documented fact.
  No page in the source document shows rain barrel plumbing; only one barrel is visible
  in the site photo (p.27). Barrel count, capacity, and plumbing topology should be
  confirmed with the user directly before modeling barrel-fill simulation precisely.
- The automated irrigation is assumed spigot-fed with a hose-end timer (a hose is
  visible entering the PVC manifold in user-supplied photos), independent of the rain
  barrels — but the actual water source is not confirmed, only inferred from photos.
- The garden's real-world location (address or lat/long) will be provided as a
  configuration input, used to compute real sunrise/sunset (and, later, real sun
  position for computed shadows). This is required data, not a tech choice — no need to
  record the literal address in this PRD, just that the system needs it as an input.
- Only sunrise/sunset (astronomical, computable offline or via a free/keyless source) is
  a must-have dependency. Real weather data (rain, clouds, temperature) is a distinct,
  still-deferred dependency for the phase-two weather work — not pulled forward.

**Open questions**
- **New:** No page in the source document shows rain barrel plumbing (diverter kit,
  overflow routing, which downspout feeds which barrel), and only one barrel is visible
  in the site photo (p.27) — despite two 50-gal barrels being mentioned in the original
  request. Barrel count and plumbing topology still need to come from the user directly
  — this is the one distance/setup gap that real measurements above didn't resolve.
- ~~Does the p.25 concrete-block calc belong to the twin veggie beds or a different
  structure?~~ **Resolved:** it's part of the twin veggie bed project — the 74in/76in
  figures are the left bed's clearance to the fence and to the Maple tree respectively
  (and happen to also equal the bed's own length), not a separate structure's dimensions.
- ~~What are the unlabeled "GAR"/"DEN" structures near the Maple Tree?~~ **Resolved:**
  they're the two garden beds themselves — "GARDEN" split across the two bed rectangles
  on that overview sketch.
- ~~What are the "d=10ft" circle and "183in/15ft" arch near the fire pit (p.2)?~~
  **Resolved:** the circle is the Maple tree's 10ft-diameter decorative stone ring; the
  183in/15ft figure is the fence-to-tree distance, not the trellis position as I'd
  guessed.
- Garage distance/position relative to the beds is still not documented anywhere and
  still needs the photo-based estimation approach for the computed-shadow follow-on.
- ~~What exact visual signal represents "watered" vs. "dry"?~~ **Resolved:** watered soil
  renders visibly darker and wet-looking versus dry soil.
- ~~How should the sun study's 4 data points (~8am/10:35am/2pm/4pm) fill the rest of a
  day/night cycle?~~ **Resolved:** must-have bakes/interpolates from those 4 snapshots;
  computed real-time shadows (using real sun position + blockout geometry for the tree/
  garage/deck) are the near-term follow-on, not part of must-have.
- ~~Does dusk trigger off a fixed clock time or actual light levels?~~ **Resolved:**
  neither exactly — dusk/dawn are driven by real, location-computed sunrise/sunset for
  the garden's actual position.
- Does simulated time auto-advance like a real clock (e.g., 1 simulated day = N real
  minutes), or is it a scrubbable control the user drags to any hour? A scrubbable
  control is assumed as the minimum bar (satisfies "capture day and night") — auto-advance
  is a plausible enhancement, not required for must-have.
- ~~Do the p.15 plant assignments represent last season or this season?~~ **Resolved:**
  the transplant dates on p.14/15 (6/21–6/28, no year printed) sit under a "2026: The
  Veggie Garden" title — since today is 2026-07-26, this is the **current 2026 season's**
  actual planting, roughly a month in, not a historical record. The domain model still
  benefits from a season/year dimension so future seasons don't overwrite this one.
- Should the simulation be able to run "forward in time" (predict future growth) or is
  it purely a "change a condition, see an immediate/steady-state effect" tool for now?
- Exact per-cell plant list and planting dates still need a careful manual transcription
  pass — but the reconciliation surface is now narrower than first thought: p.14 and p.15
  are both "Version 2.0" of the current 2026 season (effectively the same final grid,
  cross-checked against each other), while p.11 ("Version #01") and p.12 ("Version #02")
  are earlier draft iterations that led up to it. Reconciling drafts-vs-final is lower
  risk than reconciling three independent, possibly-conflicting sources.
- When does the near-term follow-on (free-fly walkthrough + computed real-time shadows)
  actually start — a concrete signal (e.g., "once the ground plane + both beds look
  right in orbit mode"), or just "immediately after must-have ships"?
- Should "actively being watered" (the 10-minute 8:00–8:10 AM window, hose flowing) look
  visually different in the 3D scene from "recently watered, hose off" (just wet soil,
  already the established visual)? Not required for must-have, but worth a product call
  once there's a working prototype — a moving-water/flow visual is a nice-to-have, not
  a blocker.
- ~~How precise does the tree/garage/deck blockout geometry need to be, and where does
  that data come from?~~ **Resolved:** rough blockout, not survey-grade — built from (a)
  reference photos of the garage/tree/beds together (framing a bed or another known-size
  object alongside the garage/tree gives a scale reference, since bed dimensions are
  already precisely known), (b) the user's description of where the sun rises and sets
  relative to the yard (anchors true compass orientation — the missing link between a
  real computed sun angle and which direction its shadow actually points in this specific
  yard), and (c) the existing yard layout sketch (`docs/Exterior Design.pdf` p.2). No
  on-site survey measurement is required for the quality bar this phase targets.

**Risks**
- **Scope creep toward "simulation game":** the user's own framing ("essentially a
  simulation game") is exciting but open-ended. Without the phased success tiers above,
  this could balloon before the must-have ships.
- **Source data ambiguity (narrowed, not eliminated):** handwritten, sometimes bilingual
  notes across draft-vs-final grid plan versions (p.11 "Version #01," p.12 "Version #02,"
  vs. the final p.14/p.15 "Version 2.0") mean the "real" plant-per-cell truth still needs
  a reconciliation pass — though now known to be drafts-converging-to-one-final rather
  than three independently conflicting sources.
- **Must-have is now a coupled 3D + live-simulation system, not two sequential pieces.**
  Making the 3D orbit viewer *and* real-time water/light visual feedback both must-have
  from day one is a meaningfully bigger initial lift than shipping data capture, then a
  static 3D view, then simulation separately. This is an accepted tradeoff (3D is "the
  biggest factor" for the project to feel worth continuing), but it means there's no
  intermediate shippable milestone between "just data" and "full interactive 3D scene."
- **Stylized/low-poly fidelity may not satisfy once seen.** The user has already flagged
  this pick may change after a first visual pass — worth prototyping the plant look early
  and cheaply before investing in a full plant-per-species catalog at that fidelity.
- **Baked sun-study lighting may look wrong once real sunrise/sunset drives the clock.**
  Since dusk/dawn timing now comes from a real, location-computed feed (not the 4 baked
  snapshots), there's a seam risk: the clock can say "6:47pm, dusk" while the baked
  lighting only really has good data for ~8am/10:35am/2pm/4pm. Interpolation between those
  snapshots should be treated as a rough approximation until the computed-shadow follow-on
  ships — not presented as equally accurate at every hour.

---

## Part B — SDD-ready spec layer

> These four sections map 1:1 onto the spec schema (`templates/spec.*.yaml`). Fill them
> and run `create_spec` (kind = product|domain|api|data|infra).

### B1. Context & scope boundaries

- `in_scope:`
  - Digital capture of both raised garden beds: grid geometry (4 cols × 8 rows per bed,
    per `docs/Exterior Design.pdf` p.1/p.11/p.12/p.15), per-cell plant assignment,
    planting dates, bed dimensions, and reference photos (p.16, p.17).
  - A **3D viewer** with an **orbit camera** (drag to rotate, scroll/pinch to zoom, pan)
    rendering the 2 beds on a simple ground plane, with stylized/low-poly plant geometry
    per grid cell.
  - A plant catalog sufficient to assign a plant/fruit to a grid cell (seeded from the
    brainstorm list on p.3 and the real journal on p.15).
  - A simulation layer, phase one: (a) the real **automated irrigation system** — a hose
    connecting both beds that runs daily at 8:00 AM for 10 minutes, watering all cells —
    modeled so REAL view mode triggers it automatically as simulated/real time crosses
    that window, plus a **manual per-cell water override** in SIMULATION mode, both
    instantly darkening/wetting soil visually; and (b) a **simulated time-of-day**
    control, anchored to the garden's real location, that drives natural light/shadow —
    baked/interpolated from the captured sun/shadow study (p.5–8, p.26) for must-have —
    and switches the garden-bed **solar string lights** (p.17, p.18, p.27) on at real,
    location-computed dusk and off at real dawn — all rendering **live inside the 3D
    viewer** (same scene, real-time visual update), not as a separate report/panel.
  - A clear, unambiguous visual/mode distinction in the 3D viewer between "showing the
    real/current garden state" and "showing a hypothetical simulation run."
  - Modeling the rain barrel(s) as a water source/capacity constraint feeding the
    simulation — count, capacity, and plumbing are assumptions pending user confirmation
    (no source-document page documents this; see open questions), not the p.28 citation
    used earlier, which was incorrect.
- `out_of_scope:`
  - Free-fly walkthrough camera mode and computed real-time shadows (blockout geometry
    for the tree/garage/deck) — sequenced as the immediate next milestone after must-have
    ships, not part of this initial cut, and not an indefinite "someday" item.
  - Full 3D modeling of the rest of the backyard (deck, garage, fence, playset, fire pit,
    gazebo) beyond the simple ground plane and shadow-caster blockouts — optional/stretch
    tier, revisit after must-have ships.
  - A plant-model fidelity upgrade beyond stylized/low-poly (e.g., photoreal-ish assets)
    — explicitly a possible future revision, not built now.
  - Real weather/rain/cloud data (only real sunrise/sunset is in scope), simulation of
    moisture (soil-level, distinct from "water applied"), CO2, and full weather
    (temperature, wind, precipitation forecasting) — phase two+.
  - Live hardware sensor integration (real soil moisture probes, real weather feeds).
  - Multi-user accounts, multi-garden/multi-tenant support, mobile apps, sharing/export
    features, monetization.
  - Any specific technology, framework, database, or 3D engine choice (explicitly
    deferred past this PRD) — including which specific sunrise/sunset data source is used.
- `external_dependencies:`
  - A free/keyless real sunrise/sunset (sun-position) data source for the garden's real
    location — specific provider undecided (a pure astronomical calculation given
    lat/long/date needs no network call at all; a free API is an alternative). This is
    the only external data dependency for must-have.
  - A real-world location (address or lat/long) for the garden, provided as configuration
    — required input, not a service dependency.
  - Real weather data (rain/cloud/temperature) is explicitly NOT a must-have dependency;
    anticipated later for the deferred phase-two weather work.
  - Conceptually anticipated later: a plant-care reference source (water/light/spacing
    needs per species) to power realistic simulation responses — not chosen or
    integrated now.
- `shared_schemas:`
  - `Bed { id, name, width_ft: 4, length_ft: 8, grid_cols, grid_rows, compass_position: SOUTH|NORTH }`
    — confirmed from `docs/Exterior Design.pdf` p.14/15: Bed 1 (cols 1–4) = SOUTH,
    Bed 2 (cols 5–8) = NORTH; each bed 4ft × 8ft, wood-framed (confirmed on 4 separate
    pages — p.18, p.19, p.24, p.28). Total twin-bed footprint (2 beds + paths) = 15ft
    wide.
  - `GridCell { bed_id, column, row, plant_ids: [], planted_at, status, baseline_light: PARTIAL_SHADE|FULL_SUN }`
    — `plant_ids` is a **list, not a single plant**: companion planting is real and
    documented throughout the source (e.g. "Tomato + Basil" sharing a cell, marigold/
    nasturtium scattered as pest-deterrent companions) — a cell modeled as one plant
    would misrepresent the actual garden. `baseline_light` is the structural
    west-to-east gradient documented in the source (row A/west = partial shade, row
    H/east = full sun), layered under the hourly sun study and the live time-of-day
    simulation, not replaced by them.
  - `Plant { id, common_name, species, water_need, light_need, is_companion_planting: bool, notes }`
  - `RainBarrel { id, capacity_gallons, current_gallons, linked_downspout }` — `capacity_gallons`
    and `linked_downspout` are currently **assumptions** (50 gal, fed by a deck downspout),
    not documented facts; no page in the source shows rain barrel plumbing, and only one
    barrel is visible in the site photo (p.27). User-supplied photos of the irrigation
    manifold suggest the barrels are likely a **separate water source** from the automated
    irrigation (which appears spigot-fed), not plumbed into it — confirm with the user
    before treating any of this as ground truth.
  - `SolarLight { id, trellis_or_bed_id, charge_level, status: CHARGING|READY|ILLUMINATED|DEPLETED }`
    — distinct from a separate, non-solar **"Smart String Light"** near the garden
    entrance/deck (likely app or mains-powered, per an electrical outlet marked nearby on
    the yard layout) — two different lighting systems, not variants of one.
  - `SimulationRun { id, status, water_input, simulated_time, affected_cells }`
  - `ViewerState { view_mode: REAL|SIMULATION, camera_mode: ORBIT, active_simulation_run_id }`
  - `GardenLocation { latitude, longitude }` — the real-world position used to compute
    sunrise/sunset; provided as configuration, not user-facing garden data.
  - `DayNightCycle { simulated_time, phase: DAWN|DAY|DUSK|NIGHT, sunrise_at, sunset_at }`
  - `IrrigationSystem { id, bed_ids: [bed1_id, bed2_id], daily_start_time: "08:00", duration_minutes: 10, coverage: ALL_CELLS, water_source: SPIGOT_ASSUMED }`
    — physically a rigid PVC manifold with a shut-off valve at each bed's inner corner,
    joined by a ground-level pipe between the beds (confirmed in user-supplied photos);
    covers all cells in both beds equally (not a partial/row-specific path, per the
    user). `water_source` is an assumption (a hose-fed spigot with a timer, based on a
    hose visible entering the system in photos) — likely independent of the `RainBarrel`
    entity, not sourced from it. Drives automatic watering in REAL view mode when
    simulated/real time crosses the daily window; distinct from manual per-cell watering
    in SIMULATION mode.

### B2. Deterministic state machines

**Grid cell planting lifecycle** — models what's true for one cell in one bed at a time.

- `states:` `EMPTY, PLANTED, GERMINATED, GROWING, HARVESTED, REMOVED`
- `initial:` `EMPTY`
- `transitions:`
  - `{ from: EMPTY, event: assign_plant, to: PLANTED }`
  - `{ from: PLANTED, event: germinate, to: GERMINATED }`
  - `{ from: GERMINATED, event: grow, to: GROWING }`
  - `{ from: GROWING, event: harvest, to: HARVESTED }`
  - `{ from: HARVESTED, event: clear, to: REMOVED }`
  - `{ from: PLANTED, event: remove, to: REMOVED }`
  - `{ from: GERMINATED, event: remove, to: REMOVED }`
  - `{ from: GROWING, event: remove, to: REMOVED }`
  - `{ from: REMOVED, event: assign_plant, to: PLANTED }`
- `forbidden:`
  - `{ from: HARVESTED, to: GROWING, reason: "A harvested plant cannot un-harvest; remove and replant a new cycle instead" }`
  - `{ from: EMPTY, to: GERMINATED, reason: "A cell must be explicitly planted before it can germinate" }`

**Rain barrel water level** — models one 50-gallon barrel's fill state for the simulation.

- `states:` `EMPTY, PARTIAL, FULL, OVERFLOWING`
- `initial:` `EMPTY`
- `transitions:`
  - `{ from: EMPTY, event: add_water, to: PARTIAL }`
  - `{ from: PARTIAL, event: add_water, to: PARTIAL }`
  - `{ from: PARTIAL, event: reach_capacity, to: FULL }`
  - `{ from: FULL, event: add_water, to: OVERFLOWING }`
  - `{ from: OVERFLOWING, event: rain_stop, to: FULL }`
  - `{ from: FULL, event: draw_water, to: PARTIAL }`
  - `{ from: PARTIAL, event: draw_water, to: EMPTY }`
- `forbidden:`
  - `{ from: EMPTY, to: OVERFLOWING, reason: "Volume must pass through PARTIAL/FULL before overflow can occur" }`

**Simulation run** — models one "change a condition and observe" session.

- `states:` `DRAFT, CONFIGURED, RUNNING, PAUSED, COMPLETED`
- `initial:` `DRAFT`
- `transitions:`
  - `{ from: DRAFT, event: set_scenario, to: CONFIGURED }`
  - `{ from: CONFIGURED, event: start, to: RUNNING }`
  - `{ from: RUNNING, event: pause, to: PAUSED }`
  - `{ from: PAUSED, event: resume, to: RUNNING }`
  - `{ from: RUNNING, event: finish, to: COMPLETED }`
- `forbidden:`
  - `{ from: COMPLETED, to: RUNNING, reason: "A completed simulation run must be re-configured as a new run, not resumed" }`

**3D viewer mode** — models whether the 3D scene is currently showing real garden state
or a hypothetical simulation run's effect.

- `states:` `REAL, SIMULATION`
- `initial:` `REAL`
- `transitions:`
  - `{ from: REAL, event: enter_simulation, to: SIMULATION }`
  - `{ from: SIMULATION, event: exit_simulation, to: REAL }`
- `forbidden:`
  - `{ from: SIMULATION, to: SIMULATION, reason: "Switching between simulation runs must pass through REAL (or an explicit run-switch event), never silently swap the active run's data in place" }`

**Day/night cycle** — models the scene's global time-of-day phase, which drives both
natural light/shadow and the solar-light trigger. Phase transitions are timed to real,
location-computed sunrise/sunset (from `GardenLocation`) — not an arbitrary fixed hour.

- `states:` `DAWN, DAY, DUSK, NIGHT`
- `initial:` `DAY`
- `transitions:`
  - `{ from: DAWN, event: sunrise_complete, to: DAY }`
  - `{ from: DAY, event: sunset_begins, to: DUSK }`
  - `{ from: DUSK, event: dark_falls, to: NIGHT }`
  - `{ from: NIGHT, event: sunrise_begins, to: DAWN }`
- `forbidden:`
  - `{ from: DAY, to: NIGHT, reason: "Must pass through DUSK; jumping straight from DAY to NIGHT breaks the gradual lighting transition that sells the day/night cycle" }`
  - `{ from: NIGHT, to: DAY, reason: "Must pass through DAWN for the same reason" }`

**Solar light lifecycle** — models one solar-charged string light on the garden-bed
trellis, mirroring how the real fixtures charge by day and glow by night (p.17/18/27).

- `states:` `CHARGING, READY, ILLUMINATED, DEPLETED`
- `initial:` `CHARGING`
- `transitions:`
  - `{ from: CHARGING, event: charge_sufficient, to: READY }`
  - `{ from: READY, event: dusk_falls, to: ILLUMINATED }`
  - `{ from: ILLUMINATED, event: dawn_breaks, to: CHARGING }`
  - `{ from: ILLUMINATED, event: charge_depleted, to: DEPLETED }`
  - `{ from: DEPLETED, event: dawn_breaks, to: CHARGING }`
- `forbidden:`
  - `{ from: DEPLETED, to: ILLUMINATED, reason: "A depleted light must recharge through a full day before it can illuminate again, not skip straight back on" }`
  - `{ from: CHARGING, to: ILLUMINATED, reason: "A light must reach READY (sufficient charge) before dusk can turn it on" }`

**Irrigation cycle** — models the real hose connecting both beds: an automatic daily
watering event, distinct from manual per-cell watering in SIMULATION mode. Triggered by
a plain daily wall-clock time (08:00), not sun-relative — no `GardenLocation` dependency.

- `states:` `IDLE, RUNNING`
- `initial:` `IDLE`
- `transitions:`
  - `{ from: IDLE, event: schedule_time_reached ("08:00"), to: RUNNING }`
  - `{ from: RUNNING, event: duration_elapsed (10 min), to: IDLE }`
- `forbidden:`
  - `{ from: RUNNING, to: RUNNING, reason: "The daily cycle runs once per day for its fixed 10-minute duration; re-triggering mid-run instead of waiting for duration_elapsed would double-water without a real-world equivalent" }`

### B3. Negative constraints (guardrails)

- `{ id: NC-SPRIG-NO-OVERWRITE-JOURNAL, message: "A simulation run MUST NOT overwrite or mutate the real garden journal history (actual planting/harvest/watering records captured from docs/Exterior Design.pdf p.15 and ongoing real observation).", severity: critical }`
- `{ id: NC-SPRIG-GRID-IMMUTABLE-GEOMETRY, message: "The bed grid dimensions (4 columns x 8 rows per bed) MUST NOT be silently resized by any feature; a physical bed change requires an explicit, dated 'bed renovation' record.", severity: high }`
- `{ id: NC-SPRIG-BARREL-CAPACITY-CAP, message: "A rain barrel's simulated stored volume MUST NOT exceed its rated 50-gallon capacity; excess MUST route to an explicit overflow event rather than being silently discarded or clamped without logging.", severity: medium }`
- `{ id: NC-SPRIG-NO-SILENT-PLANT-CHANGE, message: "A grid cell's plant assignment MUST NOT change without recording a dated event (planted/removed/harvested); no silent overwrites of prior assignments.", severity: high }`
- `{ id: NC-SPRIG-NO-CROSS-HOUSEHOLD, message: "The system MUST NOT expose one household's garden data to another; this project is explicitly single-household scoped and must not assume shared/public data by default.", severity: medium }`
- `{ id: NC-SPRIG-SIM-VS-REAL-VISUAL-DISTINCTION, message: "The 3D viewer MUST NOT render a hypothetical SIMULATION view indistinguishably from the REAL garden state view; there must always be a clear, visible indicator of which mode is active.", severity: high }`
- `{ id: NC-SPRIG-ORBIT-CAMERA-BOUNDS, message: "The orbit camera MUST NOT allow the user to navigate the view away from the garden beds into empty/undefined space; zoom and pan must stay bounded to the scene.", severity: medium }`
- `{ id: NC-SPRIG-SOLAR-LIGHTS-NIGHT-ONLY, message: "Solar string lights MUST NOT render as illuminated during DAY or DAWN; they may only be ILLUMINATED during DUSK/NIGHT and only if sufficiently charged, mirroring real solar-lamp behavior.", severity: medium }`
- `{ id: NC-SPRIG-WATERED-SOIL-VISUAL, message: "A watered grid cell's soil MUST render visibly darker and wet-looking compared to an unwatered cell; the water state MUST NOT be purely numeric/invisible in the 3D view.", severity: medium }`
- `{ id: NC-SPRIG-LIGHT-FOLLOWS-TIME, message: "Natural light and shadow in the 3D scene MUST derive from the simulated time-of-day (baked/interpolated from the captured sun/shadow study for must-have), not from an arbitrary brightness value decoupled from time.", severity: medium }`
- `{ id: NC-SPRIG-DUSK-FROM-REAL-LOCATION, message: "DAWN/DAY/DUSK/NIGHT phase transitions and the solar-light trigger MUST be timed to real, location-computed sunrise/sunset for the garden's actual GardenLocation, not an arbitrary fixed clock hour.", severity: medium }`
- `{ id: NC-SPRIG-NO-WEATHER-API-IN-MUST-HAVE, message: "The must-have build MUST NOT depend on a live weather/rain/cloud data source; only real sunrise/sunset (sun-position) data is an in-scope external dependency.", severity: low }`
- `{ id: NC-SPRIG-IRRIGATION-AUTOMATIC-IN-REAL, message: "In REAL view mode, the daily 8:00 AM/10-minute irrigation event MUST trigger automatically as simulated/real time crosses that window; it MUST NOT require manual user action to occur, mirroring how sunrise/sunset automatically drives the light system.", severity: high }`
- `{ id: NC-SPRIG-MANUAL-WATER-NOT-A-SUBSTITUTE, message: "Manual per-cell watering in SIMULATION mode MUST NOT be presented as replacing or overriding the real daily irrigation baseline's record; it is an experimental overlay, and exiting SIMULATION mode MUST restore the REAL baseline (including the automatic 8 AM cycle), not the manually-watered state.", severity: medium }`

### B4. Executable acceptance criteria

- `{ id: AC-1, given: "the two garden beds as captured from docs/Exterior Design.pdf", when: "a user opens the 3D digital garden view", then: "both beds render in 3D on the ground plane with the correct grid dimensions (4x8 each), and every cell shows its actual assigned plant (stylized/low-poly), or explicitly empty, matching the reconciled garden journal" }`
- `{ id: AC-2, given: "a grid cell in any lifecycle state except HARVESTED-then-immediately-regrown", when: "the user assigns a different plant from the catalog", then: "the cell's plant assignment updates and a dated planting event is recorded, without erasing the prior event's history", invariant: true }`
- `{ id: AC-3, given: "the 3D viewer in SIMULATION mode", when: "the user waters a cell or moves the simulated time-of-day control", then: "the affected cell's soil/lighting updates live in the same view, the real garden journal data is left unmodified, and the viewer clearly indicates SIMULATION mode rather than REAL", invariant: true }`
- `{ id: AC-4, given: "two rain barrels modeled at 50 gallons capacity each", when: "simulated rainfall would exceed the remaining combined capacity", then: "an OVERFLOWING event is recorded for the affected barrel instead of the excess volume silently vanishing" }`
- `{ id: AC-5, given: "the captured sun/shadow study (docs/Exterior Design.pdf p.5-8, p.26)", when: "the simulation clock advances through a simulated day", then: "each cell's light exposure follows the captured real shadow pattern for that time of day rather than a generic/uniform sun model" }`
- `{ id: AC-6, given: "the 3D viewer showing the garden beds", when: "the user drags to rotate or scrolls/pinches to zoom", then: "the orbit camera rotates and zooms smoothly while staying bounded to the garden scene, never navigating to empty/undefined space" }`
- `{ id: AC-7, given: "the REAL view mode is active", when: "the user exits a simulation run", then: "the viewer transitions back to REAL and shows the actual current garden state, with no leftover SIMULATION-mode visual artifacts", invariant: true }`
- `{ id: AC-8, given: "the simulated time-of-day control set to a daytime hour, before real computed sunset for the garden's GardenLocation", when: "viewing the 3D scene", then: "natural light/shadow matches the baked/interpolated sun study for that hour, and the garden-bed solar string lights render as CHARGING/READY (not illuminated)" }`
- `{ id: AC-9, given: "the simulated time-of-day control advanced past real computed sunset for the garden's GardenLocation", when: "viewing the 3D scene", then: "the DayNightCycle transitions through DUSK into NIGHT, the overall scene lighting shifts to a night look, and the garden-bed solar string lights render as ILLUMINATED (glowing)" }`
- `{ id: AC-10, given: "a dry grid cell", when: "the user applies water to it in SIMULATION mode", then: "the cell's soil immediately renders visibly darker and wet-looking, distinct from its prior dry appearance" }`
- `{ id: AC-11, given: "the 3D viewer in REAL view mode", when: "simulated/real time crosses 8:00 AM", then: "the IrrigationSystem transitions IDLE to RUNNING and all cells in both beds render visibly wet within the 10-minute window, with no user action required to trigger it", invariant: true }`
- `{ id: AC-12, given: "the IrrigationSystem has been RUNNING for 10 minutes", when: "the duration elapses", then: "the IrrigationSystem transitions back to IDLE automatically, and cells remain in their wet visual state per the existing no-decay water model (not reverted to dry)" }`
- `{ id: AC-13, given: "SIMULATION mode with cells manually watered by the user", when: "the user exits back to REAL view mode", then: "the viewer shows the REAL baseline (including whatever the automatic 8 AM cycle produced), not the manually-watered SIMULATION state" }`

---

**Order is always: Constitution → Spec → Tests → Code.** Code is the disposable,
regenerable byproduct. If requirements change, rewrite the spec and regenerate.
