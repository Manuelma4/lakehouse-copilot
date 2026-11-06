# Streaming and replay

Free providers are polled REST sources. Polling changes are emitted as append-only match observations. This is not provider push or a free play-by-play stream. Spark Structured Streaming processes files with AvailableNow and persistent checkpoints. Late revisions require recomputing affected match and team summaries. Replaying an identical event is idempotent. Conflicting source revisions are quarantined rather than choosing an arbitrary payload.
