# 0003: No error handling around experiment fetches

## Status

Accepted

## Context

`cdn/experiments` can fail, and Experiments is a paid Storyblok add-on. A resolved variant slug can 404 when an editor never published the variant story. The library's own documented examples contain no error handling.

## Decision

Let both fetches throw. Astro surfaces the failure.

## Consequences

A space without the Experiments add-on cannot render any page. An unpublished variant story returns an error to the slice of traffic assigned to it, rather than hiding behind the control. Any missing story surfaces as a 500 rather than a 404, which the route already did before experiments arrived. Broken experiments stay loud during development. Serving real traffic would mean revisiting this.
