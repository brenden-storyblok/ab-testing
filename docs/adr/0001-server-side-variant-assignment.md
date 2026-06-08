# Server-side variant assignment for experiments

---
status: accepted
---

Storyblok's developer docs recommend assigning A/B test variants **client-side** (fetch `cdn/experiments` in the browser, weighted-pick, set a cookie, swap content) — guidance aimed at static/SPA hosts where the server can't see the request. This app runs Astro in **SSR mode** (`output: 'server'`), so we instead assign variants **on the server**: the page reads the incoming stickiness cookie, picks a variant by weight if none exists, sets the cookie on the response, and fetches the variant's story before the first byte is rendered.

We chose this because client-side assignment causes a flash of the original content before JS swaps it in, breaks without JavaScript, and is unfriendly to crawlers — none of which apply once the server owns the decision. The trade-off is that every page now needs the running-experiments list before it can resolve which story to fetch (one extra Storyblok round-trip per request; see the per-request, no-cache decision). All failures fail open to the original/control story so a broken experiment never takes down a page.
