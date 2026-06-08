/**
 * experiments.ts — Framework-agnostic functional core for Storyblok Experiments.
 *
 * No Astro imports, no direct network calls. All IO is injected.
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
	story_mappings: StoryMapping[];
}

export interface Experiment {
	id: number;
	name: string;
	display_name: string;
	story_ids: number[];
	variants: Variant[];
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Find the first experiment whose variants contain a story_mapping with the
 * given original_slug. Returns null if no match.
 */
export function findExperimentForSlug(
	experiments: Experiment[],
	slug: string,
): Experiment | null {
	for (const experiment of experiments) {
		for (const variant of experiment.variants) {
			for (const mapping of variant.story_mappings) {
				if (mapping.original_slug === slug) {
					return experiment;
				}
			}
		}
	}
	return null;
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

	const total = variants.reduce((sum, v) => sum + (v.weight ?? 0), 0);

	// Guard: if all weights are zero, fall back to uniform selection.
	if (total === 0) {
		const idx = Math.floor(random() * variants.length);
		return variants[idx];
	}

	const roll = random() * total;
	let cumulative = 0;
	for (const variant of variants) {
		cumulative += variant.weight ?? 0;
		if (roll < cumulative) {
			return variant;
		}
	}

	// Floating-point edge: roll === total exactly; return last variant.
	return variants[variants.length - 1];
}

/**
 * Return the variant_slug for the given original_slug in this variant's
 * story_mappings. If no mapping found, returns the original slug unchanged.
 */
export function mappedSlugFor(variant: Variant, slug: string): string {
	for (const mapping of variant.story_mappings) {
		if (mapping.original_slug === slug) {
			return mapping.variant_slug;
		}
	}
	return slug;
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
		const existing = experiment.variants.find(
			(v) => v.public_id === cookiePublicId,
		);
		if (existing) {
			return { variant: existing, persist: false };
		}
		// Cookie is stale / unknown — fall through to weighted pick.
	}

	// Weighted pick.
	const variant = pickVariant(experiment.variants, random);
	return { variant, persist: true };
}

// ---------------------------------------------------------------------------
// Async orchestrator
// ---------------------------------------------------------------------------

export interface ResolveExperimentForRequestOptions {
	slug: string;
	/**
	 * The public_id read from the per-experiment cookie for this experiment,
	 * if it exists. Pass null / undefined if absent.
	 */
	cookiePublicId?: string | null;
	/**
	 * IO seam — injected function that fetches the running experiments list.
	 * Must return only running experiments (the CDN API already filters these).
	 */
	fetchExperiments: () => Promise<Experiment[]>;
	/** Injectable random source; forwarded to resolveVariant/pickVariant. */
	random?: () => number;
}

export interface ResolveExperimentForRequestResult {
	/** The story slug to fetch — either the original or the variant's mapped slug. */
	storySlug: string;
	/** The matched experiment, or null if no experiment matched. */
	experiment: Experiment | null;
	/** The chosen variant, or null if no experiment matched. */
	variant: Variant | null;
	/** True when the caller should set/refresh the stickiness cookie. */
	persist: boolean;
}

/**
 * Async orchestrator: fetch experiments → match slug → resolve variant → map slug.
 *
 * On no match, returns { storySlug: slug, experiment: null, variant: null, persist: false }.
 *
 * Note: Minimal error handling is intentional here. Full fail-open hardening
 * (fetch timeouts, variant-story 404s) is tracked in issue #8.
 */
export async function resolveExperimentForRequest({
	slug,
	cookiePublicId,
	fetchExperiments,
	random,
}: ResolveExperimentForRequestOptions): Promise<ResolveExperimentForRequestResult> {
	const noMatch: ResolveExperimentForRequestResult = {
		storySlug: slug,
		experiment: null,
		variant: null,
		persist: false,
	};

	let experiments: Experiment[];
	try {
		experiments = await fetchExperiments();
	} catch {
		// Minimal fail-open — full hardening is issue #8.
		return noMatch;
	}

	const experiment = findExperimentForSlug(experiments, slug);
	if (!experiment) {
		return noMatch;
	}

	const { variant, persist } = resolveVariant({
		experiment,
		cookiePublicId,
		random,
	});

	const storySlug = mappedSlugFor(variant, slug);

	return { storySlug, experiment, variant, persist };
}
