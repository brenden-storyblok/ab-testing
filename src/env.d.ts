/// <reference path="../.astro/types.d.ts" />

declare namespace App {
	interface Locals {
		visitorId: string;
		runningExperiments: import('@storyblok/experiments').Experiments;
		conversionPayload: string | undefined;
	}
}
