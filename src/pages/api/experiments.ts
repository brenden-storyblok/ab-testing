import type { APIRoute } from 'astro';
import { useStoryblokApi } from '@storyblok/astro';
import { countOnce, getExperimentsClient } from '../../lib/experiments';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
	const { goal } = (await request.json()) as { goal?: string };
	if (!goal) {
		return Response.json({ status: 'ignored' }, { status: 400 });
	}

	const client = await getExperimentsClient(useStoryblokApi());

	// `createEvent` buckets the visitor and builds the conversion events without
	// delivering them, so the visitor's cookies still get a say before anything
	// is recorded. `track` is the same thing plus immediate delivery, for when
	// there is nothing to filter.
	const events = client.createEvent(goal, locals.visitorId);
	const fresh = events.filter((event) => countOnce(cookies, 'conv', event.experiment.id));

	// Await delivery: this response ends the invocation, and a serverless runtime
	// drops whatever is still in flight when it does.
	await Promise.all(fresh.map((event) => client.send(event)));

	return Response.json({ status: 'ok', recorded: fresh.length, skipped: events.length - fresh.length });
};
