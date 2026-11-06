# Local models and licenses

- Generator: [Qwen3:4b](https://ollama.com/library/qwen3:4b), downloaded through
  Ollama, Apache 2.0. CPU defaults: context 4096, temperature 0, thinking disabled,
  one generation request at a time. No weights in the repository.
- Embeddings: [nomic-embed-text:137m-v1.5-fp16](https://ollama.com/library/nomic-embed-text:137m-v1.5-fp16),
  768 dimensions, Apache 2.0. Use `search_document: ` and `search_query: ` prefixes.
  [Original model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5).

Original project code/fixtures use MIT. Model licenses are separate. First-run
downloads require internet; subsequent local inference does not require an API key.
The installed Gemma model is not silently substituted for the specified generator.
