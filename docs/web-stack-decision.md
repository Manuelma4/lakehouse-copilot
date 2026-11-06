# Web stack decision

Decision date: 2026-10-06. The product interface is React/TypeScript, with Python
analytics and inference behind an explicit API contract.

The author's [CV and case studies](https://manuelma4.github.io/) already describe
React clients, TypeScript services, Python/FastAPI, SQL, Spark and Databricks. This
project connects those skills through one inspectable product and two independent
repositories. Private employer code, documents and architecture are not copied.

| Layer | Choice | Reason |
|---|---|---|
| Web language | TypeScript | Typed match/probability/evidence contracts; compile-time feedback |
| Interface | React | Custom accessible interactions, analytical views and a cited-chat workspace |
| Build tool | Vite | Existing Python backend, fast local development and ordinary static assets |
| Design | Original CSS + Lucide | Product-specific typography/layout, responsive behavior, no hosted theme service |
| API | FastAPI/Pydantic | Preserve tested Python analytics/tools and provide OpenAPI request validation |
| Data/ML | Python, SQL, Spark/Delta | Keep transformations, temporal features and experiments outside rendering code |
| Static output | Vite build | Original synthetic snapshot and separate verified CC0 research assets with deterministic evidence |
| Local AI | Ollama/Qwen + Nomic | Full cited analyst behavior runs locally rather than requiring a paid model API |

React documents [integration with existing backends](https://react.dev/learn/add-react-to-an-existing-project),
and Vite provides a [React/TypeScript setup](https://vite.dev/guide/). FastAPI builds
validation and OpenAPI from [Python types](https://fastapi.tiangolo.com/python-types/).

## Alternatives considered

[Next.js](https://nextjs.org/docs/app/getting-started) is useful for server-rendered
content, React Server Components and integrated server routes. This analytics
workspace already has a Python backend, and its free public demonstration is an
immutable dataset. Adding another application server has no current acceptance
benefit; it remains an option if the product develops authenticated server-rendered
routes. Django remains suitable for a future large administrative application;
the current typed read-only API and inference service already fit FastAPI.

## Deployment modes

The static showcase runs in snapshot mode. It explores fictional teams,
distributions and documents alongside a separate verified CC0 football package
with match records and source-derived team profiles. It answers evidence
questions deterministically.

The local website uses a same-origin `/api` proxy or the FastAPI-served build.
The local backend provides generation, hybrid retrieval, persistent checkpoints,
traces and feedback. It binds to loopback. Public multi-user inference needs a
separate authenticated/rate-limited deployment and is not silently enabled here.
