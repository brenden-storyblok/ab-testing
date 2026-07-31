# A/B Testing

This app renders Storyblok stories and serves A/B test variants of them. Storyblok owns the experiment configuration; the app picks a variant per visitor and fetches the story that variant points at.

## Language

### Configuration

**Experiment**:
A running A/B test defined in Storyblok. Carries an `id`, a technical `name`, and variants whose weights sum to 100.
_Avoid_: Test, split test, campaign

**Variant**:
One arm of an experiment, identified by `public_id`. Exactly one variant of an experiment is the control.
_Avoid_: Arm, treatment, bucket

**Control**:
The variant that renders the original story unchanged. Flagged `is_control`.
_Avoid_: Baseline, original variant, A

**Story mapping**:
A variant's link from an original story to its variant copy, as `original_slug` and `variant_slug`. `original_slug` holds a full slug, so `blog/post` rather than `post`.
_Avoid_: Variant mapping, story link

**Variant slug**:
The slug of a variant story. Storyblok builds it by joining the original story's slug, the experiment's technical name, and the variant's technical name with hyphens.
_Avoid_: Variant path, variant URL

### Runtime

**Visitor ID**:
The stable identifier an assignment derives from. It names neither a user nor a session.
_Avoid_: User ID, session ID, cookie ID

**Bucketing**:
Mapping a visitor ID onto a variant with no stored state. The same visitor ID and experiment always yield the same variant.
_Avoid_: Randomization, sampling, rolling

**Assignment**:
A visitor's resolved variant for one experiment.
_Avoid_: Allocation, selection, enrollment

### Measurement

**Exposure**:
The event recording that a visitor saw an assigned variant.
_Avoid_: Impression, view, hit

**Conversion**:
The event recording that a visitor reached a named goal after exposure.
_Avoid_: Win, success, goal completion

**Adapter**:
A sink the app hands exposure and conversion events to. This app configures none yet.
_Avoid_: Sink, tracker, reporter
