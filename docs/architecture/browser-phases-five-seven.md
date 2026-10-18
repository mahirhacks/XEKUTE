# Browser phases 5, 6, and 7

The normal `browser_action` tool now controls the native Browser workspace.
Its actions run through the existing agent loop, tool activity stream,
steering intake, and stop signal. The old browser session manager remains
available for the separate identity login flow.

## Native browser actions

`native-browser-provider.js` binds each action to the current project and
the stable chat ID in `browserSessionId`. The runtime invocation ID does not
identify the browser owner. A manually opened tab requires handoff from the
workspace. An agent-created tab belongs to that chat immediately.

The provider supports these actions:

- `open_page`, `list_pages`, and `close_page`.
- `observe`, `extract`, and `screenshot`.
- `navigate`, `back`, `forward`, and `reload`.
- `click`, `double_click`, `move`, `hover`, `type`, and `select`.
- `insert_text`, `press_key`, `scroll`, `drag`, and `wait`.
- `handle_dialog`, `upload`, and `download`.

Targets use an observation reference, a selector, or a screenshot point.
The provider accepts the previous `pageId` and selector spellings where
their meaning remains compatible. `list_pages` exposes the native tab
registry rather than a separate headless browser.

`browser-observation.js` collects visible controls, accessible names, frame
identifiers, and page text. Model-facing observations have a 16,000-character
serialized limit, at most 80 controls, and at most 30 frames. Larger collected
observations become encrypted artifacts. Password input values are excluded
from observations and password-value extraction.

References resolve to the original DOM node. Navigation, a different
observation, a removed node, or a replaced node invalidates the reference.
A stale reference produces `BROWSER_OBSERVATION_STALE` and a fresh observation
where available. The provider does not guess a replacement node or replay
the failed action.

Actions retain per-tab serialization and control-generation checks from
phases 3 and 4. Stopping the agent cancels native work. Takeover revokes
queued work and returns ownership after the current operation settles.

`native-browser-dialogs.js` restores synchronous Chromium prompts through an
isolated world. The bridge carries prompt strings through a temporary hidden
DOM element only when a page calls `prompt()`. It exposes no application IPC
or preload. Navigation installs the adapter before page scripts, and a page's
custom prompt function remains intact. The existing per-tab native dialog
callback supplies the agent's response or dismisses the dialog on takeover.
That callback uses Electron's internal `-run-dialog` event, so Electron upgrades
must pass the real dialog verifier before release.

Uploads resolve real paths within the active project workspace, including
symlink resolution. Downloads use temporary files and become project-bound
encrypted artifacts after completion. Each artifact is limited to 12 MiB.
Download status exposes its artifact ID rather than its temporary path.

## Screenshot requests through OpenRouter

`native-browser-visual.js` captures the native viewport and hides the agent
pointer during capture. Images have a maximum edge of 1,600 pixels. Screenshot
metadata records the document, viewport, scroll position, zoom, device scale,
and image dimensions.

`browser-artifact-store.js` stores encrypted screenshot bytes separately from
conversation history. History contains screenshot metadata and an artifact
ID. The store checks the project on both write and read.

`browser-images.js` reads the latest two referenced screenshots during
OpenRouter request assembly. It creates private base64 `image_url` parts
after the complete tool-result batch. Tool-call IDs and result order remain
intact. The same preparation applies to streaming and completion requests.
Older screenshots remain text metadata in their original tool results.

The normalizer preserves supported text and image parts and rejects
unsupported content parts. Missing artifacts, project mismatches, and saved
metadata mismatches produce explicit errors. Retries read the durable
artifacts again without changing the saved conversation.

The selected model must advertise both image input and tools. Unknown
metadata triggers a refresh. Unsupported or unverified models cannot capture
a new screenshot. The application does not switch models. Ollama retains
text-only browsing.

After a model consumes a screenshot, selecting a known text-only OpenRouter
model leaves that screenshot as historical metadata. The application does
not read those historical image artifacts for the text-only request. Fresh
screenshots still require verified image capability.

Retained tool messages preserve consumed artifact identities in the internal
`browserImagesConsumed` field. This state survives checkpoints and reopening,
so removing the following assistant reply cannot make an old image look fresh.
OpenRouter normalization removes the internal field from outgoing messages.
Fresh screenshot references still require image support.

Image costs have a separate conservative estimate based on dimensions.
The controller includes those costs in prompt fitting, checkpoint pressure,
and the Active Conversation usage row. Base64 is never counted as ordinary
conversation text. Checkpoints retain complete exchanges containing the
latest screenshots when those images remain part of the request.

The wire format follows [OpenRouter image input documentation](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding).

## Browser pointer and hybrid control

The browser pointer runs in an isolated JavaScript world without an
application preload. A closed shadow root isolates its appearance from page
CSS. Its overlay does not intercept input. The pointer follows browser CDP
input and remains independent of the Windows cursor and the chat composer.
Takeover hides the agent pointer.

The agent instructions prefer page structure and observation references.
Screenshot coordinates support canvas content and controls that structure
cannot identify. The next action returns a structural observation so the
agent can return to references when possible.

Coordinate targets refer to a specific screenshot. The visual provider maps
image pixels into viewport CSS pixels. It rejects points outside the image
and screenshots invalidated by document changes, viewport changes, DOM
mutation, scrolling, or zoom. A stale screenshot requires another capture.

When control ends mid-drag, the operation's buttons stay pressed on the page
until the new owner would otherwise inherit a stuck button. The transport
records which buttons were down when it closed, and the service lifts them on a
clean debugger after the transport and Playwright have detached, so the release
never races their teardown. The interrupted drag reports failure and is not
replayed; resume performs the drag once.

A tab opened in the background takes the most recent workspace viewport size,
so the agent can act in it before it is ever shown.

## Verification and remaining limits

`test/browser-images.test.js` covers serialized requests, actual HTTP fetch,
parallel tool-result pairing, image retention, retries, reopened history,
capability refresh, text-only model changes, project checks, and missing
artifacts. Its controller integration test triggers a real Tier 1 checkpoint
and verifies that the next model round retains its screenshot exchange.

`scripts/browser-dev/verify-agent.cjs` drives the model-facing tool against
real Electron native tabs. Its fixtures cover structural forms, screenshot
coordinates, zoom, pointer state, uploads, downloads, and agent-loop steering
and stop behavior. `scripts/browser-dev/verify-observe.cjs` adds what the model
observes: row context on repeated labels, excluded hidden and undisplayed
controls, single-page re-render staleness, cross-origin and nested frame
references, explicit truncation with an artifact, cross-tab reference refusal,
independent tab progress, and research tabs never carrying assessment
identities. `scripts/browser-dev/verify-hybrid.cjs` runs one agent that moves
from structure to a screenshot-bound canvas click and back, with steering sent
during the visual action, and a human taking over mid-drag who leaves no stuck
button and whose resume drops exactly once. These fixtures use deterministic
model responses and do not measure a provider model's ability to understand
screenshots. `npm run verify:browser-agent` runs all three.

The same command also runs `verify-dialog.cjs`, including prompt responses,
navigation-time prompts, custom page prompts, takeover, and cancellation.
The workspace verifier uses an ephemeral proxy port. A real listener bind
failure returns `PROXY_START_FAILED` and permits retry instead of leaving
Browser stuck opening.

On October 15, 2026, a read-only check of the configured model,
`deepseek/deepseek-v4-flash-0731`, returned `input_modalities: ["text"]`
from OpenRouter's live model catalog. Tool support was available. Live image
recognition was therefore not tested with that selected model. The HTTP
fixture verifies transport bytes, not visual understanding.

Scope-policy enforcement, authority gates, and broader resource policies
remain in the later planned phases. This work preserves native isolation,
project binding, ownership checks, and cancellation. It does not claim those
later policy phases are complete.
