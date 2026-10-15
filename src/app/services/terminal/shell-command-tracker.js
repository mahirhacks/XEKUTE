"use strict";
const crypto = require("node:crypto");
const path = require("node:path");

function createShellCommandTracker(shellPath, args = []) {
  const shell = path.basename(shellPath).replace(/\.exe$/i, "").toLowerCase();
  if (shell !== "powershell" && shell !== "pwsh") {
    return { args, output: (_record, data) => data, flush: () => "" };
  }
  const nonce = crypto.randomBytes(24).toString("hex");
  const prefix = `\u001b]633;Xekute;${nonce};`;
  const script = [
    'if ($ExecutionContext.SessionState.LanguageMode -eq "FullLanguage") {',
    'Import-Module PSReadLine -ErrorAction SilentlyContinue',
    `$global:__XekuteSignalPrefix = [string][char]27 + ']633;Xekute;${nonce};'`,
    '$global:__XekuteCommandNumber = 0',
    '$global:__XekuteOriginalPrompt = $function:prompt',
    'function global:prompt {',
    '  $failed = -not $global:?',
    "  [Console]::Write($global:__XekuteSignalPrefix + 'end' + [char]7)",
    '  if ($failed) { Write-Error "Previous command failed" -ErrorAction Ignore }',
    '  $global:__XekuteOriginalPrompt.Invoke()',
    '}',
    'if (Get-Module PSReadLine) {',
    '  $global:__XekuteOriginalReadLine = $function:PSConsoleHostReadLine',
    '  function global:PSConsoleHostReadLine {',
    '    $line = $global:__XekuteOriginalReadLine.Invoke()',
    '    if (-not [string]::IsNullOrWhiteSpace($line)) {',
    '      $global:__XekuteCommandNumber++',
    '      $info = @{ id = $global:__XekuteCommandNumber; command = [string]$line; cwd = $pwd.ProviderPath } | ConvertTo-Json -Compress',
    "      [Console]::Write($global:__XekuteSignalPrefix + 'start;' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($info)) + [char]7)",
    '    }',
    '    $line',
    '  }',
    '}',
    '}',
  ].join("\n");
  let pending = "";
  function output(record, data) {
    pending += data;
    let visible = "";
    while (pending) {
      const escape = pending.indexOf("\u001b");
      if (escape < 0) { visible += pending; pending = ""; break; }
      visible += pending.slice(0, escape);
      pending = pending.slice(escape);
      if (prefix.startsWith(pending)) {
        break;
      } else if (pending.startsWith(prefix)) {
        const ending = /\u0007|\u001b\\/.exec(pending.slice(prefix.length));
        if (!ending && pending.length <= 1048576) break;
        if (ending) {
          const body = pending.slice(prefix.length, prefix.length + ending.index);
          const position = (record.outputLength || 0) + visible.length;
          if (body === "end") {
            record.commandRunning = false;
            if (record.commands?.at(-1)?.outputEnd == null && record.commands?.length) record.commands.at(-1).outputEnd = position;
          } else if (body.startsWith("start;")) {
            try {
              const info = JSON.parse(Buffer.from(body.slice(6), "base64").toString("utf8"));
              if (typeof info.command === "string" && Number.isInteger(info.id)) {
                record.commandRunning = true;
                record.commands ||= [];
                record.commands.push({ id: `user:${nonce}:${info.id}`, command: info.command, cwd: info.cwd || record.cwd,
                  createdAt: new Date().toISOString(), outputStart: position });
              }
            } catch { /* An incomplete shell signal must not invent a command. */ }
          }
          pending = pending.slice(prefix.length + ending.index + ending[0].length);
          continue;
        }
        visible += pending[0];
        pending = pending.slice(1);
      } else {
        visible += pending[0];
        pending = pending.slice(1);
      }
    }
    return visible;
  }
  return {
    args: [...args, "-NoExit", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    output,
    flush(record) { record.commandRunning = false; const tail = pending; pending = ""; return tail; },
  };
}
module.exports = { createShellCommandTracker };
