const ToolMap = require("./tool-catalog");
const SecurityToolAdapters = require("../cyber/security-tool-adapters");
const CyberTools = require("../cyber/tool-registry");
const ScopeEngine = require("../../../domain/assessment/scope-engine");
const OperatorQuestions = require("../../../application/clarification/operator-questions");
const { classifyErrorCode } = require("./error-class");
const PROTECTED_ASSESSMENT_PATH_RE = /^(?:scope|recon|enumeration|traffic|vulnerability-scans|findings|penetration-testing|evidence|runs|logs|map|report|\.xekute\/logs|\.xekute\/questions)(?:\/|$)|^settings\.config$/i;
const PROTECTED_ASSESSMENT_COMMAND_RE = /(?:^|[\s"'`])(?:\.\/?|\.\\)?(?:scope|recon|enumeration|traffic|vulnerability-scans|findings|penetration-testing|evidence|runs|logs|map|report|\.xekute\/logs|\.xekute\/questions)[\\/]|settings\.config/i;
const COMMAND_CHAIN_RE = /&&|\|\||[;\r\n]|(?:^|\s)\|(?:\s|$)/;

function workspaceRoot(workspace) {
  if (typeof workspace === "string") return workspace;
  return workspace?.detectedRootId || workspace?.path || workspace?.root || "";
}

function createToolHandlers(deps) {
  const {
    fs,
    path,
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    buildWorkspaceIndex,
    searchWorkspaceIndex,
    findWorkspaceFiles,
    runWorkspaceCommand,
    runWorkspaceProcessArgs,
    startWorkspaceProcess,
    readToolProcess,
    stopToolProcess,
    listProjectFiles,
    searchWeb,
    fetchWebPage,
    assessmentMap,
    assessmentWorkspace,
    crypto,
    verifyFindingCandidate,
    ingestAssessmentRecords,
    listDatasets,
    writeGuidanceFile,
    globalGuidanceRoot,
    subagentRunner,
    openRouterApiKey: getOpenRouterApiKey = null,
  } = deps;

  function resolveWaitMs(args, fallback = 60000) {
    if (Object.prototype.hasOwnProperty.call(args || {}, "wait_ms") || Object.prototype.hasOwnProperty.call(args || {}, "waitMs")) {
      return ToolMap.clampWaitMs(args.wait_ms ?? args.waitMs, fallback);
    }
    if (args?.timeout_ms != null || args?.timeoutMs != null) {
      return ToolMap.clampWaitMs(args.timeout_ms ?? args.timeoutMs, fallback);
    }
    return fallback;
  }

  function registerTerminalWait({ processId, terminalId, toolName, command, waitMs, killOnTimeout = false, ownerId = "agent", checkpointIntervalMs = 0 }) {
    if (!subagentRunner || typeof subagentRunner.registerWait !== "function") {
      return { error: "Background wait runner is unavailable.", code: "WAIT_RUNNER_UNAVAILABLE" };
    }
    return subagentRunner.registerWait({
      kind: "terminal",
      processId,
      terminalId,
      toolName,
      command,
      waitMs,
      killOnTimeout,
      ownerId,
      checkpointIntervalMs,
    });
  }

  function ok(toolName, mode, fields = {}) {
    return normalizeResult({ ok: true, toolName, mode, ...fields });
  }

  function fail(toolName, error, fields = {}, errorCode = "TOOL_ERROR", retryable = false) {
    return normalizeResult({ ok: false, toolName, error, errorCode, retryable, ...fields });
  }

  function requireWorkspace(workspace, toolName) {
    if (!workspace) return fail(toolName, "No workspace open");
    return null;
  }

  function rejectProtectedMutation(toolName, file) {
    const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!PROTECTED_ASSESSMENT_PATH_RE.test(normalized)) return null;
    return fail(
      toolName,
      `Core assessment resource '${normalized}' is schema-managed. Submit structured records through ingest_assessment_records instead of editing the file.`,
      { file: normalized },
      "TYPED_ASSESSMENT_MUTATION_REQUIRED",
      false,
    );
  }

  function mapResult(workspace, toolName, mode, operation) {
    if (!workspace) return requireWorkspace(workspace, toolName);
    if (!assessmentMap || typeof operation !== "function") return fail(toolName, "Application Map tools are unavailable", {}, "MAP_UNAVAILABLE", false);
    const result = operation(workspace);
    if (result?.error) return fail(toolName, result.error, result, result.code || "MAP_QUERY_FAILED", false);
    const { ok: _ok, ...fields } = result || {};
    return ok(toolName, mode, { ...fields, content: JSON.stringify(fields, null, 2) });
  }

  function readFile(workspace, file) {
    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;
    if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };
    const stat = fs.statSync(resolved.target);
    if (!stat.isFile()) return { error: `Not a file: ${file}` };
    return {
      file,
      path: resolved.target,
      content: fs.readFileSync(resolved.target, "utf8"),
    };
  }

  const adapterQueues = new Map();
  const adapterLastStart = new Map();
  async function withTargetExecutionLease(hostname, rateLimit, operation) {
    const key = String(hostname || "").toLowerCase();
    const previous = adapterQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    adapterQueues.set(key, queued);
    await previous;
    try {
      const interval = Math.ceil(1000 / Math.max(1, Number(rateLimit) || 1));
      const remaining = interval - (Date.now() - (adapterLastStart.get(key) || 0));
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      adapterLastStart.set(key, Date.now());
      return await operation();
    } finally {
      release();
      if (adapterQueues.get(key) === queued) adapterQueues.delete(key);
    }
  }

  const TOOL_HANDLERS = {
    async ingest_assessment_records({ workspace, args }) {
      const missing = requireWorkspace(workspace, "ingest_assessment_records");
      if (missing) return missing;
      if (typeof ingestAssessmentRecords !== "function") {
        return fail("ingest_assessment_records", "The schema-managed Python ingestion service is unavailable.", {}, "INGEST_UNAVAILABLE", false);
      }
      const root = workspaceRoot(workspace);
      const result = await ingestAssessmentRecords({
        workspace: root,
        resource: args.resource,
        records: args.records,
        source: args.source || "agent-structured-output",
      });
      if (!result?.ok) return fail("ingest_assessment_records", result?.error || "Assessment ingestion failed", result || {}, result?.code || "INGEST_FAILED", false);
      let evidenceId = "";
      if (result.accepted > 0 && assessmentWorkspace?.appendEvidenceRecord) {
        const evidence = assessmentWorkspace.appendEvidenceRecord(root, {
          type: "dataset-ingest-batch",
          title: `Ingested ${result.accepted} ${result.resource} record(s)`,
          source: args.source || "ingest_assessment_records",
          capturedBy: "ingest_assessment_records",
          content: JSON.stringify({
            resource: result.resource,
            accepted: result.accepted,
            rejected: result.rejected,
            scopeRejected: result.scopeRejected,
            path: result.path,
            coverageDelta: result.coverageDelta,
          }),
          notes: `total: ${result.total}`,
        });
        evidenceId = evidence?.record?.id || "";
      }
      return ok("ingest_assessment_records", "typed_ingest", {
        ...result,
        evidenceId,
        mutated: result.accepted > 0,
        summary: `Validated ${result.accepted} ${result.resource} record${result.accepted === 1 ? "" : "s"}; ${result.total} total.`,
        content: JSON.stringify(result, null, 2),
      });
    },

    async list_datasets({ workspace }) {
      const missing = requireWorkspace(workspace, "list_datasets");
      if (missing) return missing;
      if (typeof listDatasets !== "function") {
        return fail("list_datasets", "The dataset registry is unavailable.", {}, "DATASET_REGISTRY_UNAVAILABLE", false);
      }
      const result = listDatasets(workspaceRoot(workspace));
      if (result?.error) return fail("list_datasets", result.error, result, result.code || "DATASET_LIST_FAILED", false);
      return ok("list_datasets", "dataset_list", {
        datasets: result.datasets,
        provisioned: result.provisioned,
        unprovisioned: result.unprovisioned,
        coverage: result.coverage,
        manifestVersion: result.manifestVersion,
        content: JSON.stringify(result, null, 2),
      });
    },

    async run_security_tool({ workspace, args, terminalHost }) {
      const missing = requireWorkspace(workspace, "run_security_tool");
      if (missing) return missing;
      const hypothesisFile = path.join(workspace, ".xekute", "logs", "agent-hypotheses.jsonl");
      let hypothesis = null;
      try {
        if (fs.existsSync(hypothesisFile)) {
          for (const line of fs.readFileSync(hypothesisFile, "utf8").split(/\r?\n/)) {
            if (!line.trim()) continue;
            try { const record = JSON.parse(line); if (String(record.id) === String(args.hypothesis_id)) hypothesis = record; } catch { /* tolerate a truncated tail */ }
          }
        }
      } catch { /* handled as an unresolved hypothesis below */ }
      if (!hypothesis || hypothesis.status !== "ready") {
        // The caller supplied an explicit, in-scope request (target + hypothesis
        // fields) but no ready hypothesis record exists. Mirror the operator
        // slash-command path and record a ready hypothesis from the call itself,
        // so "run <tool> against <target>" works without a separate round trip.
        // The ready-hypothesis gate still applies: a scan never runs without a
        // ready hypothesis record on disk.
        const question = String(args.hypothesis_id || "Verify the security hypothesis for this target").slice(0, 1200);
        const id = String(args.hypothesis_id || `hyp-${Date.now()}`).slice(0, 120);
        const entry = {
          id,
          title: String(args.adapter_id ? `${args.adapter_id} scan of ${args.target || "target"}` : "Security hypothesis").slice(0, 240),
          question,
          target: String(args.target || "").slice(0, 500),
          expectedSignal: String(args.expected_signal || "Tool output matching the stated hypothesis").slice(0, 1200),
          rejectingSignal: "Tool output that contradicts the stated hypothesis",
          proposedTechnique: String(args.adapter_id || "").slice(0, 300),
          evidencePlan: Array.isArray(args.evidence_plan) ? args.evidence_plan.map((value) => String(value).slice(0, 500)).slice(0, 20) : [],
          stopConditions: ["Out-of-scope resolution or redirect", "Unexpected impact", "Policy revocation"],
          evidenceIds: [],
          status: "ready",
          source: "agent-run-security-tool",
          recordedAt: new Date().toISOString(),
        };
        try {
          fs.mkdirSync(path.dirname(hypothesisFile), { recursive: true });
          fs.appendFileSync(hypothesisFile, `${JSON.stringify(entry)}\n`, "utf8");
          hypothesis = entry;
        } catch (error) {
          return fail("run_security_tool", `Unable to record the required ready hypothesis: ${error.message}`, {}, "HYPOTHESIS_LOG_FAILED", false);
        }
      }
      const built = SecurityToolAdapters.buildAction(args);
      if (!built.ok) return fail("run_security_tool", built.error, { adapter: built.action }, built.code, false);
      const currentResolution = await ScopeEngine.resolveTargetAddresses(built.action.target);
      if (!currentResolution.ok) return fail("run_security_tool", currentResolution.reason, { resolution: currentResolution }, currentResolution.code, false);
      const stableResolution = ScopeEngine.compareResolution(args.resolution_addresses, currentResolution.addresses);
      if (!stableResolution.ok) return fail("run_security_tool", stableResolution.reason, { resolution: stableResolution }, stableResolution.code, false);
      const result = await withTargetExecutionLease(built.action.target.hostname, built.action.configuration.rateLimit, () => {
        if (terminalHost?.runExecutable) {
          return terminalHost.runExecutable(
            workspace,
            built.action.executable,
            built.action.processArgs,
            {
              timeoutMs: built.action.configuration.timeoutMs,
              toolName: "run_security_tool",
              displayCommand: built.action.command,
            },
          );
        }
        return runWorkspaceProcessArgs(workspace, built.action.executable, built.action.processArgs, { timeoutMs: built.action.configuration.timeoutMs });
      });
      const redact = (value) => String(value || "")
        .replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,;&}]+/gi, "$1[REDACTED]")
        .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
        .slice(0, 50000);
      let evidence = null;
      try {
        const resolved = resolveWorkspaceTarget(workspace, built.action.outputPath);
        if (resolved.error) return fail("run_security_tool", resolved.error, {}, "OUTPUT_PATH_INVALID", false);
        const artifact = {
          schemaVersion: 1,
          adapterId: built.action.adapterId,
          target: built.action.target,
          status: result.status || (result.timedOut ? "timeout" : result.ok ? "complete" : "failed"),
          terminationReason: result.terminationReason || "",
          elapsedMs: Number(result.elapsedMs) || 0,
          outputCompleteness: result.outputCompleteness || (result.timedOut ? "partial" : "complete"),
          hadAnsi: Boolean(result.hadAnsi),
          exitCode: result.exitCode,
          signal: result.signal,
          capturedAt: new Date().toISOString(),
          stdout: redact(result.stdout),
          stderr: redact(result.stderr),
          truncated: String(result.stdout || "").length > 50000 || String(result.stderr || "").length > 50000,
          redacted: true,
        };
        const content = `${JSON.stringify(artifact, null, 2)}\n`;
        fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
        fs.writeFileSync(resolved.target, content, { encoding: "utf8", mode: 0o600 });
        evidence = assessmentWorkspace?.appendEvidenceRecord?.(workspace, {
          type: "tool-output",
          title: `${built.action.adapterId} output for ${built.action.target.hostname}`,
          capturedBy: built.action.adapterId,
          source: "typed-security-adapter",
          host: built.action.target.hostname,
          url: `${built.action.target.scheme}://${built.action.target.hostname}:${built.action.target.port}${built.action.target.path}`,
          sha256: crypto?.createHash?.("sha256").update(content).digest("hex"),
          content,
          redacted: true,
          filePath: built.action.outputPath,
          notes: `${artifact.status}; hypothesis ${built.action.hypothesisId || "not-linked"}`,
        }) || null;
      } catch (error) {
        return fail("run_security_tool", `Tool completed but evidence persistence failed: ${error.message}`, { result }, "EVIDENCE_WRITE_FAILED", false);
      }
      return normalizeResult({
        ...result,
        toolName: "run_security_tool",
        mode: "security-adapter",
        adapter: { ...built.action, command: undefined, processArgs: undefined },
        command: built.action.command,
        outputPath: built.action.outputPath,
        expectedSignal: built.action.expectedSignal,
        evidencePlan: built.action.evidencePlan,
        evidence,
        evidenceId: evidence?.record?.id || "",
        status: result.status || (result.timedOut ? "timeout" : result.ok ? "complete" : "failed"),
        terminationReason: result.terminationReason || "",
        elapsedMs: Number(result.elapsedMs) || 0,
        outputCompleteness: result.outputCompleteness || (result.timedOut ? "partial" : "complete"),
        hadAnsi: Boolean(result.hadAnsi),
      });
    },
    async run_traffsucker({ workspace, args, terminalHost }) {
      const missing = requireWorkspace(workspace, "run_traffsucker");
      if (missing) return missing;
      const built = SecurityToolAdapters.buildTraffsuckerPlan(args);
      if (!built.ok) return fail("run_traffsucker", built.error, { adapter: built.plan }, built.code, false);
      if (!subagentRunner || typeof terminalHost?.startProcess !== "function") {
        return fail("run_traffsucker", "The subagent runner or background process host is unavailable.", {}, "SUBAGENT_UNAVAILABLE", false);
      }
      const currentResolution = await ScopeEngine.resolveTargetAddresses(built.plan.target);
      if (!currentResolution.ok) return fail("run_traffsucker", currentResolution.reason, { resolution: currentResolution }, currentResolution.code, false);
      if (Array.isArray(args.resolution_addresses) && args.resolution_addresses.length) {
        const stableResolution = ScopeEngine.compareResolution(args.resolution_addresses, currentResolution.addresses);
        if (!stableResolution.ok) return fail("run_traffsucker", stableResolution.reason, { resolution: stableResolution }, stableResolution.code, false);
      }

      const resolved = resolveWorkspaceTarget(workspace, built.plan.configPath);
      if (resolved.error) return fail("run_traffsucker", resolved.error, {}, "CONFIG_PATH_INVALID", false);
      try {
        fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
        fs.writeFileSync(resolved.target, built.configYaml, { encoding: "utf8", mode: 0o600 });
      } catch (error) {
        return fail("run_traffsucker", `Failed to author traffsucker config: ${error.message}`, {}, "CONFIG_WRITE_FAILED", false);
      }

      // traffsucker may run for hours; inject Xekute's OpenRouter key into the
      // subprocess env so the hosted subagent model works. Never passes it as an arg.
      const openRouterKey = typeof getOpenRouterApiKey === "function" ? getOpenRouterApiKey() : "";
      const run = terminalHost.startProcess(workspace, built.command, {
        toolName: "run_traffsucker",
        command: built.command,
        ownerId: "traffsucker",
        env: openRouterKey ? { OPENROUTER_API_KEY: openRouterKey } : undefined,
      });
      if (!run || run.error) return fail("run_traffsucker", run?.error || "Failed to start traffsucker subagent", { run }, run?.code || "SUBAGENT_START_FAILED", false);

      let done = null;
      const waitMs = Object.prototype.hasOwnProperty.call(args || {}, "wait_ms") || Object.prototype.hasOwnProperty.call(args || {}, "waitMs")
        ? resolveWaitMs(args, 0)
        : (Number(args.max_runtime) > 0 ? Math.round(Number(args.max_runtime) * 1000) : 0);
      const { subagentId, waitId } = subagentRunner.registerRun({
        processId: run.id,
        terminalId: run.terminalId,
        workspace,
        outputDir: built.plan.outputDir,
        configPath: built.plan.configPath,
        model: built.plan.model,
        target: built.plan.target.hostname,
        command: built.command,
        waitMs,
        checkpointIntervalMs: 5 * 60 * 1000,
        killOnTimeout: false,
        ownerId: "traffsucker",
        notify(snapshot) {
          done = snapshot;
          void snapshot;
        },
      });

      return ok("run_traffsucker", "subagent_wait", {
        subagentId,
        waitId: waitId || subagentId,
        target: built.plan.target.hostname,
        model: built.plan.model,
        outputDir: built.plan.outputDir,
        configPath: built.plan.configPath,
        processId: run.id,
        terminalId: run.terminalId,
        waitMs,
        status: "running",
        command: built.command,
        content: `traffsucker subagent ${subagentId} launched in background. Agent turn ends now; harness shows live waiting time, feeds a checkpoint transcript after wait_ms if still running, and resumes again when it finishes.`,
        mutated: false,
      });
    },
    async record_hypothesis({ workspace, args }) {
      const missing = requireWorkspace(workspace, "record_hypothesis");
      if (missing) return missing;
      const question = String(args.question || "").trim();
      if (!question) return fail("record_hypothesis", "A hypothesis question is required", {}, "MISSING_HYPOTHESIS", true);
      const entry = {
        id: String(args.id || `hyp-${Date.now()}`).slice(0, 120),
        title: String(args.title || "Untitled security hypothesis").slice(0, 240),
        question: question.slice(0, 1200),
        target: String(args.target || "").slice(0, 500),
        expectedSignal: String(args.expected_signal || "").slice(0, 1200),
        rejectingSignal: String(args.rejecting_signal || "").slice(0, 1200),
        proposedTechnique: String(args.proposed_technique || "").slice(0, 300),
        evidencePlan: Array.isArray(args.evidence_plan) ? args.evidence_plan.map((value) => String(value).slice(0, 500)).slice(0, 20) : [],
        stopConditions: Array.isArray(args.stop_conditions) ? args.stop_conditions.map((value) => String(value).slice(0, 500)).slice(0, 20) : [],
        evidenceIds: Array.isArray(args.evidence_ids) ? args.evidence_ids.map((value) => String(value).slice(0, 120)).slice(0, 50) : [],
        status: "ready",
        source: "agent",
        recordedAt: new Date().toISOString(),
      };
      try {
        const file = path.join(workspace, ".xekute", "logs", "agent-hypotheses.jsonl");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
        return ok("record_hypothesis", "hypothesis", { hypothesis: entry, file: ".xekute/logs/agent-hypotheses.jsonl", content: `Recorded hypothesis ${entry.id}: ${entry.question}` });
      } catch (error) {
        return fail("record_hypothesis", error.message, {}, "HYPOTHESIS_LOG_FAILED", false);
      }
    },
    async record_finding_candidate({ workspace, args }) {
      const missing = requireWorkspace(workspace, "record_finding_candidate");
      if (missing) return missing;
      if (!assessmentWorkspace?.appendFinding) return fail("record_finding_candidate", "Finding persistence is unavailable", {}, "FINDING_SERVICE_UNAVAILABLE", false);
      const result = assessmentWorkspace.appendFinding(workspace, args.finding || {});
      if (result?.error) return fail("record_finding_candidate", result.error, { gate: result.gate }, result.code || "FINDING_GATE_FAILED", false);
      return ok("record_finding_candidate", "finding-candidate", { finding: result.finding, duplicateOf: result.duplicateOf || "", file: result.path, evidenceIds: result.finding?.evidence || [], content: result.duplicateOf ? `Candidate matches existing finding ${result.duplicateOf}.` : `Recorded finding candidate ${result.finding?.id || ""} with status ${result.finding?.status || "draft"}.` });
    },
    async verify_finding_candidate({ workspace, args }) {
      const missing = requireWorkspace(workspace, "verify_finding_candidate");
      if (missing) return missing;
      if (typeof verifyFindingCandidate !== "function") return fail("verify_finding_candidate", "Hybrid verifier is unavailable", {}, "VERIFIER_UNAVAILABLE", false);
      const result = await verifyFindingCandidate(workspace, args.model, args.finding);
      if (result?.error || result?.verdict === "inconclusive") return fail("verify_finding_candidate", result?.error || "Verifier returned inconclusive", { verdict: result }, result?.code || "VERIFIER_INCONCLUSIVE", false);
      return ok("verify_finding_candidate", "hybrid-verifier", { verdict: result, evidenceId: result.verifierEvidenceId || "", evidenceIds: result.verifierEvidenceId ? [result.verifierEvidenceId] : [], content: JSON.stringify(result) });
    },

    async get_map_overview({ workspace }) {
      return mapResult(workspace, "get_map_overview", "map_overview", (root) => assessmentMap.getOverview(root));
    },

    async get_map_node({ workspace, args }) {
      return mapResult(workspace, "get_map_node", "map_node", (root) => assessmentMap.getNode(root, args.id));
    },

    async get_map_neighbors({ workspace, args }) {
      return mapResult(workspace, "get_map_neighbors", "map_neighbors", (root) => assessmentMap.getNeighbors(root, args.id, { edgeTypes: args.edge_types, minConfidence: args.min_confidence }));
    },

    async find_map_paths({ workspace, args }) {
      return mapResult(workspace, "find_map_paths", "map_paths", (root) => assessmentMap.findPaths(root, args.from, args.to, { maxHops: args.max_hops, minConfidence: args.min_confidence }));
    },

    async search_map_routes({ workspace, args }) {
      return mapResult(workspace, "search_map_routes", "map_routes", (root) => assessmentMap.searchRoutes(root, args.pattern, { tags: args.tags }));
    },

    async get_map_shared_objects({ workspace, args }) {
      return mapResult(workspace, "get_map_shared_objects", "map_shared_objects", (root) => assessmentMap.getSharedObjects(root, args.id));
    },

    async get_map_evidence({ workspace, args }) {
      return mapResult(workspace, "get_map_evidence", "map_evidence", (root) => assessmentMap.getEvidence(root, args.evidence_ids));
    },

    async get_map_hypotheses({ workspace, args }) {
      return mapResult(workspace, "get_map_hypotheses", "map_hypotheses", (root) => assessmentMap.getHypotheses(root, { status: args.status }));
    },

    async annotate_map_finding({ workspace, args }) {
      return mapResult(workspace, "annotate_map_finding", "map_annotation", (root) => assessmentMap.annotateFinding(root, { ...args, evidenceIds: args.evidence_ids }));
    },

    async find_files({ workspace, args }) {
      const missing = requireWorkspace(workspace, "find_files");
      if (missing) return missing;
      const query = String(args.query || "").trim();
      if (!query) return fail("find_files", "Missing required query", {}, "MISSING_QUERY", true);
      const result = findWorkspaceFiles(workspace, query, { limit: Number(args.limit) || 8 });
      if (result.error) return fail("find_files", result.error, {}, "SEARCH_FAILED", false);
      return ok("find_files", "find", {
        query,
        count: result.count,
        results: result.results,
        content: formatFindContent(result),
      });
    },

    async list_files({ workspace }) {
      const missing = requireWorkspace(workspace, "list_files");
      if (missing) return missing;
      const result = listProjectFiles(workspace);
      if (result.error) return fail("list_files", result.error, {}, "LIST_FAILED", false);
      return ok("list_files", "list", { files: result.files, content: `Project files:\n${result.files.map((f) => `- ${f}`).join("\n")}` });
    },

    async inspect_workspace({ workspace }) {
      const missing = requireWorkspace(workspace, "inspect_workspace");
      if (missing) return missing;
      const listed = listProjectFiles(workspace);
      if (listed.error) return fail("inspect_workspace", listed.error, {}, "INSPECT_FAILED", false);
      const inspection = inspectWorkspace({ workspace, files: listed.files, fs, path, readFile });
      return ok("inspect_workspace", "inspect", {
        ...inspection,
        content: formatInspectionContent(inspection),
      });
    },

    async search_web({ args }) {
      if (typeof searchWeb !== "function") return fail("search_web", "Web search is unavailable", {}, "WEB_UNAVAILABLE", false);
      const result = await searchWeb(args.query, { limit: args.limit });
      if (result.error) return fail("search_web", result.error, { query: args.query }, "WEB_SEARCH_FAILED", true);
      return ok("search_web", "web_search", {
        query: result.query,
        count: result.count,
        results: result.results,
        provider: result.provider,
        content: formatWebSearchContent(result),
      });
    },

    async fetch_url({ args }) {
      if (typeof fetchWebPage !== "function") return fail("fetch_url", "Web page reading is unavailable", {}, "WEB_UNAVAILABLE", false);
      const url = String(args.url || "").trim();
      if (!url) return fail("fetch_url", "Missing required url", {}, "MISSING_URL", true);
      const resolution = await ScopeEngine.resolveTargetAddresses(url);
      if (!resolution.ok) return fail("fetch_url", resolution.reason, { url, scope: resolution }, resolution.code, false);
      const result = await fetchWebPage(url, { maxChars: args.max_chars });
      if (result.error) return fail("fetch_url", result.error, { url: args.url }, "WEB_FETCH_FAILED", true);
      return ok("fetch_url", "web_page", {
        url: result.url,
        finalUrl: result.finalUrl,
        title: result.title,
        contentType: result.contentType,
        truncated: result.truncated,
        content: formatWebPageContent(result),
      });
    },

    async read_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "read_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("read_file", "Missing required path", {}, "MISSING_PATH", true);
      const result = readFile(workspace, file);
      if (result.error) {
        const code = /not found/i.test(result.error) ? "FILE_NOT_FOUND" : "READ_FAILED";
        return fail("read_file", result.error, { file }, code, code === "FILE_NOT_FOUND");
      }
      return ok("read_file", "read", {
        file,
        content: result.content,
        summary: `Read ${file} (${result.content.split(/\r?\n/).length} lines)`,
      });
    },

    async read_files({ workspace, args }) {
      const missing = requireWorkspace(workspace, "read_files");
      if (missing) return missing;
      const paths = Array.isArray(args.paths) ? args.paths.map((p) => String(p || "").trim()).filter(Boolean) : [];
      if (!paths.length) return fail("read_files", "Missing required paths", {}, "MISSING_PATHS", true);

      const files = [];
      const errors = [];
      for (const file of paths.slice(0, 12)) {
        const result = readFile(workspace, file);
        if (result.error) {
          errors.push({ file, error: result.error });
        } else {
          files.push({
            file,
            content: result.content,
            lineCount: result.content.split(/\r?\n/).length,
          });
        }
      }

      if (!files.length && errors.length) {
        return fail("read_files", errors.map((row) => `${row.file}: ${row.error}`).join("; "), { errors }, "READ_FAILED", true);
      }

      return ok("read_files", "read_many", {
        files,
        errors,
        content: formatReadFilesContent(files, errors),
        summary: `Read ${files.length} file${files.length === 1 ? "" : "s"}${errors.length ? ` (${errors.length} failed)` : ""}`,
      });
    },

    async write_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "write_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = args.content ?? args.code;
      if (!file) return fail("write_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("write_file", file);
      if (protectedError) return protectedError;
      if (content == null) return fail("write_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const result = await editWorkspaceFile(workspace, file, { code: String(content) });
      if (result.error) return fail("write_file", result.error, { file }, "WRITE_FAILED", false);
      return ok("write_file", result.mode || "full", {
        file,
        path: result.path,
        content: result.content ?? String(content),
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        fallback: result.fallback,
        mutated: result.mode !== "noop",
      });
    },

    async create_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "create_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = args.content ?? args.code;
      if (!file) return fail("create_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("create_file", file);
      if (protectedError) return protectedError;
      if (content == null) return fail("create_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const resolved = resolveWorkspaceTarget(workspace, file);
      if (resolved.error) return fail("create_file", resolved.error, { file }, "INVALID_PATH", false);
      if (fs.existsSync(resolved.target)) return fail("create_file", `File already exists: ${file}`, { file }, "FILE_EXISTS", true);
      const result = await editWorkspaceFile(workspace, file, { code: String(content) });
      if (result.error) return fail("create_file", result.error, { file }, "WRITE_FAILED", false);
      return ok("create_file", "create", {
        file,
        path: result.path,
        content: result.content ?? String(content),
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: true,
      });
    },

    async create_guidance({ workspace, args }) {
      if (typeof writeGuidanceFile !== "function") return fail("create_guidance", "Guidance storage is unavailable", {}, "GUIDANCE_UNAVAILABLE", false);
      const scope = String(args.scope || "project").toLowerCase();
      if (scope === "project") {
        const missing = requireWorkspace(workspace, "create_guidance");
        if (missing) return missing;
      }
      const result = writeGuidanceFile({
        workspace,
        globalRoot: typeof globalGuidanceRoot === "function" ? globalGuidanceRoot() : "",
        scope,
        kind: args.kind,
        name: args.name,
        content: args.content,
        overwrite: false,
      });
      if (result?.error) return fail("create_guidance", result.error, { scope, kind: args.kind, name: args.name }, result.code || "GUIDANCE_WRITE_FAILED", false);
      return ok("create_guidance", "create", {
        file: result.scope === "project" ? result.file : "",
        path: result.scope === "project" ? result.file : "",
        guidancePath: result.file,
        scope: result.scope,
        kind: result.kind,
        content: result.content,
        summary: `Created ${result.kind} in ${result.scope} scope: ${result.file}`,
        mutated: true,
      });
    },

    async request_operator_questions({ workspace, args }) {
      const missing = requireWorkspace(workspace, "request_operator_questions");
      if (missing) return missing;

      const normalized = OperatorQuestions.normalizeQuestions(args.questions);
      if (normalized.error) {
        return fail(
          "request_operator_questions",
          normalized.error,
          {},
          normalized.code || "INVALID_QUESTIONS",
          true,
        );
      }

      const file = OperatorQuestions.buildQuestionsDocumentPath(args.topic || args.reason);
      const protectedError = rejectProtectedMutation("request_operator_questions", file);
      if (protectedError) return protectedError;

      const document = OperatorQuestions.buildDocument({
        reason: args.reason,
        topic: args.topic || "",
        questions: normalized.questions,
      });
      const content = JSON.stringify(document, null, 2);
      const resolved = resolveWorkspaceTarget(workspace, file);
      if (resolved.error) return fail("request_operator_questions", resolved.error, { file }, "INVALID_PATH", false);
      if (fs.existsSync(resolved.target)) {
        return fail("request_operator_questions", `Questions file already exists: ${file}`, { file }, "FILE_EXISTS", true);
      }

      const result = await editWorkspaceFile(workspace, file, { code: content });
      if (result.error) return fail("request_operator_questions", result.error, { file }, "WRITE_FAILED", false);

      return ok("request_operator_questions", "questions", {
        file,
        path: result.path || file,
        requestId: document.requestId,
        policy_precedence: OperatorQuestions.buildPolicyPrecedenceHints({
          roe: args.roe,
          reason: args.reason,
        }),
        summary: `Saved operator questions to ${file}. Waiting for answers.`,
        mutated: true,
      });
    },

    async load_tool_schemas({ args }) {
      // allowedNames is injected by the agent controller so Mode remains authoritative.
      const allowedNames = Array.isArray(args.__allowedNames) ? args.__allowedNames : [];
      const resolved = ToolMap.resolveSchemaLoad({
        allowedNames,
        packs: args.packs,
        names: args.names,
      });
      if (!resolved.ok) {
        return fail(
          "load_tool_schemas",
          resolved.error || "No schemas loaded",
          {
            packs: args.packs || [],
            names: args.names || [],
            denied: resolved.denied,
            missing: resolved.missing,
            unknownPacks: resolved.unknownPacks,
          },
          resolved.code || "SCHEMA_LOAD_EMPTY",
          true,
        );
      }
      const payload = {
        loaded: resolved.loaded,
        denied: resolved.denied,
        missing: resolved.missing,
        unknownPacks: resolved.unknownPacks,
        packs: ToolMap.LOADABLE_PACK_NAMES,
        schemas: resolved.schemas.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      };
      return ok("load_tool_schemas", "schema_load", {
        loaded: resolved.loaded,
        denied: resolved.denied,
        missing: resolved.missing,
        unknownPacks: resolved.unknownPacks,
        summary: `Loaded schemas for ${resolved.loaded.length} tool(s): ${resolved.loaded.join(", ")}. They are available for subsequent calls in this turn.`,
        content: JSON.stringify(payload, null, 2),
        mutated: false,
      });
    },

    async patch_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "patch_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("patch_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("patch_file", file);
      if (protectedError) return protectedError;
      const patches = Array.isArray(args.patches)
        ? args.patches
        : [{ search: args.search, replace: args.replace }];
      const cleanPatches = patches.map((patch) => ({
        search: String(patch?.search ?? ""),
        replace: String(patch?.replace ?? ""),
      }));
      if (!cleanPatches.length || cleanPatches.some((patch) => !patch.search)) {
        return fail("patch_file", "Missing required search text", { file }, "MISSING_SEARCH", true);
      }
      const result = await editWorkspaceFile(workspace, file, { patches: cleanPatches });
      if (result.error) {
        const code = /not found/i.test(result.error)
          ? "PATCH_SEARCH_NOT_FOUND"
          : /matched .* times/i.test(result.error)
            ? "PATCH_NOT_UNIQUE"
            : "PATCH_FAILED";
        return fail("patch_file", result.error, { file }, code, true);
      }
      return ok("patch_file", result.mode || "patch", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async replace_in_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "replace_in_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const search = String(args.old_text ?? args.search ?? "");
      const replace = String(args.new_text ?? args.replace ?? "");
      if (!file) return fail("replace_in_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("replace_in_file", file);
      if (protectedError) return protectedError;
      if (!search) return fail("replace_in_file", "Missing required old_text", { file }, "MISSING_SEARCH", true);
      const result = await editWorkspaceFile(workspace, file, { patches: [{ search, replace }] });
      if (result.error) return fail("replace_in_file", result.error, { file }, "REPLACE_FAILED", true);
      return ok("replace_in_file", result.mode || "replace", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async insert_in_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "insert_in_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const anchor = String(args.anchor ?? "");
      const content = String(args.content ?? args.text ?? "");
      const position = String(args.position || "after").toLowerCase() === "before" ? "before" : "after";
      if (!file) return fail("insert_in_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("insert_in_file", file);
      if (protectedError) return protectedError;
      if (!anchor) return fail("insert_in_file", "Missing required anchor", { file }, "MISSING_ANCHOR", true);
      if (!content) return fail("insert_in_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const replace = position === "before" ? `${content}${anchor}` : `${anchor}${content}`;
      const result = await editWorkspaceFile(workspace, file, { patches: [{ search: anchor, replace }] });
      if (result.error) return fail("insert_in_file", result.error, { file }, "INSERT_FAILED", true);
      return ok("insert_in_file", "insert", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async append_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "append_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = String(args.content ?? args.code ?? "");
      if (!file) return fail("append_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("append_file", file);
      if (protectedError) return protectedError;
      if (!content) return fail("append_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const current = readFile(workspace, file);
      if (current.error) return fail("append_file", current.error, { file }, "FILE_NOT_FOUND", true);
      const prefix = current.content && !current.content.endsWith("\n") ? "\n" : "";
      const result = await editWorkspaceFile(workspace, file, { code: `${current.content}${prefix}${content}` });
      if (result.error) return fail("append_file", result.error, { file }, "APPEND_FAILED", false);
      return ok("append_file", "append", {
        file,
        path: result.path,
        content: result.content,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async delete_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "delete_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("delete_file", "Missing required path", {}, "MISSING_PATH", true);
      const protectedError = rejectProtectedMutation("delete_file", file);
      if (protectedError) return protectedError;
      const result = deleteWorkspaceFile(workspace, file);
      if (result.error) return fail("delete_file", result.error, { file }, "DELETE_FAILED", false);
      return ok("delete_file", "delete", { file, mutated: true });
    },

    async index_workspace({ workspace }) {
      const missing = requireWorkspace(workspace, "index_workspace");
      if (missing) return missing;
      const index = buildWorkspaceIndex(workspace);
      if (index.error) return fail("index_workspace", index.error, {}, "INDEX_FAILED", false);
      const graph = index.graph.slice(0, 80);
      return ok("index_workspace", "index", {
        files: index.docs.length,
        builtAt: index.builtAt,
        graph,
        content: `Indexed ${index.docs.length} files.`,
      });
    },

    async search_code({ workspace, args }) {
      const missing = requireWorkspace(workspace, "search_code");
      if (missing) return missing;
      const query = String(args.query || "").trim();
      if (!query) return fail("search_code", "Missing required query", {}, "MISSING_QUERY", true);
      const result = searchWorkspaceIndex(workspace, query, { limit: Number(args.limit) || 8 });
      if (result.error) return fail("search_code", result.error, {}, "SEARCH_FAILED", false);
      return ok("search_code", "search", {
        query,
        count: result.count,
        results: result.results,
        content: formatSearchContent(result),
      });
    },

    async get_file_outline({ workspace, args }) {
      const missing = requireWorkspace(workspace, "get_file_outline");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("get_file_outline", "Missing required path", {}, "MISSING_PATH", true);
      const result = readFile(workspace, file);
      if (result.error) {
        const code = /not found/i.test(result.error) ? "FILE_NOT_FOUND" : "READ_FAILED";
        return fail("get_file_outline", result.error, { file }, code, code === "FILE_NOT_FOUND");
      }
      const outline = extractFileOutline(file, result.content);
      return ok("get_file_outline", "outline", {
        file,
        ...outline,
        content: formatOutlineContent(file, outline),
        summary: `Outlined ${file} (${outline.symbols.length} symbols)`,
      });
    },

    async run_command({ workspace, args, terminalHost }) {
      const missing = requireWorkspace(workspace, "run_command");
      if (missing) return missing;
      const command = String(args.command || "").trim();
      if (!command) return fail("run_command", "Missing required command", {}, "MISSING_COMMAND", true);
      if (CyberTools.isSecurityCommand(command)) return fail("run_command", "Security CLI commands must use run_security_tool so typed scope, rate, and evidence controls remain enforced.", { command }, "TYPED_SECURITY_TOOL_REQUIRED", false);
      if (COMMAND_CHAIN_RE.test(command)) return fail("run_command", "Run one bounded workspace command per tool call; shell command chains are not allowed.", { command }, "COMMAND_CHAIN_BLOCKED", false);
      if (PROTECTED_ASSESSMENT_COMMAND_RE.test(command)) return fail("run_command", "Commands cannot address schema-managed Core resources. Use a typed ingestion or evidence adapter.", { command }, "TYPED_ASSESSMENT_MUTATION_REQUIRED", false);

      // Prefer harness-wait background terminals so the agent turn can stop and
      // resume with the transcript when the command finishes.
      if (typeof terminalHost?.startProcess === "function" && subagentRunner?.registerWait) {
        const waitMs = resolveWaitMs(args, 60000);
        const started = terminalHost.startProcess(workspace, command, {
          toolName: "run_command",
          command,
          ownerId: "agent",
        });
        if (started?.error) return fail("run_command", started.error, { command }, "COMMAND_FAILED", false);
        const registered = registerTerminalWait({
          processId: started.id,
          terminalId: started.terminalId,
          toolName: "run_command",
          command,
          waitMs,
          checkpointIntervalMs: Math.max(waitMs, 30 * 1000),
          killOnTimeout: false,
          ownerId: "agent",
        });
        if (registered.error) return fail("run_command", registered.error, { command }, registered.code || "WAIT_RUNNER_UNAVAILABLE", false);
        return ok("run_command", "terminal_wait", {
          waitId: registered.waitId,
          processId: started.id,
          terminalId: started.terminalId,
          command,
          waitMs,
          status: "running",
          content: `Started \`${command}\` in terminal ${started.terminalId || started.id}. Agent turn ends now; harness shows live waiting time, feeds a checkpoint transcript after wait_ms if still running, and resumes again when the command finishes.`,
          mutated: false,
        });
      }

      const result = terminalHost?.runCommand
        ? await terminalHost.runCommand(workspace, command, {
          timeoutMs: resolveWaitMs(args, 60000) || 60000,
        })
        : await runWorkspaceCommand(workspace, command, {
          timeoutMs: resolveWaitMs(args, 60000) || 60000,
        });
      if (result.error) return fail("run_command", result.error, { command }, "COMMAND_FAILED", false);
      return ok("run_command", "command", { ...result, command });
    },

    async start_process({ workspace, args, terminalHost }) {
      const missing = requireWorkspace(workspace, "start_process");
      if (missing) return missing;
      const command = String(args.command || "").trim();
      if (!command) return fail("start_process", "Missing required command", {}, "MISSING_COMMAND", true);
      if (CyberTools.isSecurityCommand(command)) return fail("start_process", "Security CLI commands must use run_security_tool so typed scope, rate, and evidence controls remain enforced.", { command }, "TYPED_SECURITY_TOOL_REQUIRED", false);
      if (COMMAND_CHAIN_RE.test(command)) return fail("start_process", "Start one bounded workspace process per tool call; shell command chains are not allowed.", { command }, "COMMAND_CHAIN_BLOCKED", false);
      if (PROTECTED_ASSESSMENT_COMMAND_RE.test(command)) return fail("start_process", "Processes cannot address schema-managed Core resources. Use a typed ingestion or evidence adapter.", { command }, "TYPED_ASSESSMENT_MUTATION_REQUIRED", false);
      const result = terminalHost?.startProcess
        ? terminalHost.startProcess(workspace, command)
        : startWorkspaceProcess(workspace, command);
      if (result.error) return fail("start_process", result.error, { command }, "PROCESS_START_FAILED", false);

      const wantsWait = Object.prototype.hasOwnProperty.call(args || {}, "wait_ms")
        || Object.prototype.hasOwnProperty.call(args || {}, "waitMs");
      if (wantsWait && subagentRunner?.registerWait) {
        const waitMs = resolveWaitMs(args, 0);
        const registered = registerTerminalWait({
          processId: result.id,
          terminalId: result.terminalId,
          toolName: "start_process",
          command,
          waitMs,
          checkpointIntervalMs: Math.max(waitMs, 30 * 1000),
          killOnTimeout: false,
          ownerId: "agent",
        });
        if (registered.error) return fail("start_process", registered.error, { command }, registered.code || "WAIT_RUNNER_UNAVAILABLE", false);
        return ok("start_process", "terminal_wait", {
          waitId: registered.waitId,
          processId: result.id,
          terminalId: result.terminalId,
          command,
          waitMs,
          status: "running",
          content: `Started \`${command}\` in terminal ${result.terminalId || result.id}. Agent turn ends now; harness shows live waiting time, feeds a checkpoint transcript after wait_ms if still running, and resumes again when the process finishes.`,
          mutated: false,
        });
      }

      return ok("start_process", "process_start", result);
    },

    async read_process({ args }) {
      const id = String(args.id || "").trim();
      if (!id) return fail("read_process", "Missing required id", {}, "MISSING_ID", true);
      const result = readToolProcess(id);
      if (result.error) return fail("read_process", result.error, { id }, "PROCESS_UNKNOWN", true);
      return ok("read_process", "process_read", result);
    },

    async stop_process({ args, terminalHost }) {
      const id = String(args.id || "").trim();
      if (!id) return fail("stop_process", "Missing required id", {}, "MISSING_ID", true);
      const result = terminalHost?.stopProcess
        ? terminalHost.stopProcess(id)
        : stopToolProcess(id);
      if (result.error) return fail("stop_process", result.error, { id }, "PROCESS_UNKNOWN", true);
      return ok("stop_process", "process_stop", { ...result, mutated: false });
    },
  };
  const TOOL_HANDLERS_BY_CATEGORY = Object.freeze({
    os: Object.freeze(Object.fromEntries(
      Object.entries(TOOL_HANDLERS).filter(([name]) => ToolMap.TOOL_META[name]?.category === "os"),
    )),
    cyber: Object.freeze(Object.fromEntries(
      Object.entries(TOOL_HANDLERS).filter(([name]) => ToolMap.TOOL_META[name]?.category === "cyber"),
    )),
  });

  async function executeToolCall({ workspace, toolCall, terminalHost = null }) {
    const normalized = normalizeIncomingToolCall(toolCall);
    if (normalized.error) {
      return fail(
        normalized.toolName || "unknown",
        normalized.error,
        {},
        normalized.errorCode || "TOOL_ERROR",
        Boolean(normalized.retryable),
      );
    }
    const category = ToolMap.TOOL_META[normalized.toolName]?.category;
    const handler = TOOL_HANDLERS_BY_CATEGORY[category]?.[normalized.toolName];
    if (!handler) return fail(normalized.toolName, `Unknown tool: ${normalized.toolName}`);
    try {
      return await handler({ workspace, args: normalized.args, toolCall: normalized.raw, terminalHost });
    } catch (err) {
      return fail(normalized.toolName, err?.message || String(err));
    }
  }

  return { TOOL_HANDLERS, TOOL_HANDLERS_BY_CATEGORY, executeToolCall };
}

function normalizeIncomingToolCall(toolCall) {
  const fn = toolCall?.function || {};
  const toolName = String(fn.name || toolCall?.toolName || toolCall?.action || "").trim();
  if (!ToolMap.TOOL_META[toolName]) return { error: `Unknown tool: ${toolName || "missing name"}`, toolName };
  const rawArgs = fn.arguments != null
    ? ToolMap.parseArguments(fn.arguments)
    : (toolCall.args || toolCall);
  const validated = ToolMap.validateToolCall(toolName, rawArgs || {});
  if (!validated.ok) {
    return {
      error: validated.error,
      errorCode: validated.code,
      retryable: validated.retryable,
      toolName,
    };
  }
  return { toolName, args: validated.args || {}, raw: toolCall };
}

function normalizeResult(result) {
  const toolName = result.toolName || "unknown";
  const out = {
    ok: Boolean(result.ok) && !result.error,
    toolName,
    mode: result.mode || toolName,
    summary: result.summary || summarizeResult(result),
    mutated: result.mutated === undefined ? ToolMap.isMutating(toolName) : Boolean(result.mutated),
  };

  for (const key of [
    "file", "path", "content", "error", "files", "graph", "query", "count", "results", "command",
    "exitCode", "signal", "timedOut", "stdout", "stderr", "id", "running", "seconds",
    "lines_added", "lines_removed", "patches_applied", "fallback", "errorCode", "errorClass", "retryable",
    "errors", "scripts", "importantFiles", "topFolders", "verificationCommands", "symbols", "imports",
    "provider", "url", "finalUrl", "title", "contentType", "truncated",
    "subagentId", "terminalId", "processId", "configPath", "outputDir", "status",
    "waitId", "waitMs", "model", "target",
    "overview", "analysis", "graphMeta", "node", "scope", "edges", "neighbors", "paths", "routes", "objects", "evidence", "hypotheses", "annotation", "warnings", "missing",
    "datasets", "provisioned", "unprovisioned",
  ]) {
    if (result[key] !== undefined) out[key] = result[key];
  }

  if (out.error) {
    out.ok = false;
    out.errorClass = result.errorClass || classifyErrorCode(out.errorCode);
    out.content = `Error${out.errorCode ? ` [${out.errorCode}]` : ""}${out.errorClass ? ` (class: ${out.errorClass})` : ""}: ${out.error}`;
    out.summary = out.error;
    out.mutated = false;
  } else if (out.content == null) {
    out.content = resultContent(out);
  }

  return out;
}

function summarizeResult(result) {
  if (result.error) return result.error;
  if (result.mode === "list") return `${result.files?.length || 0} files`;
  if (result.mode === "inspect") return `Inspected ${result.files?.length || 0} files`;
  if (result.mode === "find") return `${result.count || 0} file match${result.count === 1 ? "" : "es"}`;
  if (result.mode === "read") return `Read ${result.file}`;
  if (result.mode === "read_many") return `Read ${result.files?.length || 0} files`;
  if (result.mode === "index") return `Indexed ${result.files || 0} files`;
  if (result.mode === "search") return `${result.count || 0} result${result.count === 1 ? "" : "s"}`;
  if (result.mode === "web_search") return `${result.count || 0} web result${result.count === 1 ? "" : "s"}`;
  if (result.mode === "web_page") return `Read ${result.title || result.finalUrl || "web page"}`;
  if (result.mode === "outline") return `Outlined ${result.file}`;
  if (result.mode === "command") {
    if (result.timedOut) return "Timed out";
    return result.exitCode === 0 ? "Passed" : `Exited ${result.exitCode}`;
  }
  if (result.mode === "terminal_wait") return `Waiting on terminal ${result.terminalId || result.processId || ""}`.trim();
  if (result.mode === "subagent_wait") return `Waiting on subagent ${result.subagentId || ""}`.trim();
  if (result.mode === "process_start") return `Started ${result.id}`;
  if (result.mode === "process_read") return result.running ? "Running" : `Exited ${result.exitCode ?? ""}`;
  if (result.mode === "process_stop") return "Stopped";
  if (result.mode === "delete") return "Deleted";
  if (result.mode === "noop") return "No changes";
  if (result.mode === "create") return `Created ${result.file}`;
  if (result.mode === "replace") return `Replaced text in ${result.file}`;
  if (result.mode === "insert") return `Inserted text in ${result.file}`;
  if (result.mode === "append") return `Appended to ${result.file}`;
  if (result.mode === "patch") return `Patched ${result.file}`;
  return result.file ? `Wrote ${result.file}` : "Done";
}

function resultContent(result) {
  if (result.mode === "list") return `Project files:\n${(result.files || []).map((file) => `- ${file}`).join("\n")}`;
  if (result.mode === "inspect") return formatInspectionContent(result);
  if (result.mode === "find") return formatFindContent(result);
  if (result.mode === "read_many") return formatReadFilesContent(result.files || [], result.errors || []);
  if (result.mode === "index") return `Indexed ${result.files || 0} files.`;
  if (result.mode === "search") return formatSearchContent(result);
  if (result.mode === "web_search") return formatWebSearchContent(result);
  if (result.mode === "web_page") return formatWebPageContent(result);
  if (result.mode === "outline") return formatOutlineContent(result.file, result);
  if (result.mode === "command") {
    return [
      `Command: ${result.command}`,
      `Exit: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n");
  }
  if (result.mode === "terminal_wait" || result.mode === "subagent_wait") {
    const label = result.mode === "subagent_wait" ? "subagent" : "terminal";
    const id = result.terminalId || result.processId || result.subagentId || "";
    return [
      `Waiting on ${label}${id ? ` ${id}` : ""}.`,
      result.command ? `Command: ${result.command}` : "",
      Number.isFinite(result.waitMs) ? `wait_ms: ${result.waitMs}` : "",
      "The harness will resume the agent with terminal output when the wait ends.",
    ].filter(Boolean).join("\n");
  }
  if (result.mode === "process_start") return `Started process ${result.id}: ${result.command}`;
  if (result.mode === "process_read" || result.mode === "process_stop") {
    return [
      `Process ${result.id}: ${result.running ? "running" : `exited ${result.exitCode ?? ""}`}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n");
  }
  if (result.mode === "delete") return `OK: ${result.file} deleted`;
  if (result.mode === "noop") return `OK: ${result.file} unchanged`;
  if (result.file) return `OK: ${result.file} saved`;
  return result.summary || "OK";
}

function formatSearchContent(result) {
  const rows = (result.results || [])
    .map((row) => `File: ${row.path}\nScore: ${row.score}\nSnippet:\n${row.snippet}`)
    .join("\n\n");
  return rows || `No results for ${result.query}`;
}

function formatWebSearchContent(result) {
  const rows = (result.results || []).map((row, index) => [
    `${index + 1}. ${row.title}`,
    `URL: ${row.url}`,
    row.snippet ? `Snippet: ${row.snippet}` : "",
  ].filter(Boolean).join("\n"));
  return rows.length
    ? `Web search results for "${result.query}":\n\n${rows.join("\n\n")}`
    : `No web results for ${result.query}`;
}

function formatWebPageContent(result) {
  return [
    `Page: ${result.title || "Untitled"}`,
    `URL: ${result.finalUrl || result.url}`,
    result.truncated ? "Note: page text was truncated to fit context." : "",
    "",
    result.content || "",
  ].filter((part, index) => part || index === 3).join("\n");
}

function formatFindContent(result) {
  const rows = (result.results || [])
    .map((row) => `File: ${row.path}\nScore: ${row.score}`)
    .join("\n\n");
  return rows || `No files found for ${result.query}`;
}

function takeLimited(text, max = 12000) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max)}\n...(truncated)` : value;
}

function formatReadFilesContent(files = [], errors = []) {
  const parts = [];
  for (const file of files) {
    parts.push(`File: ${file.file}`);
    parts.push("```");
    parts.push(takeLimited(file.content, 14000));
    parts.push("```");
  }
  for (const error of errors) {
    parts.push(`Error reading ${error.file}: ${error.error}`);
  }
  return parts.join("\n");
}

function topFoldersFor(files = []) {
  const counts = new Map();
  for (const file of files) {
    const first = String(file).split("/")[0] || ".";
    counts.set(first, (counts.get(first) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([folder, count]) => ({ folder, count }));
}

function importantFilesFor(files = []) {
  const important = [
    "package.json", "vite.config.js", "vite.config.ts", "next.config.js", "next.config.mjs",
    "tsconfig.json", "jsconfig.json", "README.md", "CLAUDE.md", "Dockerfile",
    "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
  ];
  const set = new Set(files);
  return important.filter((file) => set.has(file));
}

function readPackageScripts({ workspace, fs, path }) {
  const packagePath = path.join(workspace, "package.json");
  if (!fs.existsSync(packagePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

function inferVerificationCommands({ files = [], scripts = {} }) {
  const commands = [];
  if (scripts.test) commands.push("npm test");
  if (scripts.lint) commands.push("npm run lint");
  if (scripts.build) commands.push("npm run build");
  if (!commands.length && files.some((file) => file.endsWith(".py"))) commands.push("python -m pytest");
  if (!commands.length && files.some((file) => file.endsWith(".js"))) commands.push("node --check <file>");
  return commands.slice(0, 4);
}

function inspectWorkspace({ workspace, files, fs, path }) {
  const scripts = readPackageScripts({ workspace, fs, path });
  return {
    files,
    fileCount: files.length,
    topFolders: topFoldersFor(files),
    importantFiles: importantFilesFor(files),
    scripts,
    verificationCommands: inferVerificationCommands({ files, scripts }),
  };
}

function formatInspectionContent(inspection) {
  const scripts = Object.entries(inspection.scripts || {});
  return [
    `Workspace overview: ${inspection.fileCount ?? inspection.files?.length ?? 0} files`,
    "",
    "Top folders:",
    ...(inspection.topFolders?.length
      ? inspection.topFolders.map((row) => `- ${row.folder} (${row.count})`)
      : ["- ."]),
    "",
    "Important files:",
    ...(inspection.importantFiles?.length
      ? inspection.importantFiles.map((file) => `- ${file}`)
      : ["- none detected"]),
    "",
    "Package scripts:",
    ...(scripts.length
      ? scripts.map(([name, command]) => `- ${name}: ${command}`)
      : ["- none detected"]),
    "",
    "Likely verification commands:",
    ...(inspection.verificationCommands?.length
      ? inspection.verificationCommands.map((command) => `- ${command}`)
      : ["- none obvious"]),
  ].join("\n");
}

function extractFileOutline(file, content) {
  const imports = [];
  const symbols = [];
  const lines = String(content || "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const importMatch = line.match(/^\s*(?:import\s+.*?\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|from\s+([\w.]+)\s+import\s+|require\(["']([^"']+)["']\))/);
    const importTarget = importMatch?.[1] || importMatch?.[2] || importMatch?.[3] || importMatch?.[4];
    if (importTarget) imports.push({ line: i + 1, target: importTarget });

    const symbolMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function)|^\s*def\s+([A-Za-z_][\w]*)|^\s*class\s+([A-Za-z_][\w]*)/);
    const name = symbolMatch?.[1] || symbolMatch?.[2] || symbolMatch?.[3] || symbolMatch?.[4];
    if (name) {
      const kind = /\bclass\b/.test(line) ? "class" : /\bdef\b|\bfunction\b|=>/.test(line) ? "function" : "symbol";
      symbols.push({ line: i + 1, kind, name });
    }
  }

  return {
    lineCount: lines.length,
    imports: imports.slice(0, 40),
    symbols: symbols.slice(0, 80),
    truncated: imports.length > 40 || symbols.length > 80,
    file,
  };
}

function formatOutlineContent(file, outline) {
  return [
    `Outline for ${file} (${outline.lineCount || 0} lines)`,
    "",
    "Imports:",
    ...(outline.imports?.length
      ? outline.imports.map((row) => `- L${row.line}: ${row.target}`)
      : ["- none detected"]),
    "",
    "Symbols:",
    ...(outline.symbols?.length
      ? outline.symbols.map((row) => `- L${row.line}: ${row.kind} ${row.name}`)
      : ["- none detected"]),
    outline.truncated ? "\n...(outline truncated)" : "",
  ].filter(Boolean).join("\n");
}

module.exports = {
  createToolHandlers,
  normalizeIncomingToolCall,
  normalizeResult,
};
