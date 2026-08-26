import { useState } from 'preact/hooks';
import type { MessageState } from '../messageState';

interface MessageHarnessProps {
  /** The current game as a message payload URL, or null when no game is live. */
  buildOutgoing: () => string | null;
  onReceive: (url: string) => void;
  error: string | null;
  /** Current presentation style. In a browser nothing else can change it. */
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * A stand-in for a conversation, for development only.
 *
 * The extension's state travels as a URL query parameter (APP-MIGRATION.md
 * §6.3), which means two browser windows can play the two participants: stage
 * a payload in one, paste it into the other. That covers every part of the
 * flow the JS owns -- the pool handoff, the reveal gate, version refusal --
 * leaving only MSMessage itself, presentation styles and memory for a device.
 *
 * Never shipped: the only call site is compile-time gated on
 * `capabilities.messaging && import.meta.env.DEV`.
 */
export function MessageHarness({
  buildOutgoing,
  onReceive,
  error,
  expanded,
  onToggleExpanded,
}: MessageHarnessProps) {
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const stage = () => {
    setCopied(false);
    setOutgoing(buildOutgoing());
  };

  const copy = () => {
    if (!outgoing) return;
    // Not available on an insecure origin, which a LAN dev server is: fall back
    // to leaving the text selected so it can be copied by hand.
    if (navigator.clipboard) {
      navigator.clipboard.writeText(outgoing).then(
        () => setCopied(true),
        () => setCopied(false)
      );
    }
  };

  return (
    <aside class={`message-harness${open ? ' message-harness--open' : ''}`}>
      <button type="button" class="message-harness__toggle" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Conversation stand-in'}
      </button>
      {open && (
        <div class="message-harness__body">
          <p class="message-harness__note">
            Development only. Stage the current game, paste the URL into the other window.
          </p>
          <div class="message-harness__row">
            <button type="button" onClick={onToggleExpanded}>
              {expanded ? 'Show compact' : 'Show expanded'}
            </button>
          </div>
          <div class="message-harness__row">
            <button type="button" onClick={stage}>
              Stage message
            </button>
            {outgoing && (
              <button type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {outgoing === null && <p class="message-harness__note">No game in progress to stage.</p>}
          {outgoing && (
            <textarea
              class="message-harness__payload"
              readOnly
              rows={3}
              value={outgoing}
              onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()}
            />
          )}
          <div class="message-harness__row">
            <input
              class="message-harness__input"
              placeholder="Paste a staged URL"
              value={pasted}
              onInput={(event) => setPasted((event.currentTarget as HTMLInputElement).value)}
            />
            <button
              type="button"
              onClick={() => {
                if (pasted.trim()) onReceive(pasted.trim());
              }}
            >
              Receive
            </button>
          </div>
          {error && <p class="message-harness__error">{error}</p>}
        </div>
      )}
    </aside>
  );
}

export type { MessageState };
