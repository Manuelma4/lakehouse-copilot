# Current match data on your own machine

Arena Copilot reads validated Current match exports from a separate collector.
The default fictional and CC0 research workspaces run with the data bundled in
this repository.

## Private collection

Keep the collector workspace outside the checkout. Run it with your own
authorized football-data.org or PandaScore credentials in the collector's
environment. Keep raw responses, SQLite state, canonical exports and captures in
that private workspace. Configure `ARENA_LIVE_WORKSPACE` in your local
`.env` to point Copilot at the verified exports, then start the
[local application](development.md#local-application).

Run a single collector per account to avoid duplicate polls and competing quota
reservations. The free football feed has a delayed score and request limits.
PandaScore coverage is match-level. Source times distinguish a new collection
attempt from a successful update. A failed poll can leave the previous verified
dataset active with its original freshness timestamps.

## Optional display export

Run the separate display exporter only for a site covered by the provider's
terms. The [data source guide](../DATA_SOURCES.md) gives the source credits and
licensing boundaries. Keep generated display files in a private build staging
directory and out of this source repository, its release assets and its Docker
build context.

The helper requires an installed compatible Arena Lakehouse adapter. With
the collector credentials in your environment, run this from the repository
root with a new private workspace path.

```bash
python scripts/refresh_live_display.py \
  --workspace /path/to/new/private/workspace \
  --output /path/to/private/display
```

A previously verified local package can be supplied using
`--previous-package`. Recovery checks the inventory, types, checksums and
freshness fields before retaining the package. The
[display contract](live-publication.md) documents the exporter and browser
validation.
