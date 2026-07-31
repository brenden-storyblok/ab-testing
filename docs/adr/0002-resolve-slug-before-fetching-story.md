# 0002: Resolve the slug before fetching the story

## Status

Accepted

## Context

Storyblok's concepts page fetches the story, fetches experiments, matches with `story_ids.includes(story.id)`, then fetches the variant story and overwrites. The library's package reference resolves the slug first and then fetches once.

## Decision

Follow the library reference. Fetch `cdn/experiments`, resolve the slug, fetch that story.

## Consequences

Two API calls happen per request whether or not an experiment applies, against the concepts page's three for anyone on a non-control variant. Matching happens on slug through `story_mappings` rather than on story ID, so an experiment whose variant stories do not exist yet carries no mappings and no-ops without a signal. The control variant ships `story_mappings: []`, so slug matching depends on a non-control variant carrying the mapping.
