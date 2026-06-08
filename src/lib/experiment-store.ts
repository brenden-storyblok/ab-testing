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
 *   - No Management API call is made here. Impressions are written to Blobs only
 *     so the SSR hot path stays fast.
 *
 * Scope: issue #16 (impression metrics). The conversion write path (#17) will
 * share this same store and metrics shape.
 */

import { getStore } from '@netlify/blobs';
import {
	applyImpression,
	emptyMetrics,
	type ExperimentMetrics,
} from './experiment-metrics';
import type { Variant } from './experiments';

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
