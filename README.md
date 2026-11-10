# Storyblok Experiments on Astro

A running A/B test built on [Astro](https://astro.build) and [Storyblok](http://www.storyblok.com).

A visitor requests a page. The server picks a variant for them, fetches that variant's content, and counts one impression. When the visitor clicks a goal button, the server counts one conversion. Both tallies land on the experiment's Results tab inside Storyblok, so an editor reads the outcome in the app.

The project starts from the Storyblok Astro blueprint, so what that ships still works here:

- Pre-configured default blocks: `page`, `teaser`, `grid`, and `feature`.
- Support for the Visual Editor's live preview.
- Dynamic routing to fetch and render new stories automatically.
- Minimal styling.

On top of that, this project adds:

- Server-side variant assignment through `[@storyblok/experiments](https://www.storyblok.com/docs/libraries/js/experiments)`, keyed on a first-party visitor cookie.
- Impression and conversion counting, capped at one of each per visitor per experiment per month.
- A `conversionButton` block that reports a goal from the browser with `sendBeacon`.
- Aggregated results pushed to the experiment as two bar charts.
- A Visual Editor path that renders the linked story and records nothing.

> [!NOTE]
> [Experiments](https://www.storyblok.com/docs/concepts/experiments) is a premium beta feature, enabled per space under **Settings > Labs**.

> [!TIP]
> Follow our [Astro guide](https://www.storyblok.com/docs/guides/astro/) for a step-by-step walkthrough and learn more about Storyblok's range of features, including rich text rendering, custom content modeling, and internationalization. See the [@storyblok/astro package reference](https://www.storyblok.com/docs/libraries/js/astro-sdk) for further information.

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

In the root of the project, create a `.env` file:

```sh
STORYBLOK_DELIVERY_API_TOKEN=<REPLACE_WITH_YOUR_PREVIEW_TOKEN>
STORYBLOK_MANAGEMENT_TOKEN=<REPLACE_WITH_YOUR_PERSONAL_ACCESS_TOKEN>
STORYBLOK_SPACE_ID=<REPLACE_WITH_YOUR_SPACE_ID>
STORYBLOK_REGION=eu
```


| Variable                       | Used for                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `STORYBLOK_DELIVERY_API_TOKEN` | Fetching stories and the running experiments from the Content Delivery API.          |
| `STORYBLOK_MANAGEMENT_TOKEN`   | Reading and pushing experiment results through the Management API. Server-side only. |
| `STORYBLOK_SPACE_ID`           | Scoping the Management API client to your space.                                     |
| `STORYBLOK_REGION`             | `eu`, `us`, `ap`, `ca`, or `cn`. Defaults to `eu`.                                   |


> [!TIP]
> Copy your space's preview access token from **Settings > Access Tokens**, and create a personal access token under **My Account > Personal access tokens**.
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

The `dev` script points `NODE_EXTRA_CA_CERTS` at the `vite-plugin-mkcert` root CA (`~/.vite-plugin-mkcert/rootCA.pem`), which makes Node trust the local certificate the plugin generates.

Back in Storyblok, open the **Home** story to start editing.

Happy building!

## Set up an experiment in Storyblok

Enable Experiments under **Settings > Labs**, then open **Labs > Experiments**. The [user manual](https://www.storyblok.com/docs/manuals/experiments) covers this flow in full.

1. Select **+ Create new**. Give the experiment a name, a technical name (the identifier the Content Delivery API uses), and an optional description.
2. A new experiment arrives with two variants, a control and a test. Name each one, give each a technical name, and set the weight distribution so the percentages total 100. **+ Add variant** adds more.
3. Link the story while the experiment sits in draft. Open `home` in the Visual Editor, find the **Experiment** section in the right sidebar, and link it. A variants toggle appears in the toolbar; pick a variant there to edit its content.
4. Add a `conversionButton` block to the story. It reads two text fields, `label` and `goal`. Change the `label` between variants and keep the `goal` identical, so both variants compete on one metric.
5. Publish every story and variant, then select **Start experiment**. The app reads running experiments only.

The variant's content lives inside the linked story, so Storyblok stores no second story. The Content Delivery API exposes each variant at a slug it derives from the story slug, the experiment's technical name, and the variant's technical name, joined by hyphens: a `bold` variant of `home` in a `hero-test` experiment resolves to `home-hero-test-bold`. The `cdn/experiments` payload carries those `original_slug` to `variant_slug` mappings, and the app fetches whichever slug the library returns.

Goals live in the app. Storyblok holds no goal configuration, so the `goal` string on the button is the label the library attaches to the conversion, and this project uses it as the chart metric.

Run `npm run dev` and load the page in a private window. Assignment hashes the visitor id and follows the weights you set. A response for a story under test carries an `x-storyblok-variant` header naming the variant that was served, control included. Click the conversion button, then open **Labs > Experiments > your experiment > Results** for two bar charts:

- **Conversion rate by variant**
- **Impressions & conversions by variant**



## How the code works


| Step                                                                                                                       | Where                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Mint or read the `sb_visitor_id` cookie, skipping Visual Editor requests.                                                  | [src/middleware.ts](src/middleware.ts)                                      |
| Fetch the running experiments, resolve the requested slug against them, then fetch and render the assigned variant's slug. | [src/pages/[...slug].astro](src/pages/[...slug].astro)                      |
| Count the impression, once per visitor per experiment.                                                                     | [src/lib/experiments.ts](src/lib/experiments.ts)                            |
| Report a click as a goal string over `sendBeacon`.                                                                         | the inline script in [src/pages/[...slug].astro](src/pages/[...slug].astro) |
| Recompute the visitor's assignments and count the conversion, once per visitor per experiment.                             | [src/pages/api/experiments.ts](src/pages/api/experiments.ts)                |
| Tally both metrics onto the experiment's results charts.                                                                   | [src/lib/experiments.ts](src/lib/experiments.ts)                            |




### The experiments client

`[getExperimentsClient](src/lib/experiments.ts#L73)` builds one `createExperiments` instance and caches it behind a 60-second TTL, so requests share it instead of building one per render. Variant assignment hashes the visitor id, so the instance holds no per-visitor state and any request can reconstruct a visitor's assignments with `assignments(visitorId)`. `/api/experiments` uses that to record a conversion for a click whose render already finished.

The page render passes `exposure: false` to `resolveExperiment`, which returns the exposure descriptor instead of delivering it, and the route sends it once the cookie check passes. Both call sites await their own `send` rather than `flush()`, which on a shared instance would wait on other requests' deliveries.

### Counting

`[countOnce](src/lib/experiments.ts#L189)` writes an `sb_exp_<id>` or `sb_conv_<id>` cookie for 30 days and reports whether it already existed. Both metrics count a visitor once per experiment, so the conversion rate compares per-visitor conversions against per-visitor impressions.

The browser posts `{ goal }` and nothing else. The server derives the experiment, the variant, and the visitor from the cookie.

### Results storage

Storyblok ingests no experiment events. The documented flow collects performance data in an analytics platform and loads it into Storyblok through the Management API's experiments results endpoint, which is what the Results tab renders. This project fills that role itself: each event reads the current charts, increments one bar, and pushes the whole snapshot back. A push replaces the snapshot, so those two charts hold the entire record.

The adapter at [src/lib/experiments.ts](src/lib/experiments.ts#L65) receives both event types and calls the Management API directly, rather than posting to `/api/experiments` through the library's `fetchAdapter`. Bars sit in first-seen order, since the event payload carries no `is_control`.

> 💡 In a real world scenario - always send your events to something like an analytics system and export the results to Storyblok from there. This will help to avoid dropped updates due to management API rate limits. 

### The Visual Editor

The middleware treats a referrer with a query param that includes `_storyblok`  as a Visual Editor render. The app then mints no visitor cookie, resolves no experiment, and drops any conversion beacon. It renders the slug the Visual Editor asks for, which leaves the variants toggle in charge of what an editor sees and keeps editor traffic out of the results.

## Deployment

`astro.config.mjs` loads the Netlify adapter when `NETLIFY` is set. Set an adapter for whichever platform you deploy to before running `npm run build`.

## Resources

- [Experiments concept](https://www.storyblok.com/docs/concepts/experiments) covers the model: experiments, variants, control, weights, and derived variant slugs.
- [User Manual: Experiments](https://www.storyblok.com/docs/manuals/experiments) covers the app: creating an experiment, linking stories, editing variants, and starting or finishing a run.
- `[@storyblok/experiments](https://www.storyblok.com/docs/libraries/js/experiments)` documents the library, including `resolveExperiment`, `assignments`, `track`, the built-in adapters, and the serverless delivery options.
- To learn more about what you can do with Storyblok, visit [our documentation and learning hub](https://www.storyblok.com/docs).
- To learn more about the integration between Storyblok and Astro, check our [dedicated developer tutorials](https://www.storyblok.com/tutorials?technologies=astro).
- To learn more about Astro, check the [official documentation](https://docs.astro.build).



### Support

- Have questions, need help, want to chat with other users? [Join our Discord community](https://storyblok.com/join-discord).
- Visit the Storyblok [Help Center](https://support.storyblok.com/).

