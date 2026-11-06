import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import type { LiveMatch, LivePage, LiveProvider } from '../live'
import { liveProviders, publishedLive } from '../live'
import { askLiveMatch, LiveCaptureChangedError, sendLiveFeedback } from '../liveChat'
import type { LiveAnswer, LiveAsk, LiveChatMode, LiveToolEvidence } from '../liveChat'
import './liveChat.css'

const stamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'UTC',
        timeZoneName: 'short',
      }).format(new Date(value))
    : 'No verified capture'
const prompts = [
  ['Match status', 'Explain this match status and whether its score is a confirmed result.'],
  ['UTC kickoff', 'What is the captured UTC kickoff for this match?'],
  ['Source freshness', 'Explain the captured provider check and dataset observation cutoff.'],
] as const

function ToolEvidence({ tool }: { tool: LiveToolEvidence }) {
  const raw = JSON.stringify(tool, null, 2)
  return (
    <section className="live-chat-tool" aria-label={`Current answer evidence ${tool.tool}`}>
      <header>
        <b>{tool.tool}</b>
        <small>{tool.source || 'Tool error — no source reference'}</small>
      </header>
      {tool.error ? (
        <p>{tool.error}</p>
      ) : (
        <>
          {tool.tool === 'live_match' && (
            <p className="live-chat-score-note">
              <b>{tool.result_known ? 'Completed result' : 'Unconfirmed source score fields'}</b>
              {tool.score_interpretation}
            </p>
          )}
          <details className="live-chat-records">
            <summary>
              Structured records · {tool.rows?.length ?? 0} <ChevronRight size={13} />
            </summary>
            <pre>{raw.slice(0, 16000)}</pre>
            {raw.length > 16000 && (
              <small>Visible evidence is truncated at 16,000 characters.</small>
            )}
          </details>
        </>
      )}
    </section>
  )
}

export function LiveChatPanel({
  provider,
  match,
  page,
}: {
  provider: LiveProvider
  match: LiveMatch
  page: LivePage | undefined
}) {
  const [question, setQuestion] = useState(prompts[0][1] as string),
    [mode, setMode] = useState<LiveChatMode>('evidence'),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState<LiveAnswer>(),
    [asked, setAsked] = useState<LiveAsk>(),
    [error, setError] = useState(''),
    [refreshRequired, setRefreshRequired] = useState(false),
    [notice, setNotice] = useState(''),
    [comment, setComment] = useState(''),
    [feedback, setFeedback] = useState(''),
    [feedbackError, setFeedbackError] = useState(''),
    [savingFeedback, setSavingFeedback] = useState(false),
    [rating, setRating] = useState<-1 | 1>()
  const questionInput = useRef<HTMLTextAreaElement>(null),
    evidence = useRef<HTMLDetailsElement>(null),
    pending = useRef<AbortController | null>(null),
    pendingFeedback = useRef<AbortController | null>(null),
    generation = useRef(0),
    feedbackGeneration = useRef(0)

  useEffect(() => {
    generation.current++
    feedbackGeneration.current++
    pending.current?.abort()
    pendingFeedback.current?.abort()
    setBusy(false)
    setAnswer(undefined)
    setAsked(undefined)
    setError('')
    setRefreshRequired(false)
    setNotice('')
    setFeedback('')
    setFeedbackError('')
    setSavingFeedback(false)
    setRating(undefined)
    setComment('')
    return () => {
      generation.current++
      feedbackGeneration.current++
      pending.current?.abort()
      pendingFeedback.current?.abort()
    }
  }, [provider, match.match_id])

  async function ask(request: LiveAsk) {
    if (busy || publishedLive || !request.question.trim()) return
    if (
      !page?.snapshot_available ||
      !request.snapshot_fingerprint ||
      request.snapshot_fingerprint !== page.snapshot_fingerprint
    ) {
      setAsked(request)
      setRefreshRequired(true)
      setError(new LiveCaptureChangedError().message)
      return
    }
    const current = ++generation.current,
      controller = new AbortController()
    pending.current?.abort()
    pending.current = controller
    feedbackGeneration.current++
    pendingFeedback.current?.abort()
    setBusy(true)
    setAnswer(undefined)
    setAsked(request)
    setComment('')
    setError('')
    setRefreshRequired(false)
    setNotice('')
    setFeedback('')
    setFeedbackError('')
    setSavingFeedback(false)
    setRating(undefined)
    try {
      const result = await askLiveMatch(request, controller.signal)
      if (current === generation.current && !controller.signal.aborted) setAnswer(result)
    } catch (failure) {
      if (current === generation.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'The current-match question failed.')
        setRefreshRequired(failure instanceof LiveCaptureChangedError)
      }
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  function cancel() {
    generation.current++
    pending.current?.abort()
    setBusy(false)
    setNotice('Cancelled in this browser. The server may finish its bounded request.')
  }
  async function rate(value: -1 | 1) {
    if (!answer || savingFeedback || feedback || publishedLive) return
    const current = ++feedbackGeneration.current,
      controller = new AbortController()
    pendingFeedback.current?.abort()
    pendingFeedback.current = controller
    setSavingFeedback(true)
    setFeedbackError('')
    try {
      await sendLiveFeedback(answer, value, comment, controller.signal)
      if (current === feedbackGeneration.current && !controller.signal.aborted) {
        setFeedback('Feedback saved for this captured provider trace.')
        setRating(value)
      }
    } catch (failure) {
      if (current === feedbackGeneration.current && !controller.signal.aborted)
        setFeedbackError(
          failure instanceof Error ? failure.message : 'Feedback could not be saved.',
        )
    } finally {
      if (current === feedbackGeneration.current) setSavingFeedback(false)
    }
  }
  const differentCapture =
    !!answer?.snapshot_available &&
    !!page?.snapshot_available &&
    answer.snapshot_fingerprint !== page.snapshot_fingerprint
  const needsRefresh =
    refreshRequired &&
    (!page?.snapshot_fingerprint || page.snapshot_fingerprint === asked?.snapshot_fingerprint)

  return (
    <details className="live-chat-panel">
      <summary>
        <MessageSquare size={17} />
        <span>Ask about this match</span>
        <ArrowUpRight size={16} />
      </summary>
      <section className="live-chat-body" aria-label="Ask about this current match">
        <p className="live-chat-context">
          <FileText size={15} />
          <span>
            <b>
              {match.team_a} vs {match.team_b}
            </b>
            <small>{liveProviders[provider].name} · selected provider match only</small>
          </span>
        </p>
        {publishedLive ? (
          <p role="status">
            Current-match AI and feedback require the local backend. No API request is made here.
          </p>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void ask({
                  provider,
                  match_id: match.match_id,
                  question: question.trim(),
                  mode,
                  snapshot_fingerprint: page?.snapshot_fingerprint || undefined,
                })
              }}
            >
              <fieldset className="live-chat-modes" disabled={busy}>
                <legend>Answer mode</legend>
                <label>
                  <input
                    type="radio"
                    name={`live-answer-mode-${provider}-${match.match_id}`}
                    aria-label="Evidence mode"
                    checked={mode === 'evidence'}
                    onChange={() => setMode('evidence')}
                  />
                  <FileText size={14} /> Evidence
                </label>
                <label>
                  <input
                    type="radio"
                    name={`live-answer-mode-${provider}-${match.match_id}`}
                    aria-label="Local AI mode"
                    checked={mode === 'ollama'}
                    onChange={() => setMode('ollama')}
                  />
                  <Bot size={14} /> Local AI
                </label>
              </fieldset>
              <p className="live-chat-help">
                {mode === 'evidence'
                  ? 'A deterministic summary with structured source records. No generative model is called.'
                  : 'Local AI explains the captured records. CPU generation can take several minutes; requests have a 180-second server budget.'}
              </p>
              <div className="live-chat-prompts" aria-label="Current match question suggestions">
                {prompts.map(([label, value]) => (
                  <button
                    type="button"
                    key={label}
                    disabled={busy}
                    onClick={() => {
                      setQuestion(value)
                      questionInput.current?.focus()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="live-chat-input">
                <span>Current match question</span>
                <textarea
                  ref={questionInput}
                  aria-label="Current match question"
                  rows={3}
                  maxLength={2000}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  disabled={busy}
                  required
                />
              </label>
              <div className="live-chat-actions">
                <span>{question.length.toLocaleString('en-GB')} / 2,000</span>
                {busy ? (
                  <button
                    type="button"
                    className="button"
                    onClick={(event) => {
                      event.preventDefault()
                      cancel()
                    }}
                  >
                    <Square size={13} /> Cancel current question
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={!question.trim() || needsRefresh}
                  >
                    <Send size={14} /> Ask current match
                  </button>
                )}
              </div>
            </form>
            {busy && (
              <div className="live-chat-busy" role="status">
                <LoaderCircle size={16} className="spin" />
                <span>
                  {asked?.mode === 'ollama'
                    ? 'Local AI is investigating the captured match…'
                    : 'Reading captured source evidence…'}
                  <small>
                    One provider publication per answer. You can cancel waiting without changing
                    modes.
                  </small>
                </span>
              </div>
            )}
            {notice && (
              <p className="live-chat-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <div className="live-chat-error" role="alert">
                <p>{error}</p>
                <small>
                  {refreshRequired
                    ? 'Refresh this record before asking again.'
                    : 'No alternative model, provider or evidence answer was substituted.'}
                </small>
                {asked && !refreshRequired && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => void ask(asked)}
                    disabled={busy}
                  >
                    <RotateCcw size={14} /> Retry selected mode
                  </button>
                )}
              </div>
            )}
            {answer && (
              <section className="live-chat-answer" aria-label="Current match answer">
                <header>
                  <b>
                    {answer.abstained
                      ? 'Evidence limit'
                      : answer.mode === 'evidence'
                        ? 'Captured source evidence'
                        : 'Local AI interpretation'}
                  </b>
                  <small>{answer.model || 'No model called'}</small>
                </header>
                <p className="live-chat-asked">Question: {asked?.question}</p>
                <div className="live-chat-answer-text">
                  {answer.answer
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                </div>
                <dl className="live-chat-capture">
                  <div>
                    <dt>Captured provider</dt>
                    <dd>{liveProviders[answer.provider].name}</dd>
                  </div>
                  <div>
                    <dt>Captured dataset</dt>
                    <dd>
                      <code>{answer.dataset_version || 'Unavailable'}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Captured observation cutoff</dt>
                    <dd>{stamp(answer.cutoff)}</dd>
                  </div>
                </dl>
                {differentCapture && (
                  <p className="live-chat-notice">
                    This answer's captured publication differs from the current match board.
                  </p>
                )}
                {(answer.stale || answer.serving_last_good) && (
                  <p className="live-chat-notice">
                    The provider capture was stale or serving its last verified publication when
                    this question began.
                  </p>
                )}
                {answer.citations.length > 0 && (
                  <div className="live-chat-citations" aria-label="Current answer citations">
                    {answer.citations.map((citation, index) => (
                      <button
                        key={citation.id}
                        aria-label={`Inspect current source ${citation.source}`}
                        onClick={() => {
                          if (evidence.current) {
                            evidence.current.open = true
                            evidence.current.querySelector('summary')?.focus()
                          }
                        }}
                      >
                        <FileText size={13} /> [{index + 1}] {citation.source}
                      </button>
                    ))}
                  </div>
                )}
                <details className="live-chat-evidence" ref={evidence}>
                  <summary>
                    Inspect current answer evidence <ChevronRight size={14} />
                  </summary>
                  <div className="live-chat-evidence-body">
                    {answer.tool_results.map((tool, index) => (
                      <ToolEvidence key={`${answer.trace_id}-${index}`} tool={tool} />
                    ))}
                    <dl className="live-provenance">
                      <div>
                        <dt>Captured trace</dt>
                        <dd>
                          <code>{answer.trace_id}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Captured fingerprint</dt>
                        <dd>
                          <code>{answer.snapshot_fingerprint || 'No verified publication'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Provider health at capture</dt>
                        <dd>
                          {answer.status.replaceAll('_', ' ')} · successful poll{' '}
                          {stamp(answer.last_success_at)}
                        </dd>
                      </div>
                      <div>
                        <dt>Answer configuration</dt>
                        <dd>
                          {answer.prompt_version} · {answer.mode} · {answer.metrics.tool_calls} tool
                          calls · {answer.metrics.latency_seconds.toFixed(1)}s
                        </dd>
                      </div>
                      <div>
                        <dt>Model digest</dt>
                        <dd>
                          <code>{answer.model_digest || 'No model digest returned'}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Reference validation</dt>
                        <dd>{answer.grounding}</dd>
                      </div>
                      {answer.citations.map((citation) => (
                        <div key={citation.id}>
                          <dt>{citation.source}</dt>
                          <dd>
                            <code>{citation.uri}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </details>
                <div className="live-chat-feedback">
                  <label>
                    <span>Current answer feedback comment (optional)</span>
                    <input
                      aria-label="Current answer feedback comment"
                      maxLength={1000}
                      value={comment}
                      disabled={savingFeedback || !!feedback}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </label>
                  <div>
                    <span>Useful evidence?</span>
                    <button
                      aria-label="Helpful current answer"
                      aria-pressed={rating === 1}
                      disabled={savingFeedback || !!feedback}
                      onClick={() => void rate(1)}
                    >
                      <ThumbsUp size={14} /> Helpful
                    </button>
                    <button
                      aria-label="Unhelpful current answer"
                      aria-pressed={rating === -1}
                      disabled={savingFeedback || !!feedback}
                      onClick={() => void rate(-1)}
                    >
                      <ThumbsDown size={14} /> Unhelpful
                    </button>
                  </div>
                  {feedback && (
                    <p role="status">
                      <Check size={14} /> {feedback}
                    </p>
                  )}
                  {feedbackError && <p role="alert">{feedbackError}</p>}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </details>
  )
}
