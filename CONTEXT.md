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

A demo affordance to force a specific variant for the current page view via `?sb_variant=<variant name>`. View-only — it does **not** write the stickiness cookie. `?sb_variant=reset` returns to normal weighted assignment.
