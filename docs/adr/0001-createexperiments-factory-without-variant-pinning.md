# 0001: Use the `createExperiments` factory without variant pinning

## Status

Accepted

## Context

The library offers two surfaces. `createExperiments` binds the payload and adapters and does the experiment lookup. The bare `assignVariant` plus `resolveExperiment` pair accepts an `assignment` argument, which is the library's hook for supplying a stored variant. Storyblok's concepts documentation describes a cookie per experiment holding the chosen variant.

## Decision

Use `createExperiments`, one instance per request. Persist one `sb_visitor_id` cookie and derive every assignment from it. Skip per-experiment variant pinning.

## Consequences

`assignVariant` walks cumulative weights, so an editor who changes a split from 50/50 to 70/30 mid-flight moves some returning visitors to a different variant. Adding pinning later means dropping to the bare `resolveExperiment`, because the factory accepts no `assignment`. The factory holds a `Map` of assignments, so a module-scoped instance would leak one visitor's assignments into another visitor's `track` calls.
