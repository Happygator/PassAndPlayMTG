# iOS extension source (DRAFT — never compiled)

Swift for the Messages extension target, written ahead of the Mac so that M8 starts from
review-and-fix rather than from a blank file.

**Status: authored on Windows, never compiled, never run.** There is no Swift toolchain on
the machine that wrote these. Treat every line as a proposal. Expect to fix API details,
optionals and access control at first build; the shapes and the sequencing are the part
worth keeping.

## What goes where

| File | Target |
|---|---|
| `MessagesViewController.swift` | Messages extension |
| `AppSchemeHandler.swift` | Messages extension |

Neither belongs to the container app.

## Adding them on the Mac

1. `npx cap add ios` first — that generates `web/ios/` for the container app.
2. In Xcode: File > New > Target > iMessage Extension. Set its bundle identifier to
   `com.happygator.passandplay.MessagesExtension` (it MUST be a child of the container app's
   id — see APP-MIGRATION.md section 6.1).
3. Enable the App Group `group.com.happygator.passandplay` on BOTH targets.
4. Delete the stub `MessagesViewController.swift` Xcode generates and add these two files.
5. Copy `web/dist-imsg/` into the extension target's bundle as a folder reference (blue, not
   yellow) named `web`, so the directory structure survives into the built product.

## The one non-obvious decision

The bundle is served through a **custom URL scheme**, not `file://`. This is not a
preference. Under `file://` every `fetch('./cubes/index.json')` fails, because a file origin
is opaque to `fetch` — which is most of the app — and the built `index.html` references
`/assets/`, `/fonts/` and `/icons/` absolutely, so they resolve against the filesystem root
and 404. A custom scheme gives the WebView a real origin and both problems disappear.
See APP-MIGRATION.md section 6.5.

## What is deliberately NOT here

The game flow: which seat the local participant occupies, and how the vote sequence reads
when a message arrives mid-build. Those depend on the real `MSConversation` lifecycle and
were left for the Mac rather than guessed at. The Swift here is transport only — it moves a
payload in and out of the WebView and knows nothing about Magic.
