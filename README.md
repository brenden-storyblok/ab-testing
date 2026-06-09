# Storyblok Core Space Blueprint: Astro

Integrate [Astro](https://astro.build) with [Storyblok](http://www.storyblok.com) as a headless CMS.

This blueprint is ideal for kickstarting new Storyblok and Astro projects. What's inside:

- Pre-configured default blocks: `page`, `teaser`, `grid`, and `feature`.
- Support for the Visual Editor's live preview.
- Dynamic routing to fetch and render new stories automatically.
- Minimal styling.

> [!TIP]
> Follow our [Astro guide](https://www.storyblok.com/docs/guides/astro/) for a step-by-step walkthrough and learn more about Storyblok's range of features, including rich text rendering, custom content modeling, and internationalization. See the [@storyblok/astro package reference](https://storyblok.com/docs/packages/storyblok-astro) for further information.

---

[Open in GitHub Codespaces](https://github.com/codespaces/new?skip_quickstart=true&machine=basicLinux32gb&repo=964226617&ref=main&geo=EuropeWest)
[Try Storyblok free](https://app.storyblok.com/#/signup)
[Join the Storyblok Discord community](https:/storyblok.com/join-discord)

## Get Started

**No Storyblok account yet? [Sign up now](https://app.storyblok.com/#/signup?utm_source=docs) to experience a 14-day free trial of all features and enjoy our completely free Starter plan.**

1. Create a new empty Storyblok space
2. Create a new repository based on this template
3. Open the project on your device
4. Install dependencies

```sh
npm install
```

### Authentication

In the root of the project, create a `.env` file to store the access token of your space:

```sh
STORYBLOK_DELIVERY_API_TOKEN=<REPLACE_WITH_YOUR_TOKEN>
```

> [!TIP]
> Copy your space's preview access token from **Settings > Access Tokens**.
> Learn more about Storyblok [access tokens](https://www.storyblok.com/docs/concepts/access-tokens).

### Connect the Visual Editor

To render a preview of the local project in the Visual Editor, follow these steps:

1. In your space, navigate to **Settings > Visual Editor**.
2. Set the default environment to `https://localhost:4321/`.
3. Save.
4. Open the `home` story.
5. Click **Config**.
6. Type `/` in the **Real path**.

Run the development server:

```sh
npm run dev
```

> [!IMPORTANT]
> To connect the Storyblok Visual Editor, the local project must run over HTTPS. Learn more in the [Visual Editor concept](https://www.storyblok.com/docs/concepts/visual-editor#local-development-via-https). Check the [Visual Preview section of the Astro guide](https://storyblok.com/docs/guides/astro/visual-preview) for detailed instructions.

Back in Storyblok, open the **Home** story to start editing.

Happy building!

## A/B Testing & Conversion Tracking

Beyond the stock blueprint, this space serves **Storyblok Experiments**: it A/B-tests content at the story level, assigns each visitor a variant server-side, and reports impression and conversion results back into Storyblok's experiment charts. This section documents that feature (the work tracked under issue #15 and its sub-issues #10, #16, #17, and #18).

> [!TIP]
> For the canonical definition of every term below — *Experiment*, *Variant*, *Control*, *Assignment*, *Stickiness*, *Impression*, *Conversion*, *Goal*, *Results* — see `[CONTEXT.md](./CONTEXT.md)`. The two design decisions behind this feature are recorded in `[docs/adr/0001-server-side-variant-assignment.md](./docs/adr/0001-server-side-variant-assignment.md)` and `[docs/adr/0002-conversion-tracking-via-blobs-and-pushed-charts.md](./docs/adr/0002-conversion-tracking-via-blobs-and-pushed-charts.md)`.

### How it works

The lifecycle of a single visitor, from request to chart:

1. **Assignment (server-side).** On each request, the catch-all route resolves whether the story belongs to a running experiment and, if so, which variant the visitor sees. Selection is weighted-random and **sticky** — the choice is stored in an `sb_exp_<experimentId>` cookie and reused on repeat visits, so a visitor never flips variants. This happens during SSR, so there is no flash of the original content and no JavaScript dependency. See `resolveExperiment()` in `src/lib/experiments.ts`.
2. **Impression.** The first time a visitor is assigned (a fresh weighted pick, not a cookie reuse), the route records one impression in the per-experiment tally. Repeat visits do not re-count. See `recordImpression()` in `src/lib/experiment-store.ts`.
3. **DOM exposure.** The resolved assignment is rendered onto the page `<body>` as `data-sb-experiment` (the experiment id) and `data-sb-variant` (the variant's `public_id`) so the browser can read it without re-deriving anything. See `experimentDataAttributes()` (`src/lib/experiments.ts`), spread onto `<body>` in `src/layouts/Layout.astro`. On a non-experiment page these attributes are simply absent.
4. **Conversion.** When the visitor clicks a **conversion button** (see below), the browser reads those two attributes off `<body>` and `POST`s `{ experimentId, variantPublicId }` to `/api/conversion`. The endpoint counts **one conversion per visitor per experiment** (deduplicated via an `sb_conv_<experimentId>` cookie) and is **fail-open** — a tracking failure never breaks the page or the button. See `src/pages/api/conversion.ts`.
5. **Results push.** After updating the tally, the endpoint recomputes two charts — *conversion rate by variant* and *impressions/conversions volume* — and pushes them to Storyblok's Management API. They appear in **Storyblok → Labs → Experiments → Results**. See `pushResultsCharts()` in `src/lib/experiment-store.ts`.

> [!TIP]
> **Demoing variants.** Append `?sb_variant=<variant_name>` to any experiment URL to force a specific variant for the current view (it does *not* write the stickiness cookie). The reserved `?sb_variant=reset` makes you a **fresh visitor** — it clears both the stickiness and conversion cookies so the next request re-assigns you and the conversion button can fire again.

### Why a tally store + pushed charts

Storyblok Experiments **stores and displays charts only — it does no event counting** and exposes no per-event ingestion endpoint; the only write path replaces a pre-computed chart snapshot wholesale, and it requires a privileged token that must never reach the browser. So this app keeps its own per-variant tallies in **Netlify Blobs** and pushes recomputed charts from the server. The full reasoning, trade-offs (Netlify-specific, racy under concurrency, current-tallies-only) and fail-open posture are in [ADR-0002](./docs/adr/0002-conversion-tracking-via-blobs-and-pushed-charts.md).

> [!IMPORTANT]
> Conversion tracking depends on **Netlify Blobs** for the tally store and runs the results push from a server route. It works under `netlify dev` and on a deployed Netlify site; the Blobs store is unavailable in a plain non-Netlify runtime.

### Environment variables

The stock blueprint only needs `STORYBLOK_DELIVERY_API_TOKEN` (above). Conversion tracking additionally requires these in your `.env`:

```sh
STORYBLOK_MANAGEMENT_TOKEN=<REPLACE_WITH_YOUR_TOKEN>
STORYBLOK_SPACE_ID=<REPLACE_WITH_YOUR_SPACE_ID>
STORYBLOK_REGION=<eu|us|cn|ap|ca>
```

- `STORYBLOK_MANAGEMENT_TOKEN` — a personal access / OAuth token with Management API access, used **only** server-side to push result charts. It is held exclusively in `src/lib/experiment-store.ts` and never sent to the browser or written to logs. Generate one under **My account → Personal access tokens** (or a space-level token under **Settings → Access Tokens**).
- `STORYBLOK_SPACE_ID` — the numeric id of your space, used to address the Management API results endpoint. Find it under **Settings → General**.
- `STORYBLOK_REGION` — your space's region (defaults to `eu`).

### Adding a conversion button

Conversions are triggered by the `**conversion_button`** component (a nestable block with a single `label` field, registered as `conversion_button: 'storyblok/ConversionButton'` in `astro.config.mjs`; the Astro component is `src/storyblok/ConversionButton.astro`).

To use it, an editor drops a **Conversion Button** block into any story's content in the Visual Editor and sets its **label** (e.g. "Sign up"). On a page that is part of a running experiment, clicking it records a conversion for the visitor's assigned variant without navigating away. On a page with no experiment, the click is inert.

### Observability

The `/api/conversion` endpoint logs the outcome of every request to the function log (filter on the `[experiments]` prefix): the request received with its experiment/variant, the recorded tally, an already-converted no-op, and a successful chart push — plus `warn`-level lines for rejected requests and `error`-level lines for fail-open Blobs/Management API failures. On Netlify these appear under **Logs → Functions**, so you can confirm the full path end-to-end after deploying.

### Where it lives in the code


| Concern                                           | File                                   | Key exports                                                      |
| ------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| Assignment, stickiness, overrides, DOM attributes | `src/lib/experiments.ts`               | `resolveExperiment`, `experimentDataAttributes`, `pickVariant`   |
| Metrics model & pure chart logic                  | `src/lib/experiment-metrics.ts`        | `ExperimentMetrics`, `incrementConversion`, `buildResultsCharts` |
| Blobs tally store & chart push                    | `src/lib/experiment-store.ts`          | `recordImpression`, `recordConversion`, `pushResultsCharts`      |
| SSR delivery (assignment + impression)            | `src/pages/[...slug].astro`            | —                                                                |
| Body data attributes                              | `src/layouts/Layout.astro`             | —                                                                |
| Conversion endpoint                               | `src/pages/api/conversion.ts`          | `POST` handler                                                   |
| Conversion button component                       | `src/storyblok/ConversionButton.astro` | —                                                                |


## Resources

- To learn more about what you can do with Storyblok, visit [our documentation and learning hub](https://www.storyblok.com/docs).
- To learn more about the integration between Storyblok and Astro, check our [dedicated developer tutorials](https://www.storyblok.com/tutorials?technologies=astro).
- To learn more about Astro, check the [official documentation](https://docs.astro.build).

### Support

- Have questions, need help, want to chat with other users? [Join our Discord community](https://storyblok.com/join-discord).
- Visit the Storyblok [Help Center](https://support.storyblok.com/).

