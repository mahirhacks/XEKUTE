# Chat feature

Chat turn composition, prompt submission, streaming output, and conversation
rendering belong here. The current composition root still coordinates the
legacy DOM lifecycle while the feature boundary is extracted incrementally.

The `@` picker includes files and saved chats in the current project, excluding
the current chat. A chat reference copies only Summarized Conversation, Active
Conversation, and Current Workflow. The copy is captured at admission and
prepared at the destination's next model boundary. If it exceeds the remaining
context, the destination compacts first. An incoming copy larger than half the
destination window is summarized before delivery; multiple copies also share
the available space according to their actual sizes. Small copies remain exact
while the largest copies are reduced as needed. Preparing a copy does not
modify its source chat. The prepared bundle enters Active Conversation; it does
not replace the destination's summary or workflow.

Captured copies are immutable encrypted snapshots scoped to the project. Queued
prompts hold snapshot IDs, so large sources reach bounded summarization without
passing their raw contents through the input journal. A retry loads the same
capture even after its source changes or is deleted. Snapshot identities and
import provenance suppress repeated and transitive copies while retaining new
conversation. Provenance remains backend metadata, outside the model's three
imported sections. Project reset removes the saved snapshots.

Import preparation displays `Bringing chats to this session...` as a single
expandable row with one source chat name per line. It uses Planning's animated
text style and hides internal summarization output. Completion changes that
same row to `Brought chats`, retaining its names, expansion state, and position
in the conversation. Ordinary compaction displays `Chat context being
summarized...` with the same animation, then retains `Chat context summarized`.

The composer model button opens Context, Effort, and the selected model. Context
and Effort each open a separate submenu for the selected model's settings. The
model row opens the existing searchable list of enabled models and Add Models.
Selections remain scoped to the model and provider. Escape closes a submenu
before closing the first menu; clicking outside dismisses the whole picker.

Typing `$` opens project command history, including commands from other chats.
Each row shows the user or agent icon followed by
`powershell : <first 10 characters of the command's first line>...`.
Other shells use their own names. Search matches the full command.
Ellipses appear only when the first line exceeds ten characters. Background
status refreshes preserve scroll position; searching or keyboard navigation
reveals the selected row.
Selecting a row inserts an atomic terminal chip. Ordinary shell variables
remain text unless a picker item is selected.
PowerShell command detection marks user terminals busy only between command
execution and the next prompt. An open, idle shell has no spinner. Shells
without command detection leave the running indicator off.

The picker projects existing saved chat commands, transcript command events,
durable execution records and live terminal buffers. It has no separate command
catalog or log storage. Saved project commands appear after restart, including
closed and archived chats. Live status polling reads execution metadata without
reloading saved chat histories every second. User commands in open project
terminals have individual identities and output ranges in the existing buffer.
Unassociated global PowerShell history is excluded. Earlier user commands
that were never saved with a project cannot be recovered as project history.

At prompt admission, terminal chips capture immutable output snapshots in the
same encrypted store used by chat references. Recent output is stripped of ANSI
codes and bounded to 8K estimated tokens. Missing or trimmed original output is
reported in the snapshot. Multiple references share the destination context
budget and can trigger compaction or summary of the imported copy. Tagging
grants no process control and adds no import status row. Already admitted
snapshots survive source changes, deletion and application restarts.
