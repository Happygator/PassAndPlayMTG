import type { FunctionComponent } from 'preact';

interface WaitingScreenProps {
  /** The player this device is waiting on. */
  opponentName: string;
  /** True once the payload has been handed to the host to stage. */
  staged: boolean;
}

/**
 * The extension's replacement for the handoff screen (APP-MIGRATION.md §5).
 *
 * Pass-and-play hands one device between two people, so it needs a screen that
 * hides the pool while the device changes hands. A conversation does not: each
 * player has their own phone, and the wait is for a message rather than for a
 * person standing next to you. So this screen says who we are waiting on and
 * nothing else -- there is deliberately no reveal control, because there is
 * nothing here to reveal.
 */
export const WaitingScreen: FunctionComponent<WaitingScreenProps> = ({
  opponentName,
  staged,
}) => (
  <main class="screen centered-screen waiting-screen">
    <div>
      <p class="kicker">Waiting for</p>
      <h1>{opponentName}</h1>
    </div>
    <p class="waiting-screen__note">
      {staged
        ? 'Sent. They build on their own device, and this game updates when they reply.'
        : 'Send the message in the conversation to pass the turn.'}
    </p>
  </main>
);
