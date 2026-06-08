# Context

Domain glossary for this project. Terms here are the canonical vocabulary — use them in code, issues, and docs. Definitions describe the *domain*, not the implementation.

## A/B Testing (Storyblok Experiments)

This app serves Storyblok content and runs Storyblok **Experiments** to A/B test content at the story level.

### Experiment

A Storyblok record connecting one or more source stories to alternative content **variants**, with traffic split by weight. Has a `status` (`draft`, `running`, `paused`, `completed`). Only **running** experiments are returned by the delivery API and acted on at request time. A given story belongs to at most one experiment at a time.

### Variant

One content variation within an experiment. Carries a technical `name` (e.g. `control`, `variant_a`), a `public_id` (opaque identifier used to reference the variant in delivery/analytics), a `weight` (0–100; all variants in an experiment sum to 100), and an `is_control` flag.

### Control

The baseline variant (`is_control: true`) — the original experience measured against. The original/source story is always treated as the control.

### Story Mapping

The pairing inside a **non-control** variant that says "when the visitor would see `original_slug`, serve `variant_slug` instead." The **control** variant has an empty `story_mappings` array — it always renders the original story.

Matching follows the Storyblok delivery pattern: an experiment is matched to a story by **story id** (`experiment.story_ids` includes the fetched `story.id`), and the variant story is then resolved by looking up the mapping whose `original_slug` equals the story's `full_slug`.

### Assignment

The act of choosing which variant a given visitor sees. Done **server-side** (this app is SSR) by weighted random selection across variant weights. See ADR-0001.

### Stickiness

Once assigned, a visitor keeps the same variant on repeat visits. Backed by a per-experiment cookie (`sb_exp_<experimentId>` → variant `public_id`, `httpOnly`). A stale cookie pointing at a variant that no longer exists triggers a fresh assignment.

### Override (demo)

A demo affordance to force a specific variant for the current page view via `?sb_variant=<variant name>`. View-only — it does **not** write the stickiness cookie. The reserved value `?sb_variant=reset` makes the visitor a **fresh visitor**: it ignores and deletes the stickiness cookie *and* the conversion cookie, shows the control (baseline) variant for the current view without persisting, and leaves the visitor unassigned and un-converted (the next normal request re-assigns — a new **impression** — and the conversion button can fire again). An unknown variant name is ignored and normal cookie/weighted-pick resolution continues. `reset` is reserved and cannot be a variant's technical name.

## Conversion Tracking

Measuring how each **variant** performs by recording two visitor-level metrics and reporting them back to Storyblok as experiment **results**.

### Impression

A visitor being assigned a variant — i.e. seeing that variant's experience. Counted **once per visitor per experiment**, at the moment of first **assignment** (not on repeat visits). The denominator of the conversion rate.

### Conversion

A visitor completing the **goal** an experiment is optimising for. Counted **once per visitor per goal** — a visitor who triggers the same goal twice converts once. The numerator of the conversion rate.

### Goal

The named outcome a conversion is attributed to (e.g. `signup`, `cta_click`). A visitor signals a goal by interacting with a **conversion button** placed in the content. An experiment can have one or more goals.

### Conversion Rate

`conversions ÷ impressions` for a variant — the metric compared across variants to judge a winner. Always ≤ 100% because both are counted per unique visitor.

### Results

The aggregated snapshot reported to Storyblok for an experiment. Storyblok **stores and displays charts only — it does not count events itself**; this app accumulates the per-variant impression/conversion tallies, computes the conversion rate, and pushes pre-computed charts to the Management API results endpoint. See ADR-0002.
