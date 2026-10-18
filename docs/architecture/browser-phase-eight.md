# Browser phase 8

Agent browser actions now follow the project scope and the selected authority
mode. Scope applies to the agent only. A person browsing in an assessment tab
is never blocked.

## One decision per action

`src/agent/authority/scope/browser-scope.js` decides every agent
`browser_action` before it runs. It judges the address the action touches.
For `navigate` and `open_page` that is the destination. For every other
action it is the tab's live address, or the frame address when an element
reference sits inside an HTTP frame. The model's claim about the page is
never used.

The address gets one standing:

| Standing | Meaning |
|---|---|
| `in_scope` | Listed in scope, including http/https, `www.` and default-port variants of a listed target. |
| `restricted` | Shares a registrable domain with an in-scope target (for example `admin.example.com` beside `app.example.com`), or matches a reviewed authentication dependency. |
| `off_scope` | Anything else that is not excluded or private. |
| `denied` | An out-of-scope rule, a local or private address outside scope, or a non-HTTP address. |
| `unconfigured` | The project has no scope. |
| `public` | A research tab on the public web. |

The action gets one class:

| Class | Actions |
|---|---|
| `read` | `observe`, `screenshot`, `scroll`, `hover`, `move`, `wait`, `extract`, `list_pages`, `close_page` |
| `interact` | `click`, `double_click`, `drag`, `select`, `press_key`, history and dialogs, same-origin navigation |
| `sensitive` | `type`, `insert_text`, `upload`, `download`, Enter, a click on a form submit control, navigation to a new origin |

The decision:

- `denied` and `unconfigured` are denied. A deliberate navigation to an
  `off_scope` destination is denied.
- A tab that drifted to an `off_scope` page asks for approval before any
  action. A `restricted` page allows reading and asks before interaction.
  These scope exceptions ask in every authority mode, Full Authority included.
- An approved exception is granted for that tab, its ownership generation,
  and that origin. A takeover bumps the generation and revokes the grant.
- `sensitive` actions ask under Ask for Approval only.
- Navigation destinations are resolved before dispatch. Private or reserved
  addresses are denied unless the scope lists that literal address.

Redirects land without a hop limit. The agent never acts on a page it did not
approve, so the next action on an off-scope landing page asks. Each successful
action reports a `scope` note when the page it left is no longer in scope.

## Pipeline wiring

`main.js` resolves the tab only when the current chat owns it, describes an
element reference from the latest observation, and passes the decision to the
authority pipeline as `runtime.browserPolicy`. The scope gate returns it, the
authority policy gate turns `require_approval` into an approval request, and
the approval gate runs for Full Authority only when a browser scope exception
asks. Browser approvals reuse the command approval card with a browser title.

The provider receives the tab's generation and address as checked. If a
takeover or navigation happened while approval was pending, it fails with
`BROWSER_SCOPE_CHANGED` and runs nothing.

Observations mark form submit controls with `submits: true`.

## Network layer

The native browser service sends page and frame loads from agent-owned tabs
to a request policy in the container. Excluded and private targets never load
in assessment tabs. Research tabs never load a local address or a host that
resolves into a private network. Other resources load normally. Capture is
unchanged and follows the Interceptor "Only in-scope" setting.

## Empty scope

A `SCOPE_NOT_CONFIGURED` browser result adds a muted notice to the chat turn
with a button that opens Settings › Project.

## Removed

The pageId-keyed URL memory in `main.js` and the after-the-fact scope check
on observed URLs are gone. The live tab address replaces both.

## Verification and limits

`test/browser-scope.test.js` covers the decision table and a full authority
pipeline run. `npm run verify:browser-agent` and
`npm run verify:browser-workspace` pass against real Electron.

Known limits:

- Selector and screenshot-point clicks are classed `interact`. Only element
  references can identify a submit control.
- An assessment redirect to a hostname that resolves privately is fetched by
  the capture proxy without a DNS check. Agent navigations are checked.
- A popup's first request can precede its ownership adoption. Its next agent
  action is still gated.
