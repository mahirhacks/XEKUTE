1. The agent should wait for the command to finish first instead of running a command and keep on moving on.
2. when the agent is stopped, the command/process ran by that agent needs to be stopped as well.
3. the context usage pop up isn't properly displaying the token distribution among memories and all, when the agent stops the context usage pop up resets for some reason, it should measure the memory according to the agent properly.
4. Also I think we added unnecessary things in the memory. It should never be this complex. We could just store project memory, Investigation memory, Evidence memory locally in the project directory as json file, the context window should only save and show:
System prompt
Tool definitions
Rules
Skills
MCP & Dynamic tools
Subagent definitions
Summarized Conversation
Conversation