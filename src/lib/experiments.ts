/**
 * experiments.ts — Framework-agnostic functional core for Storyblok Experiments.
 *
 * No Astro imports, no network calls. All IO (story/experiments fetching,
 * cookie access) is performed by the caller and injected where needed.
 *
 * Delivery flow (per the Storyblok docs): fetch the story first, then match an
 * experiment by `experiment.story_ids.includes(story.id)`, pick a variant, and
 * — only for non-control variants — remap to the variant story via the
 * variant's `story_mappings` (matched on `story.full_slug`). The control
 * variant has an empty `story_mappings` array and renders the original story.
 *
 * Scope: issue #7 (sticky weighted variant assignment).
 * Deferred to other issues:
 *   - #8: runtime fail-open hardening for fetch errors / variant-404
 *   - #9: ?sb_variant override (forcedVariantName is reserved in the options object below)
 *   - #10: data-sb-* DOM attributes
 */

// ---------------------------------------------------------------------------
// Domain types (match CDN API v2 cdn/experiments response shape)
// ---------------------------------------------------------------------------

export interface StoryMapping {
	original_story_id: number;
	original_slug: string;
	variant_story_id: number;
	variant_slug: string;
}

export interface Variant {
	name: string;
	display_name: string;
	public_id: string;
	weight: number;
	is_control: boolean;
	/** Empty for the control variant; populated for non-control variants. */
	story_mappings: StoryMapping[];
}

export interface Experiment {
	id: number;
	name: string;
	display_name: string;
	/** IDs of the original (source) stories this experiment is linked to. */
	story_ids: number[];
	variants: Variant[];
}

/** The minimal story shape the core needs to make a decision. */
export interface StoryRef {
	id: number;
	full_slug: string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Find the running experiment that includes the given story, matching on the
 * numeric story id against `experiment.story_ids`. Returns null if none match.
 *
 * This mirrors the documented delivery pattern
 * (`experiments.find(e => e.story_ids.includes(story.id))`) and is a flat
 * lookup rather than a nested scan of every variant's story_mappings.
 */
export function findExperimentForStory(
	experiments: Experiment[],
	storyId: number,
): Experiment | null {
	return (
		experiments.find((experiment) => experiment.story_ids.includes(storyId)) ??
		null
	);
}

/**
 * Weighted random selection over variant weights.
 * Weights are treated as relative — they should sum to 100 but we normalise
 * against their total to be safe.
 *
 * @param variants - Non-empty array of variants.
 * @param random   - Injectable random source returning [0, 1). Defaults to Math.random.
 */
export function pickVariant(
	variants: Variant[],
	random: () => number = Math.random,
): Variant {
	if (variants.length === 1) {
		return variants[0];
	}

	const totalWeight = variants.reduce(
		(runningTotal, variant) => runningTotal + (variant.weight ?? 0),
		0,
	);

	// Guard: if all weights are zero, fall back to uniform selection.
	if (totalWeight === 0) {
		const fallbackIndex = Math.floor(random() * variants.length);
		return variants[fallbackIndex];
	}

	const roll = random() * totalWeight;
	let cumulativeWeight = 0;
	for (const variant of variants) {
		cumulativeWeight += variant.weight ?? 0;
		if (roll < cumulativeWeight) {
			return variant;
		}
	}

	// Floating-point edge: roll === total exactly; return last variant.
	return variants[variants.length - 1];
}

/**
 * The slug of the story to fetch for a chosen variant, or null when the
 * original story should be rendered as-is.
 *
 * Returns null for the control variant (which has no story_mappings) and for
 * any variant lacking a mapping for this story's full_slug. Otherwise returns
 * the mapping's variant_slug.
 */
export function variantSlugFor(
	variant: Variant,
	originalFullSlug: string,
): string | null {
	if (variant.is_control) {
		return null;
	}
	const mapping = variant.story_mappings.find(
		(storyMapping) => storyMapping.original_slug === originalFullSlug,
	);
	return mapping?.variant_slug ?? null;
}

// ---------------------------------------------------------------------------
// Variant resolution
// ---------------------------------------------------------------------------

export interface ResolveVariantOptions {
	experiment: Experiment;
	/**
	 * The public_id from the per-experiment cookie, if present.
	 * A value that maps to no current variant is treated as absent.
	 */
	cookiePublicId?: string | null;
	/**
	 * Reserved for issue #9 (demo override). Providing a value here has no
	 * effect in this slice — the parameter exists so the interface can be
	 * extended later without a breaking change.
	 */
	forcedVariantName?: string | null;
	/** Injectable random source; defaults to Math.random. */
	random?: () => number;
}

export interface ResolveVariantResult {
	variant: Variant;
	/** True when the caller should persist the chosen variant to the cookie. */
	persist: boolean;
}

/**
 * Determine which variant to serve for a request, given precedence rules:
 *   1. (Reserved) forcedVariantName — #9
 *   2. Valid cookie public_id → reuse, no re-persist
 *   3. Weighted pick → persist = true
 *
 * A cookiePublicId that matches no current variant is treated as absent.
 */
export function resolveVariant({
	experiment,
	cookiePublicId,
	random,
}: ResolveVariantOptions): ResolveVariantResult {
	// Cookie lookup — reuse if the public_id maps to a current variant.
	if (cookiePublicId) {
		const existingVariant = experiment.variants.find(
			(variant) => variant.public_id === cookiePublicId,
		);
		if (existingVariant) {
			return { variant: existingVariant, persist: false };
		}
		// Cookie is stale / unknown — fall through to weighted pick.
	}

	// Weighted pick.
	const variant = pickVariant(experiment.variants, random);
	return { variant, persist: true };
}

// ---------------------------------------------------------------------------
// Orchestrator (pure — IO is injected)
// ---------------------------------------------------------------------------

export interface ResolveExperimentOptions {
	/** The already-fetched original story (only id + full_slug are needed). */
	story: StoryRef;
	/** Running experiments from cdn/experiments (already fetched by the caller). */
	experiments: Experiment[];
	/**
	 * Reads the stickiness cookie value (variant public_id) for a given
	 * experiment id. Injected so the core stays pure and testable; the Astro
	 * route supplies one backed by Astro.cookies. Return undefined/null if absent.
	 */
	readCookie?: (experimentId: number) => string | null | undefined;
	/** Injectable random source; forwarded to resolveVariant/pickVariant. */
	random?: () => number;
}

export interface ResolveExperimentResult {
	/** The matched experiment, or null if the story is in no running experiment. */
	experiment: Experiment | null;
	/** The chosen variant, or null if no experiment matched. */
	variant: Variant | null;
	/** True when the caller should set/refresh the stickiness cookie. */
	persist: boolean;
	/**
	 * The slug of the variant story to fetch, or null to render the original
	 * story already in hand (control variant, no experiment, or no mapping).
	 */
	variantStorySlug: string | null;
}

/**
 * Decide how to deliver a story: match an experiment by story id, resolve a
 * variant (cookie reuse or weighted pick), and report whether the original
 * story should be remapped to a variant story.
 *
 * Pure and synchronous: the caller fetches the story and experiments, supplies
 * a cookie reader, then acts on the result (set the cookie, fetch the variant
 * story). On no match, returns nulls and `variantStorySlug: null` so the
 * caller renders the original story unchanged.
 */
export function resolveExperiment({
	story,
	experiments,
	readCookie,
	random,
}: ResolveExperimentOptions): ResolveExperimentResult {
	const experiment = findExperimentForStory(experiments, story.id);
	if (!experiment) {
		return {
			experiment: null,
			variant: null,
			persist: false,
			variantStorySlug: null,
		};
	}

	const cookiePublicId = readCookie ? readCookie(experiment.id) : undefined;
	const { variant, persist } = resolveVariant({
		experiment,
		cookiePublicId,
		random,
	});

	return {
		experiment,
		variant,
		persist,
		variantStorySlug: variantSlugFor(variant, story.full_slug),
	};
}
