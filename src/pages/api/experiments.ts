import type { APIRoute } from 'astro';
import { useStoryblokApi } from '@storyblok/astro';
import { countOnce, getExperimentsClient } from '../../lib/experiments';

export const POST: APIRoute = async ({ request, cookies, locals }) => {
	const { goal } = (await request.json()) as { goal?: string };

	if (!goal || locals.isVisualEditor) {
		return Response.json({ status: 'ignored' }, { status: 200 });
	}

	const client = await getExperimentsClient(useStoryblokApi());

	// Every experiment this visitor is bucketed into, recomputed from the
	// visitorId alone. Nothing is delivered yet, so the visitor's cookies get a
	// say before anything is recorded. `track` is these three steps with no
	// filter in between, for when there is nothing to check.
	const assignments = client.assignments(locals.visitorId);
	const fresh = assignments.filter((assignment) => countOnce(cookies, 'conv', assignment.experiment.id));

	// Await delivery: this response ends the invocation, and a serverless runtime
	// drops whatever is still in flight when it does.
	await Promise.all(fresh.map((assignment) => client.send(client.createEvent(goal, assignment))));

	return Response.json({
		status: 'ok',
		recorded: fresh.length,
		skipped: assignments.length - fresh.length,
	});
};
