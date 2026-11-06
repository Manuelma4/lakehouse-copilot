import { useRef, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  Check,
  FileText,
  LoaderCircle,
  MessageSquare,
  Send,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import type { OpenFootballConnection, OpenFootballSnapshot } from '../openFootball'
import { sendResearchFeedback, sendResearchQuestion, staticResearchAnswer } from '../researchChat'
import type { ResearchContext, ResearchResponse } from '../researchChat'

export function ResearchQuestion({
  data,
  connection,
  context,
}: {
  data: OpenFootballSnapshot
  connection: OpenFootballConnection
  context: ResearchContext
}) {
  const [question, setQuestion] = useState('Summarize the imported source evidence.'),
    [localAi, setLocalAi] = useState(false),
    [loading, setLoading] = useState(false),
    [response, setResponse] = useState<ResearchResponse>(),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [savingFeedback, setSavingFeedback] = useState(false)
  const publicMode = connection === 'snapshot'
  const evidence = useRef<HTMLDetailsElement>(null)
  async function ask(event: React.FormEvent) {
    event.preventDefault()
    if (!question.trim() || loading) return
    setLoading(true)
    setError('')
    setResponse(undefined)
    setFeedback('')
    try {
      setResponse(
        publicMode
          ? staticResearchAnswer(data, context, question)
          : await sendResearchQuestion(data, context, question, localAi ? 'ollama' : 'evidence'),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The research request failed.')
    } finally {
      setLoading(false)
    }
  }
  async function rate(rating: -1 | 1) {
    if (!response || savingFeedback) return
    setSavingFeedback(true)
    try {
      await sendResearchFeedback(response.trace_id, rating)
      setFeedback('Research feedback saved.')
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Research feedback could not be saved.')
    } finally {
      setSavingFeedback(false)
    }
  }
  return (
    <details className="of-research-question">
      <summary>
        <MessageSquare size={17} />
        <span>Ask about this {context.kind}</span>
        <ArrowUpRight size={15} />
      </summary>
      <div className="of-research-question-body">
        <p className="of-research-context">
          <FileText size={14} />
          <span>
            {context.label}
            <small>OpenFootball source context · {data.manifest.dataset_version}</small>
          </span>
        </p>
        <span className="of-research-mode">
          {publicMode
            ? 'Deterministic source summary'
            : localAi
              ? 'Local research AI'
              : 'Local evidence browser'}
        </span>
        <p className="of-helper">
          {publicMode
            ? 'This public view reads the accepted source package. No generative model is called. Use a local API for AI interpretation.'
            : 'Read-only research over the selected source identity. Evidence mode shows structured records; local AI can explain them.'}
        </p>
        <form onSubmit={ask}>
          <label>
            <span>Research question</span>
            <textarea
              aria-label="Research question"
              rows={3}
              maxLength={2000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              disabled={loading}
            />
          </label>
          <div className="of-research-submit">
            {!publicMode && (
              <label>
                <input
                  type="checkbox"
                  aria-label="Local research AI"
                  checked={localAi}
                  onChange={(event) => setLocalAi(event.target.checked)}
                  disabled={loading}
                />
                <Bot size={14} />
                Local AI
              </label>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={loading || !question.trim()}
            >
              {loading ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
              {loading ? 'Investigating…' : 'Ask research'}
            </button>
          </div>
        </form>
        {error && (
          <div className="notice notice-error" role="alert">
            <p>{error}</p>
            <small>
              {localAi
                ? 'The requested local model was not replaced with a public answer. Disable Local AI to explicitly retry evidence mode.'
                : 'No answer from a different dataset was substituted.'}
            </small>
          </div>
        )}
        {response && (
          <div className="of-research-answer" role="region" aria-label="Research answer">
            <div className="of-research-answer-heading">
              <span>{response.abstained ? 'Evidence limit' : 'Source evidence'}</span>
              <small>
                {response.mode === 'ollama' ? response.model || 'Local model' : 'No model called'}
              </small>
            </div>
            <p>{response.answer}</p>
            <details className="of-research-evidence" ref={evidence}>
              <summary>
                Inspect research tool evidence <FileText size={13} />
              </summary>
              {response.tool_results.length ? (
                response.tool_results.map((tool, index) => (
                  <section
                    key={`${tool.tool}-${index}`}
                    aria-label={`Research evidence ${tool.tool}`}
                  >
                    <b>{tool.tool}</b>
                    <small>{tool.source || 'No source reference'}</small>
                    <pre>{JSON.stringify(tool.rows || [], null, 2).slice(0, 14000)}</pre>
                  </section>
                ))
              ) : (
                <p>No supporting source records were returned.</p>
              )}
            </details>
            {!!response.citations.length && (
              <div className="of-research-citations" aria-label="Research citations">
                <FileText size={13} />
                <span>
                  References:{' '}
                  {response.citations.map((cite, index) => {
                    const id = cite.id || cite.source || 'Unresolved reference'
                    return (
                      <button
                        key={`${id}-${index}`}
                        aria-label={`Inspect research source ${id}`}
                        onClick={() => {
                          if (evidence.current) {
                            evidence.current.open = true
                            evidence.current.querySelector('summary')?.focus()
                          }
                        }}
                      >
                        {id}
                      </button>
                    )
                  })}
                </span>
              </div>
            )}
            <dl className="of-research-trace">
              <div>
                <dt>Research dataset</dt>
                <dd>
                  <code>{response.dataset_version}</code>
                </dd>
              </div>
              <div>
                <dt>{publicMode ? 'Browser evidence ID' : 'Research trace'}</dt>
                <dd>
                  <code>{response.trace_id}</code>
                </dd>
              </div>
              <div>
                <dt>Package fingerprint</dt>
                <dd>
                  <code>{response.snapshot_fingerprint}</code>
                </dd>
              </div>
            </dl>
            {!publicMode && (
              <div className="of-research-feedback">
                <span>Useful source evidence?</span>
                <button
                  aria-label="Helpful research answer"
                  disabled={savingFeedback || feedback === 'Research feedback saved.'}
                  onClick={() => void rate(1)}
                >
                  <ThumbsUp size={15} />
                </button>
                <button
                  aria-label="Unhelpful research answer"
                  disabled={savingFeedback || feedback === 'Research feedback saved.'}
                  onClick={() => void rate(-1)}
                >
                  <ThumbsDown size={15} />
                </button>
                {feedback && (
                  <span role="status">
                    {feedback === 'Research feedback saved.' && <Check size={12} />}
                    {feedback}
                  </span>
                )}
              </div>
            )}
            {publicMode && (
              <p className="of-helper">
                Browser evidence is temporary. Feedback is recorded only by the local research API.
              </p>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
