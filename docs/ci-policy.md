# Local verification

Run the checks in the [development guide](development.md#verification) on your
Mac or development computer. Start with the offline Python suite, Ruff and the
TypeScript check. Run a focused browser scenario when changing an interface or
its data contracts. Evidence reports identify the fixtures and runtime used in
each historical verification.

Keep provider collection, Spark integration and local model evaluation separate
from routine tests. Run these only when the relevant change needs that evidence.
