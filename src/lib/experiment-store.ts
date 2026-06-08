/**
 * experiment-store.ts — Netlify Blobs shell for per-experiment metrics.
 *
 * This module is the imperative shell: it owns the Blobs IO (get, set) and
 * delegates all metrics logic to the pure core in experiment-metrics.ts.
 *
 * Design notes:
 *   - The store is only available in a Netlify runtime (netlify dev / deploy).
 *     Calling recordImpression in a non-Netlify context (e.g. `astro dev` without
 *     netlify dev) will fail at getStore(); the outer try/catch in the delivery
 *     route catches it and the page renders normally (fail-open, per ADR-0001/#8).
 *   - The read-modify-write is not atomic. Accepted at demo traffic levels
 *     (see ADR-0002).
 *   - No Management API call is made here for impressions. Impressions are written
 *     to Blobs only so the SSR hot path stays fast.
 *
 * Scope:
 *   - Issue #16 (impression metrics): recordImpression
 *   - Issue #17 (conversion metrics): recordConversion, pushResultsCharts
 */

import { getStore } from '@netlify/blobs';
import StoryblokClient from 'storyblok-js-client';
import {
	applyImpression,
	emptyMetrics,
	incrementConversion,
	buildResultsCharts,
	type ExperimentMetrics,
} from './experiment-metrics';
import type { Variant } from './experiments';

// ---------------------------------------------------------------------------
// Management API client (issue #17)
//
// A second Storyblok client instance configured with an OAuth token for writes.
// This is the ONLY place in the codebase that holds the management token — it
// must never be passed to the client, included in a response, or logged.
//
// Built lazily so that import-time env reads don't error in test environments
// that don't have the management env vars set.
// ---------------------------------------------------------------------------

let managementClient: StoryblokClient | null = null;

function getManagementClient(): StoryblokClient {
	if (managementClient !== null) {
		return managementClient;
	}

	const managementToken = import.meta.env.STORYBLOK_MANAGEMENT_TOKEN;
	const region = import.meta.env.STORYBLOK_REGION || 'eu';

	if (!managementToken) {
		throw new Error(
			'[experiments] STORYBLOK_MANAGEMENT_TOKEN is not set — cannot push results charts.',
		);
	}

	managementClient = new StoryblokClient({
		oauthToken: managementToken,
		region,
	});

	return managementClient;
}

/**
 * Push the two recomputed result charts to the Storyblok Management API for
 * the given experiment.
 *
 * Uses `POST spaces/:space_id/experiments/:experiment_id/results` which
 * replaces the stored chart snapshot wholesale — no partial update.
 *
 * Throws on MAPI errors — the caller is responsible for fail-open handling.
 */
export async function pushResultsCharts(
	experimentId: number,
	metrics: ExperimentMetrics,
): Promise<void> {
	const spaceId = import.meta.env.STORYBLOK_SPACE_ID;

	if (!spaceId) {
		throw new Error(
			'[experiments] STORYBLOK_SPACE_ID is not set — cannot push results charts.',
		);
	}

	const charts = buildResultsCharts(metrics);
	if (charts === null) {
		// No roster means no meaningful charts. Skip push rather than pushing
		// an empty snapshot — consistent with the fail-open / no-roster posture
		// described in ADR-0002.
		console.warn(
			`[experiments] No roster for experiment ${experimentId} — skipping results push.`,
		);
		return;
	}

	const client = getManagementClient();
	await client.post(
		`spaces/${spaceId}/experiments/${experimentId}/results`,
		{ charts } as any,
	);
}

/** The Blobs store name used for all experiment metrics. */
const EXPERIMENT_STORE_NAME = 'experiment-metrics';

/**
 * Build the Blobs key for an experiment's metrics.
 * Keyed by the numeric experiment id to match the cookie/DOM attribute naming.
 */
function experimentBlobKey(experimentId: number): string {
	return `experiment-${experimentId}`;
}

/**
 * Read the current metrics for an experiment from Blobs.
 * Returns an empty record when no Blob exists yet.
 * Throws on Blobs errors — the caller is responsible for fail-open handling.
 */
async function readMetrics(
	experimentId: number,
): Promise<ExperimentMetrics> {
	const store = getStore(EXPERIMENT_STORE_NAME);
	const blobKey = experimentBlobKey(experimentId);
	const stored = await store.get(blobKey, { type: 'json' });
	if (stored === null) {
		return emptyMetrics();
	}
	return stored as ExperimentMetrics;
}

/**
 * Write the metrics for an experiment to Blobs.
 * Throws on Blobs errors — the caller is responsible for fail-open handling.
 */
async function writeMetrics(
	experimentId: number,
	metrics: ExperimentMetrics,
): Promise<void> {
	const store = getStore(EXPERIMENT_STORE_NAME);
	const blobKey = experimentBlobKey(experimentId);
	await store.setJSON(blobKey, metrics);
}

/**
 * Record one impression for a fresh visitor assignment.
 *
 * Reads the current metrics, applies seedRoster + incrementImpression via the
 * pure applyImpression core, then writes back to Blobs.
 *
 * Fail-open: any Blobs error is swallowed by the delivery route's outer
 * try/catch — this function does not catch internally so the error propagates
 * cleanly to that boundary without any wrapping.
 *
 * Must only be called from the `persist` branch of the delivery route (a fresh
 * weighted assignment). The delivery route is responsible for never calling
 * this on cookie-reuse (returning visitor) paths, Visual Editor paths, or
 * non-experiment pages.
 */
export async function recordImpression(
	experimentId: number,
	variants: Variant[],
	assignedVariantPublicId: string,
): Promise<void> {
	const currentMetrics = await readMetrics(experimentId);
	const updatedMetrics = applyImpression(
		currentMetrics,
		variants,
		assignedVariantPublicId,
	);
	await writeMetrics(experimentId, updatedMetrics);
}

/**
 * Record one conversion for the given variant.
 *
 * Reads the current metrics, increments the variant's conversion count via the
 * pure incrementConversion core, then writes back to Blobs.
 *
 * Returns the updated metrics so the caller can build and push result charts
 * without an additional Blobs read.
 *
 * Fail-open: any Blobs error propagates to the caller (the conversion route),
 * which wraps all IO in a try/catch and returns success regardless.
 *
 * Caller note: deduplication (once per visitor) is enforced by the conversion
 * route via the sb_conv_<experimentId> cookie — this function does not check
 * for duplicates.
 */
export async function recordConversion(
	experimentId: number,
	variantPublicId: string,
): Promise<ExperimentMetrics> {
	const currentMetrics = await readMetrics(experimentId);

	// If the roster is empty the conversion arrived before the feature was
	// deployed or before the Blob was seeded. Increment the count anyway
	// (incrementConversion handles the missing-variant case) so we don't lose
	// the signal, but note that pushResultsCharts will skip the push since
	// charts can't be built without a roster.
	const updatedMetrics = incrementConversion(currentMetrics, variantPublicId);
	await writeMetrics(experimentId, updatedMetrics);
	return updatedMetrics;
}
