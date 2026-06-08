/**
 * src/pages/api/conversion.ts — Server-side conversion tracking endpoint.
 *
 * Accepts POST { experimentId, variantPublicId } from the client (both values
 * are already public — they come from the #10 body data attributes). Records
 * one conversion per visitor per experiment, then recomputes and pushes result
 * charts to the Storyblok Management API.
 *
 * Design highlights:
 *   - Deduplication via an httpOnly `sb_conv_<experimentId>` cookie. A repeat
 *     POST from the same visitor (same cookie) is a no-op — returns 200 with
 *     `{ status: "already_converted" }`.
 *   - Fail-open throughout: Blobs errors, MAPI errors, or a missing roster all
 *     produce a 200 success response (and a console.error) rather than a 4xx/5xx.
 *     This ensures a tracking failure never breaks the conversion button.
 *   - The OAuth management token is held exclusively in experiment-store.ts and
 *     never included in any response or request log here.
 *
 * Scope: issue #17 (conversion tracking).
 */

import type { APIRoute } from 'astro';
import { recordConversion, pushResultsCharts } from '../../lib/experiment-store';

/** ~30 days in seconds, mirroring the stickiness cookie max-age. */
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

/**
 * Build the per-experiment conversion deduplication cookie name.
 * Pattern mirrors `sb_exp_<experimentId>` used for stickiness.
 */
function conversionCookieName(experimentId: number): string {
	return `sb_conv_${experimentId}`;
}

export const POST: APIRoute = async ({ request, cookies }) => {
	// --------------------------------------------------------------------------
	// 1. Parse and validate the request body.
	// --------------------------------------------------------------------------

	let requestBody: unknown;
	try {
		requestBody = await request.json();
	} catch {
		return new Response(
			JSON.stringify({ status: 'error', message: 'Invalid JSON body.' }),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		);
	}

	if (
		!requestBody ||
		typeof requestBody !== 'object' ||
		!('experimentId' in requestBody) ||
		!('variantPublicId' in requestBody)
	) {
		return new Response(
			JSON.stringify({
				status: 'error',
				message: 'Missing required fields: experimentId, variantPublicId.',
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const { experimentId: rawExperimentId, variantPublicId } =
		requestBody as Record<string, unknown>;

	// experimentId may arrive as a string (JSON attribute from DOM) or number.
	const experimentId =
		typeof rawExperimentId === 'number'
			? rawExperimentId
			: parseInt(String(rawExperimentId), 10);

	if (
		!Number.isFinite(experimentId) ||
		typeof variantPublicId !== 'string' ||
		variantPublicId.trim() === ''
	) {
		return new Response(
			JSON.stringify({
				status: 'error',
				message:
					'experimentId must be a valid integer and variantPublicId must be a non-empty string.',
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } },
		);
	}

	// --------------------------------------------------------------------------
	// 2. Deduplication: check for an existing conversion cookie.
	// --------------------------------------------------------------------------

	const cookieName = conversionCookieName(experimentId);
	const existingConversionCookie = cookies.get(cookieName);

	if (existingConversionCookie?.value) {
		// Already converted — no-op. Return success so the button stays silent.
		return new Response(
			JSON.stringify({ status: 'already_converted' }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	}

	// --------------------------------------------------------------------------
	// 3. Set the conversion cookie before the IO so that a Blobs failure does
	//    not leave the visitor without a cookie (they would then convert twice
	//    on retry). httpOnly + SameSite=Lax + Path=/ mirrors the stickiness
	//    cookie attributes from the delivery route.
	// --------------------------------------------------------------------------

	cookies.set(cookieName, '1', {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: THIRTY_DAYS_IN_SECONDS,
	});

	// --------------------------------------------------------------------------
	// 4. Record the conversion in Blobs and push updated charts to the MAPI.
	//    All IO is wrapped in a single fail-open try/catch — any error at any
	//    step (Blobs read, Blobs write, MAPI push) is logged and swallowed.
	//    The cookie was already set above, so the visitor is deduped even if
	//    the counts write fails.
	// --------------------------------------------------------------------------

	try {
		const updatedMetrics = await recordConversion(experimentId, variantPublicId);

		try {
			await pushResultsCharts(experimentId, updatedMetrics);
		} catch (pushError) {
			// MAPI push failed. The Blobs count was already written — the tally is
			// accurate, just not yet reflected in Storyblok. Log and continue.
			console.error(
				`[experiments] Failed to push results charts for experiment ${experimentId} — the conversion was counted but the chart was not updated.`,
				pushError,
			);
		}
	} catch (blobsError) {
		// Blobs read or write failed. The conversion cookie was already set above
		// so the visitor will not double-convert if they retry.
		console.error(
			`[experiments] Failed to record conversion in Blobs for experiment ${experimentId} — failing open.`,
			blobsError,
		);
	}

	return new Response(
		JSON.stringify({ status: 'ok' }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } },
	);
};
