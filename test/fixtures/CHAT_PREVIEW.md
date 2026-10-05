# Chat preview

Run `npm run dev:ui`, then open
`http://127.0.0.1:5173/@fs/G:/Xekute/test/fixtures/chat-preview.html`.
For another checkout, replace `G:/Xekute` with its absolute path.

This fixture uses the real application shell, styles, Markdown renderer,
work-fold controls, and scroll controller. Responses run locally without
calling a model or changing saved chats.

- Stream a long answer and scroll upward. The reading position should stay
  fixed while the response continues and when it finishes.
- Scroll back down to the latest messages. Following should resume at the bottom.
- Open the work summary or command output while streaming. Following should
  pause so the output can be inspected.
- Switch to the narrow panel. Long tool names should truncate and the
  transcript should have no horizontal overflow.
- Stop a response. Its last text should remain visible.

The focused behavior checks run with:

```powershell
node --test test/markdown-streaming.test.js test/chat-scroll.test.js test/chat-fold-preference.test.js test/chat-work-fold.test.js
```
