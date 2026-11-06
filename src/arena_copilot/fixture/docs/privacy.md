# Privacy and access boundaries

This project ingests team-level match metadata, not private player profiles. Tokens never enter snapshots or prompts. SQL queries are predefined and parameterized. The copilot cannot run arbitrary SQL or modify the source lakehouse. Exported data is immutable and provider-scoped IDs avoid team collisions. Account authentication and multi-user access controls remain future deployment work; the local demo binds to loopback.
