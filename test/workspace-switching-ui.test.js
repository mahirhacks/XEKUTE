"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8");
const start = source.indexOf("async function loadWorkspace(folder)");
const end = source.indexOf("\nasync function restoreLastWorkspace()", start);
const loadWorkspaceDefinition = source.slice(start, end);
const projectActivationStart = source.indexOf("let projectActivationGeneration = 0;");
const projectActivationEnd = source.indexOf("\nasync function createProject", projectActivationStart);
const projectActivationDefinition = source.slice(projectActivationStart, projectActivationEnd);
const treeStart = source.indexOf("const treeRenderGenerations = new WeakMap();");
const treeEnd = source.indexOf("\nfunction clearTreeDropTargets", treeStart);
const renderTreeDefinition = source.slice(treeStart, treeEnd);
const dirMapStart = source.indexOf("async function refreshDirMap()");
const dirMapEnd = source.indexOf("\nfunction relativePathFromRoot", dirMapStart);
const refreshDirMapDefinition = source.slice(dirMapStart, dirMapEnd);
const projectProfileStart = source.indexOf("async function loadProjectProfile()");
const projectProfileEnd = source.indexOf("\nconst GENERAL_SETTINGS_STORAGE_KEY", projectProfileStart);
const projectProfileDefinitions = source.slice(projectProfileStart, projectProfileEnd);
const identitySettingsStart = source.indexOf("async function loadIdentitySettings()");
const identitySettingsEnd = source.indexOf("\nasync function createIdentityFromSettings", identitySettingsStart);
const identitySettingsDefinition = source.slice(identitySettingsStart, identitySettingsEnd);
const engagementAccountsStart = source.indexOf("function collectEngagementAccountSnapshots()");
const engagementAccountsEnd = source.indexOf("\nasync function handleCredentialAction", engagementAccountsStart);
const engagementAccountsDefinition = source.slice(engagementAccountsStart, engagementAccountsEnd);
const guidanceStart = source.indexOf("let guidanceEntriesRequestGeneration = 0;");
const guidanceEnd = source.indexOf("\nasync function loadAuthoritySettings", guidanceStart);
const guidanceDefinitions = source.slice(guidanceStart, guidanceEnd);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function workspaceLoader({ watchWorkspace }) {
  let epoch = 0;
  const visibleTitles = [];
  const context = {
    rootPath: null,
    assessmentPath: null,
    currentWorkspaceMode: "project",
    WORKSPACE_KEY: "pointer:workspace",
    BUG_BOUNTY_PATH_KEY: "pointer:bugBountyPath",
    appController: {
      beginWorkspace: folder => ({ epoch: ++epoch, folder }),
      isCurrent: requestedEpoch => requestedEpoch === epoch,
    },
    browserWorkspace: { projectChanged() {} },
    guidanceContext: "",
    guidanceContextRequestPath: "",
    selectedItem: null,
    selectedExplorerPaths: new Set(),
    explorerSelectionAnchorPath: "",
    expandedTreePaths: new Set(),
    fileTree: {},
    localStorage: { setItem() {}, removeItem() {} },
    window: { api: { readdir: async () => ({}), watchWorkspace } },
    TerminalManager: { setCwd() {}, openWithProject: async () => {} },
    renderTree: async () => {},
    refreshDirMap: async () => {},
    restoreChatSessionsForCurrentWorkspace: async () => {},
    loadGuidanceSettings: async () => {},
    setProjectFolder() {},
    setExplorerActionsEnabled() {},
    updateContextUsage() {},
    setAssessmentUiState(_mode, state) { visibleTitles.push(state.title); },
    projectName: folder => folder.split(/[\\/]/).pop(),
  };
  vm.createContext(context);
  vm.runInContext(loadWorkspaceDefinition, context);
  return { load: context.loadWorkspace, visibleTitles, context };
}

test("a project switch during workspace watch cannot let the old load update the active project screen", async () => {
  const watchA = deferred();
  let startedA;
  const startedWatchingA = new Promise(resolve => { startedA = resolve; });
  const loader = workspaceLoader({
    watchWorkspace(folder) {
      if (folder === "G:/A") {
        startedA();
        return watchA.promise;
      }
      return Promise.resolve();
    },
  });

  const oldLoad = loader.load("G:/A");
  await startedWatchingA;
  assert.equal(await loader.load("G:/B"), true);
  assert.equal(loader.context.rootPath, "G:/B");
  assert.equal(loader.visibleTitles.at(-1), "B");

  watchA.resolve();
  assert.equal(await oldLoad, false);
  assert.equal(loader.context.rootPath, "G:/B");
  assert.equal(loader.visibleTitles.at(-1), "B");
});

test("a delayed project preflight cannot override a newer project selection", async () => {
  const oldDirectory = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const loadedFolders = [];
  const errorTitles = [];
  let resetCount = 0;
  const context = {
    window: { api: { readdir(folder) {
      if (folder === "G:/A") {
        startedOldRead();
        return oldDirectory.promise;
      }
      return Promise.resolve({});
    } } },
    resetProjectWorkspaceState() { resetCount += 1; },
    loadWorkspace: async folder => { loadedFolders.push(folder); return true; },
    refreshAssessmentState: async () => {},
    refreshSecurityHistoryIfVisible() {},
    resourceViewerTitle: { textContent: "" },
    projectName: folder => folder.split("/").pop(),
    setAssessmentUiState(_mode, details) { errorTitles.push(details.title); },
  };
  vm.createContext(context);
  vm.runInContext(projectActivationDefinition, context);

  const previousActivation = context.activateProjectWorkspace("G:/A");
  await oldReadStarted;
  assert.equal(await context.activateProjectWorkspace("G:/B"), true);
  oldDirectory.resolve({});
  assert.equal(await previousActivation, false);

  assert.deepEqual(loadedFolders, ["G:/B"]);
  assert.equal(resetCount, 1);
  assert.deepEqual(errorTitles, []);
});

test("a slow file-tree response cannot append the previous project's files to the active tree", async () => {
  const dom = new (require("jsdom").JSDOM)('<div id="file-tree" role="tree"></div>');
  const container = dom.window.document.querySelector("#file-tree");
  const oldDirectory = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const context = {
    document: dom.window.document,
    window: {
      api: {
        readdir(directory) {
          if (directory === "G:/A") {
            startedOldRead();
            return oldDirectory.promise;
          }
          return Promise.resolve([{ name: "B.txt", path: "G:/B/B.txt", isDir: false }]);
        },
      },
    },
    fileTree: container,
    SetiIconTheme: { iconForFile: () => ({ glyph: "f", color: "" }) },
    setExplorerTreeDepth(item, depth) { item.dataset.treeDepth = String(depth); },
    relativePathFromRoot: () => "",
    openWorkspaceContextMenu() {},
    clearTreeDropTargets() {},
    selectItem() {},
    openFile() {},
  };
  vm.createContext(context);
  vm.runInContext(renderTreeDefinition, context);

  const previousTree = context.renderTree("G:/A", container, 0);
  await oldReadStarted;
  await context.renderTree("G:/B", container, 0);
  oldDirectory.resolve([{ name: "A.txt", path: "G:/A/A.txt", isDir: false }]);
  await previousTree;

  assert.deepEqual([...container.querySelectorAll(".tree-name")].map(item => item.textContent), ["B.txt"]);
  dom.window.close();
});

test("a slow directory-map response cannot replace the active project's file context", async () => {
  const oldDirectoryMap = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const context = {
    rootPath: "G:/A",
    dirMapRequestGeneration: 0,
    dirMapCache: "",
    window: {
      api: {
        dirMap(directory) {
          if (directory === "G:/A") {
            startedOldRead();
            return oldDirectoryMap.promise;
          }
          return Promise.resolve({ map: "B.txt" });
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(refreshDirMapDefinition, context);

  const previousMap = context.refreshDirMap();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.refreshDirMap();
  assert.equal(context.dirMapCache, "B.txt");
  oldDirectoryMap.resolve({ map: "A.txt" });
  await previousMap;

  assert.equal(context.dirMapCache, "B.txt");
});

test("a delayed project profile response cannot replace the active project's settings", async () => {
  const oldProfile = deferred();
  let startedOldRead;
  const visible = { projectName: "" };
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const context = {
    rootPath: "G:/A",
    projectProfileLoadGeneration: 0,
    projectProfileWorkspaceGenerations: new Map(),
    projectProfileWriteGenerations: new Map(),
    projectAutosaveTimer: null,
    projectAutosaveRevision: 0,
    projectAutosavePending: null,
    projectSettingsUnavailable: { hidden: true },
    projectSettingsShell: { hidden: true },
    commandSettingsStatus: { textContent: "" },
    projectSettingsForm: null,
    projectSettingsNavButtons: [],
    projectProfileData: null,
    projectProfileExists: false,
    window: { api: { projectProfileGet({ path: workspace }) {
      if (workspace === "G:/A") {
        startedOldRead();
        return oldProfile.promise;
      }
      return Promise.resolve({ profile: { project: { name: "B" } }, exists: true });
    } } },
    clearTimeout() {},
    populateProjectSettings(profile) { visible.projectName = profile.project.name; },
    setProjectSettingsTarget() {},
    loadIdentitySettings: async () => {},
  };
  vm.createContext(context);
  vm.runInContext(projectProfileDefinitions, context);

  const previousLoad = context.loadProjectProfile();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.loadProjectProfile();
  oldProfile.resolve({ profile: { project: { name: "A" } }, exists: true });
  await previousLoad;

  assert.equal(context.projectProfileData.project.name, "B");
  assert.equal(visible.projectName, "B");
});

test("saving project A settings during a switch keeps A's path and form snapshot without changing B's screen", async () => {
  const accountsSaved = deferred();
  const saveCalls = [];
  const visible = { projectName: "B", proxyConfiguredFor: undefined };
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileLoadGeneration: 0,
    projectProfileWorkspaceGenerations: new Map(),
    projectProfileWriteGenerations: new Map(),
    projectProfileWorkspace: "G:/A",
    projectAutosaveRevision: 0,
    commandSettingsStatus: { textContent: "" },
    projectSettingsForm: { querySelector: () => null },
    projectProfileData: { project: { name: "A" } },
    currentFormProfile: { project: { name: "A" } },
    window: { api: { projectProfileSave: async payload => {
      saveCalls.push(payload);
      return { profile: payload.profile };
    } } },
    saveEngagementAccounts: () => accountsSaved.promise,
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    setProjectFieldValue(object, path, value) {
      const [section, field] = path.split(".");
      object[section] ??= {};
      object[section][field] = value;
    },
    populateProjectSettings(profile) { visible.projectName = profile.project.name; },
    loadIdentitySettings: async () => {},
    configureProxyListener: async () => { visible.proxyConfiguredFor = context.rootPath; },
  };
  vm.createContext(context);
  vm.runInContext(projectProfileDefinitions, context);

  const saveA = context.saveProjectProfile();
  context.rootPath = "G:/B";
  context.projectProfileData = { project: { name: "B" } };
  context.currentFormProfile = { project: { name: "B" } };
  visible.projectName = "B";
  context.commandSettingsStatus.textContent = "Project B is ready";
  accountsSaved.resolve({ ok: true, credentialIds: [] });
  await saveA;

  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].path, "G:/A");
  assert.equal(saveCalls[0].profile.project.name, "A");
  assert.equal(context.projectProfileData.project.name, "B");
  assert.equal(visible.projectName, "B");
  assert.equal(context.commandSettingsStatus.textContent, "Project B is ready");
  assert.equal(visible.proxyConfiguredFor, undefined);
});

test("an older manual save response cannot replace a newer save in the same workspace", async () => {
  const oldSave = deferred();
  let startedOldSave;
  const oldSaveStarted = new Promise(resolve => { startedOldSave = resolve; });
  const saveCalls = [];
  const visible = { projectName: "A" };
  let identityRefreshes = 0, proxyRefreshes = 0;
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileLoadGeneration: 1,
    projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
    projectProfileWriteGenerations: new Map(),
    projectProfileWorkspace: "G:/A",
    projectAutosaveRevision: 0,
    commandSettingsStatus: { textContent: "" },
    projectSettingsForm: { querySelector: () => null },
    projectProfileData: { project: { name: "A" } },
    currentFormProfile: { project: { name: "A old" } },
    saveEngagementAccounts: async () => ({ ok: true, credentialIds: [] }),
    window: { api: { projectProfileSave: payload => {
      saveCalls.push(payload);
      if (saveCalls.length === 1) {
        startedOldSave();
        return oldSave.promise;
      }
      return Promise.resolve({ profile: payload.profile });
    } } },
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    setProjectFieldValue(object, path, value) {
      const [section, field] = path.split(".");
      object[section] ??= {};
      object[section][field] = value;
    },
    populateProjectSettings(profile) { visible.projectName = profile.project.name; },
    loadIdentitySettings: async () => { identityRefreshes += 1; },
    configureProxyListener: async () => { proxyRefreshes += 1; },
  };
  vm.createContext(context);
  vm.runInContext(projectProfileDefinitions, context);

  const oldManualSave = context.saveProjectProfile();
  await oldSaveStarted;
  context.currentFormProfile = { project: { name: "A new" } };
  await context.saveProjectProfile();
  assert.equal(context.projectProfileData.project.name, "A new");
  assert.equal(context.commandSettingsStatus.textContent, "Saved outside the project folder");
  assert.equal(identityRefreshes, 1);
  assert.equal(proxyRefreshes, 1);

  oldSave.resolve({ profile: { project: { name: "A stale response" } } });
  await oldManualSave;

  assert.equal(context.projectProfileData.project.name, "A new");
  assert.equal(visible.projectName, "A new");
  assert.equal(context.commandSettingsStatus.textContent, "Saved outside the project folder");
  assert.equal(identityRefreshes, 1);
  assert.equal(proxyRefreshes, 1);
});

test("a delayed identity response cannot render into the active project's settings", async () => {
  const oldIdentities = deferred();
  let startedOldRead;
  const visible = { identityStatus: "", identityProject: "" };
  let context;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  context = {
    rootPath: "G:/A",
    identitySettingsLoadGeneration: 0,
    setIdentitySettingsStatus(status) { visible.identityStatus = status; },
    identityWorkspacePath() { return context.rootPath; },
    window: { api: { identitiesGet({ workspace }) {
      if (workspace === "G:/A") {
        startedOldRead();
        return oldIdentities.promise;
      }
      return Promise.resolve({ project: "B" });
    } } },
    renderIdentitySettings(result) {
      visible.identityProject = result.project;
      return {};
    },
  };
  vm.createContext(context);
  vm.runInContext(identitySettingsDefinition, context);

  const previousLoad = context.loadIdentitySettings();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.loadIdentitySettings();
  oldIdentities.resolve({ project: "A" });
  await previousLoad;

  assert.equal(visible.identityProject, "B");
  assert.equal(visible.identityStatus, "Ready");
});

test("switching projects during account save cannot save the new project's rows into the old project", async () => {
  const firstSave = deferred();
  let startedFirstSave;
  const firstSaveStarted = new Promise(resolve => { startedFirstSave = resolve; });
  const calls = [];
  const dom = new (require("jsdom").JSDOM)(`
    <div id="accounts">
      <div class="engagement-account-row" data-credential-id="A1">
        <input data-account-field="username" value="a-user-1">
        <input data-account-field="password" value="a-pass-1">
        <input data-account-field="role" value="member">
        <input data-account-field="cookie" value="a-cookie-1">
      </div>
      <div class="engagement-account-row" data-credential-id="A2">
        <input data-account-field="username" value="a-user-2">
        <input data-account-field="password" value="a-pass-2">
        <input data-account-field="role" value="admin">
        <input data-account-field="cookie" value="a-cookie-2">
      </div>
    </div>`);
  const state = { rootPath: "G:/A" };
  const rows = [...dom.window.document.querySelectorAll(".engagement-account-row")];
  const context = {
    engagementAccountList: dom.window.document.querySelector("#accounts"),
    identityWorkspacePath: () => state.rootPath,
    window: { api: { credentialSave(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        startedFirstSave();
        return firstSave.promise;
      }
      return Promise.resolve({ value: { credential: { credentialId: "saved-A2" } } });
    } } },
  };
  vm.createContext(context);
  vm.runInContext(engagementAccountsDefinition, context);

  const saving = context.saveEngagementAccounts();
  await firstSaveStarted;
  state.rootPath = "G:/B";
  rows[0].dataset.credentialId = "B1";
  rows[1].dataset.credentialId = "B2";
  for (const [index, row] of rows.entries()) {
    row.querySelector('[data-account-field="username"]').value = `b-user-${index + 1}`;
    row.querySelector('[data-account-field="password"]').value = `b-pass-${index + 1}`;
    row.querySelector('[data-account-field="cookie"]').value = `b-cookie-${index + 1}`;
  }
  firstSave.resolve({ value: { credential: { credentialId: "saved-A1" } } });
  await saving;

  assert.deepEqual(calls.map(call => call.workspace), ["G:/A", "G:/A"]);
  assert.deepEqual(calls.map(call => call.credential.username), ["a-user-1", "a-user-2"]);
  assert.deepEqual(rows.map(row => row.dataset.credentialId), ["B1", "B2"]);
  assert.deepEqual(rows.map(row => row.querySelector('[data-account-field="password"]').value), ["b-pass-1", "b-pass-2"]);
  dom.window.close();
});

test("a superseded account save stops before starting later credential writes", async () => {
  const firstSave = deferred();
  let startedFirstSave;
  const firstSaveStarted = new Promise(resolve => { startedFirstSave = resolve; });
  let current = true;
  const calls = [];
  const account = (index, credentialId) => ({
    row: { dataset: { credentialId } },
    index,
    credentialId,
    usernameInput: { value: `user-${index}` },
    passwordInput: { value: `password-${index}` },
    cookieInput: { value: `cookie-${index}` },
    username: `user-${index}`,
    password: `password-${index}`,
    role: "member",
    cookie: `cookie-${index}`,
  });
  const accounts = [account(0, "A1"), account(1, "A2")];
  const context = {
    engagementAccountList: {},
    identityWorkspacePath: () => "G:/A",
    window: { api: { credentialSave(payload) {
      calls.push(payload);
      startedFirstSave();
      return firstSave.promise;
    } } },
  };
  vm.createContext(context);
  vm.runInContext(engagementAccountsDefinition, context);

  const saving = context.saveEngagementAccounts({ workspace: "G:/A", accounts, isCurrent: () => current });
  await firstSaveStarted;
  current = false;
  firstSave.resolve({ value: { credential: { credentialId: "saved-A1" } } });
  const result = await saving;

  assert.deepEqual(calls.map(call => call.credential.username), ["user-0"]);
  assert.equal(result.stale, true);
  assert.equal(accounts[0].row.dataset.credentialId, "A1");
  assert.equal(accounts[0].passwordInput.value, "password-0");
});

test("a pending autosave keeps its original workspace and form snapshot after a project switch", async () => {
  const saveCalls = [];
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileWorkspace: "G:/A",
    projectProfileLoadGeneration: 1,
    projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
    projectProfileWriteGenerations: new Map(),
    projectProfileData: { project: { name: "A" } },
    currentFormProfile: { project: { name: "A" } },
    currentAccountSnapshots: [{ username: "a-user" }],
    projectSettingsForm: {},
    commandSettingsStatus: { textContent: "" },
    setTimeout: () => 1,
    clearTimeout() {},
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    collectEngagementAccountSnapshots() { return JSON.parse(JSON.stringify(context.currentAccountSnapshots)); },
    saveEngagementAccounts: async ({ workspace, accounts }) => {
      saveCalls.push({ phase: "accounts", workspace, accounts });
      return { ok: true, credentialIds: [] };
    },
    window: { api: { projectProfileSave: async payload => {
      saveCalls.push({ phase: "profile", ...payload });
      return { profile: payload.profile };
    } } },
    setProjectFieldValue() {},
    populateProjectSettings() {},
    loadIdentitySettings: async () => {},
    configureProxyListener: async () => {},
  };
  const autosaveStart = source.indexOf("let projectAutosaveTimer = null;");
  const autosaveEnd = source.indexOf("\nfunction setProjectSettingsTarget", autosaveStart);
  vm.createContext(context);
  vm.runInContext(`${source.slice(autosaveStart, autosaveEnd)}\n${projectProfileDefinitions}`, context);

  context.scheduleProjectProfileAutosave();
  context.rootPath = "G:/B";
  context.projectProfileWorkspace = "G:/B";
  context.projectProfileLoadGeneration = 2;
  context.projectProfileWorkspaceGenerations.set("G:/B", 2);
  context.projectProfileData = { project: { name: "B" } };
  context.currentFormProfile = { project: { name: "B" } };
  context.currentAccountSnapshots = [{ username: "b-user" }];
  context.commandSettingsStatus.textContent = "Project B is ready";
  await context.flushProjectProfileAutosave();

  assert.deepEqual(saveCalls.map(call => call.phase), ["accounts", "profile"]);
  assert.deepEqual(saveCalls.map(call => call.workspace ?? call.path), ["G:/A", "G:/A"]);
  assert.equal(saveCalls[0].accounts[0].username, "a-user");
  assert.equal(saveCalls[1].profile.project.name, "A");
  assert.equal(context.projectProfileData.project.name, "B");
  assert.equal(context.commandSettingsStatus.textContent, "Project B is ready");
});

for (const rejectedOperation of ["credentialSave", "projectProfileSave"]) {
  test(`an autosave reports a rejected ${rejectedOperation} call without rejecting its flush`, async () => {
    const dom = new (require("jsdom").JSDOM)(rejectedOperation === "credentialSave"
      ? `<div id="accounts"><div class="engagement-account-row" data-credential-id="">
          <input data-account-field="username" value="a-user">
          <input data-account-field="password" value="a-pass">
          <input data-account-field="role" value="member">
          <input data-account-field="cookie" value="">
        </div></div>`
      : `<div id="accounts"></div>`);
    const status = { textContent: "Saving automatically…" };
    const context = {
      rootPath: "G:/A",
      projectProfileWorkspace: "G:/A",
      projectProfileLoadGeneration: 1,
      projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
      projectProfileWriteGenerations: new Map([["G:/A", 0]]),
      projectProfileData: { project: { name: "A" } },
      projectSettingsForm: {},
      engagementAccountList: dom.window.document.querySelector("#accounts"),
      commandSettingsStatus: status,
      setTimeout: () => 1,
      clearTimeout() {},
      collectProjectSettings: () => ({ project: { name: "A" } }),
      identityWorkspacePath: () => "G:/A",
      setProjectFieldValue() {},
      populateProjectSettings() {},
      loadIdentitySettings: async () => {},
      configureProxyListener: async () => {},
      window: { api: {
        credentialSave: async () => {
          if (rejectedOperation === "credentialSave") throw new Error("credential storage offline");
          return { ok: true, value: { credential: { credentialId: "saved-A1" } } };
        },
        projectProfileSave: async () => {
          if (rejectedOperation === "projectProfileSave") throw new Error("profile storage offline");
          return { profile: { project: { name: "A" } } };
        },
      } },
    };
    const autosaveStart = source.indexOf("let projectAutosaveTimer = null;");
    const autosaveEnd = source.indexOf("\nfunction setProjectSettingsTarget", autosaveStart);
    vm.createContext(context);
    vm.runInContext(`${source.slice(autosaveStart, autosaveEnd)}\n${projectProfileDefinitions}\n${engagementAccountsDefinition}`, context);

    context.scheduleProjectProfileAutosave();
    await context.flushProjectProfileAutosave();

    assert.equal(status.textContent, rejectedOperation === "credentialSave" ? "credential storage offline" : "profile storage offline");
    assert.equal(vm.runInContext("projectAutosaveRunning", context), false);
    dom.window.close();
  });
}

test("a project B autosave queued during project A's save still runs afterward", async () => {
  const accountsA = deferred();
  let startedAccountsA;
  const accountsAStarted = new Promise(resolve => { startedAccountsA = resolve; });
  const savedProfiles = [];
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileWorkspace: "G:/A",
    projectProfileLoadGeneration: 1,
    projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
    projectProfileWriteGenerations: new Map(),
    projectProfileData: { project: { name: "A" } },
    currentFormProfile: { project: { name: "A" } },
    currentAccountSnapshots: [],
    projectSettingsForm: {},
    commandSettingsStatus: { textContent: "" },
    setTimeout: () => 1,
    clearTimeout() {},
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    collectEngagementAccountSnapshots() { return JSON.parse(JSON.stringify(context.currentAccountSnapshots)); },
    saveEngagementAccounts: async ({ workspace }) => {
      if (workspace === "G:/A") {
        startedAccountsA();
        return accountsA.promise;
      }
      return { ok: true, credentialIds: [] };
    },
    window: { api: { projectProfileSave: async payload => {
      savedProfiles.push({ path: payload.path, name: payload.profile.project.name });
      return { profile: payload.profile };
    } } },
    setProjectFieldValue() {},
    populateProjectSettings() {},
    loadIdentitySettings: async () => {},
    configureProxyListener: async () => {},
  };
  const autosaveStart = source.indexOf("let projectAutosaveTimer = null;");
  const autosaveEnd = source.indexOf("\nfunction setProjectSettingsTarget", autosaveStart);
  vm.createContext(context);
  vm.runInContext(`${source.slice(autosaveStart, autosaveEnd)}\n${projectProfileDefinitions}`, context);

  context.scheduleProjectProfileAutosave();
  const savingA = context.flushProjectProfileAutosave();
  await accountsAStarted;
  context.rootPath = "G:/B";
  context.projectProfileWorkspace = "G:/B";
  context.projectProfileLoadGeneration = 2;
  context.projectProfileWorkspaceGenerations.set("G:/B", 2);
  context.projectProfileData = { project: { name: "B" } };
  context.currentFormProfile = { project: { name: "B" } };
  context.scheduleProjectProfileAutosave();
  await context.flushProjectProfileAutosave();

  accountsA.resolve({ ok: true, credentialIds: [] });
  await savingA;
  await context.flushProjectProfileAutosave();

  assert.deepEqual(savedProfiles, [
    { path: "G:/A", name: "A" },
    { path: "G:/B", name: "B" },
  ]);
});

test("an older A autosave cannot overwrite a newer manual save after switching A to B and back", async () => {
  const accountsA = deferred();
  let startedAccountsA;
  const accountsAStarted = new Promise(resolve => { startedAccountsA = resolve; });
  const savedProfiles = [];
  let accountSaveCount = 0;
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileWorkspace: "G:/A",
    projectProfileLoadGeneration: 1,
    projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
    projectProfileWriteGenerations: new Map(),
    projectProfileData: { project: { name: "A old" } },
    currentFormProfile: { project: { name: "A old" } },
    projectSettingsForm: {},
    commandSettingsStatus: { textContent: "" },
    setTimeout: () => 1,
    clearTimeout() {},
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    collectEngagementAccountSnapshots: () => [],
    saveEngagementAccounts: async () => {
      accountSaveCount += 1;
      if (accountSaveCount === 1) {
        startedAccountsA();
        return accountsA.promise;
      }
      return { ok: true, credentialIds: [] };
    },
    window: { api: { projectProfileSave: async payload => {
      savedProfiles.push({ path: payload.path, name: payload.profile.project.name });
      return { profile: payload.profile };
    } } },
    setProjectFieldValue() {},
    populateProjectSettings() {},
    loadIdentitySettings: async () => {},
    configureProxyListener: async () => {},
  };
  const autosaveStart = source.indexOf("let projectAutosaveTimer = null;");
  const autosaveEnd = source.indexOf("\nfunction setProjectSettingsTarget", autosaveStart);
  vm.createContext(context);
  vm.runInContext(`${source.slice(autosaveStart, autosaveEnd)}\n${projectProfileDefinitions}`, context);

  context.scheduleProjectProfileAutosave();
  const savingOldA = context.flushProjectProfileAutosave();
  await accountsAStarted;
  context.rootPath = "G:/B";
  context.projectProfileLoadGeneration = 2;
  context.projectProfileWorkspaceGenerations.set("G:/B", 2);
  context.projectProfileWorkspace = "G:/B";
  context.rootPath = "G:/A";
  context.projectProfileLoadGeneration = 3;
  context.projectProfileWorkspaceGenerations.set("G:/A", 3);
  context.projectProfileWorkspace = "G:/A";

  await context.saveProjectProfile({
    workspace: "G:/A",
    profileGeneration: 3,
    profile: { project: { name: "A manual" } },
  });
  accountsA.resolve({ ok: true, credentialIds: [] });
  await savingOldA;

  assert.deepEqual(savedProfiles, [{ path: "G:/A", name: "A manual" }]);
});

test("autosave queue drains each workspace's latest snapshot across A to B to A", async () => {
  const accountsA = deferred();
  let signalAccountsA;
  const accountsAStarted = new Promise(resolve => { signalAccountsA = resolve; });
  let hasStartedAccountsA = false;
  const savedProfiles = [];
  let context;
  context = {
    rootPath: "G:/A",
    projectProfileWorkspace: "G:/A",
    projectProfileLoadGeneration: 1,
    projectProfileWorkspaceGenerations: new Map([["G:/A", 1]]),
    projectProfileWriteGenerations: new Map(),
    projectProfileData: { project: { name: "A old" } },
    currentFormProfile: { project: { name: "A old" } },
    projectSettingsForm: {},
    commandSettingsStatus: { textContent: "" },
    setTimeout: () => 1,
    clearTimeout() {},
    collectProjectSettings() { return JSON.parse(JSON.stringify(context.currentFormProfile)); },
    collectEngagementAccountSnapshots: () => [],
    saveEngagementAccounts: async ({ workspace }) => {
      if (workspace === "G:/A" && !hasStartedAccountsA) {
        hasStartedAccountsA = true;
        signalAccountsA();
        return accountsA.promise;
      }
      return { ok: true, credentialIds: [] };
    },
    window: { api: { projectProfileSave: async payload => {
      savedProfiles.push({ path: payload.path, name: payload.profile.project.name });
      return { profile: payload.profile };
    } } },
    setProjectFieldValue() {},
    populateProjectSettings() {},
    loadIdentitySettings: async () => {},
    configureProxyListener: async () => {},
  };
  const autosaveStart = source.indexOf("let projectAutosaveTimer = null;");
  const autosaveEnd = source.indexOf("\nfunction setProjectSettingsTarget", autosaveStart);
  vm.createContext(context);
  vm.runInContext(`${source.slice(autosaveStart, autosaveEnd)}\n${projectProfileDefinitions}`, context);

  context.scheduleProjectProfileAutosave();
  const savingOldA = context.flushProjectProfileAutosave();
  await accountsAStarted;
  context.rootPath = "G:/B";
  context.projectProfileLoadGeneration = 2;
  context.projectProfileWorkspaceGenerations.set("G:/B", 2);
  context.projectProfileWorkspace = "G:/B";
  context.projectProfileData = { project: { name: "B old" } };
  context.currentFormProfile = { project: { name: "B old" } };
  context.scheduleProjectProfileAutosave();
  context.currentFormProfile = { project: { name: "B latest" } };
  context.scheduleProjectProfileAutosave();

  context.rootPath = "G:/A";
  context.projectProfileLoadGeneration = 3;
  context.projectProfileWorkspaceGenerations.set("G:/A", 3);
  context.projectProfileWorkspace = "G:/A";
  context.projectProfileData = { project: { name: "A latest" } };
  context.currentFormProfile = { project: { name: "A latest" } };
  context.scheduleProjectProfileAutosave();

  accountsA.resolve({ ok: true, credentialIds: [] });
  await savingOldA;
  await context.flushProjectProfileAutosave();
  await context.flushProjectProfileAutosave();

  assert.deepEqual(savedProfiles, [
    { path: "G:/B", name: "B latest" },
    { path: "G:/A", name: "A latest" },
  ]);
});

test("a delayed guidance list cannot render entries from a previous project", async () => {
  const oldEntries = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const visibleEntries = [];
  let context;
  context = {
    rootPath: "G:/A",
    guidanceContext: "",
    guidanceContextRequestPath: "",
    guidanceContextPromise: null,
    selectedGuidancePath: "",
    selectedGuidanceScope: "workspace",
    selectedGuidanceContent: "",
    guidanceDraft: null,
    customGuidanceEntries: [],
    window: { api: {
      guidanceEntries({ workspace }) {
        if (workspace === "G:/A") {
          startedOldRead();
          return oldEntries.promise;
        }
        return Promise.resolve({ entries: [{ name: "B rule" }] });
      },
      guidanceContext: async ({ workspace }) => ({ context: `${workspace} context` }),
    } },
    syncCustomSkillSlashCommands() {},
    guidanceEntryKey: entry => `workspace:${entry.name}`,
    renderGuidanceSettings() { visibleEntries.push(context.customGuidanceEntries.map(entry => entry.name)); },
  };
  vm.createContext(context);
  vm.runInContext(guidanceDefinitions, context);

  const previousLoad = context.loadGuidanceSettings();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.loadGuidanceSettings();
  oldEntries.resolve({ entries: [{ name: "A rule" }] });
  await previousLoad;

  assert.deepEqual(context.customGuidanceEntries.map(entry => entry.name), ["B rule"]);
  assert.deepEqual(visibleEntries.at(-1), ["B rule"]);
});

test("a delayed guidance error cannot clear the active project's context", async () => {
  const oldContext = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const context = {
    rootPath: "G:/A",
    guidanceContext: "",
    guidanceContextRequestPath: "",
    guidanceContextPromise: null,
    window: { api: { guidanceContext({ workspace }) {
      if (workspace === "G:/A") {
        startedOldRead();
        return oldContext.promise;
      }
      return Promise.resolve({ context: "B project instructions" });
    } } },
  };
  vm.createContext(context);
  vm.runInContext(guidanceDefinitions, context);

  const previousLoad = context.loadGuidanceContext();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.loadGuidanceContext();
  oldContext.resolve(Promise.reject(new Error("A guidance read failed")));
  await previousLoad;

  assert.equal(context.guidanceContext, "B project instructions");
});

test("a stale guidance context cannot replace the newest request after switching A to B to A", async () => {
  const oldAContext = deferred();
  let startedOldA;
  const oldAStarted = new Promise(resolve => { startedOldA = resolve; });
  let aRequests = 0;
  const context = {
    rootPath: "G:/A",
    guidanceContext: "",
    guidanceContextRequestPath: "",
    guidanceContextPromise: null,
    window: { api: { guidanceContext({ workspace }) {
      if (workspace === "G:/A" && ++aRequests === 1) {
        startedOldA();
        return oldAContext.promise;
      }
      return Promise.resolve({ context: workspace === "G:/A" ? "Latest A instructions" : "B instructions" });
    } } },
  };
  vm.createContext(context);
  vm.runInContext(guidanceDefinitions, context);

  const oldARequest = context.loadGuidanceContext();
  await oldAStarted;
  context.rootPath = "G:/B";
  await context.loadGuidanceContext();
  context.rootPath = "G:/A";
  const latestARequest = context.loadGuidanceContext();
  const sameWorkspaceRequest = context.loadGuidanceContext();
  await Promise.all([latestARequest, sameWorkspaceRequest]);
  oldAContext.resolve({ context: "Stale A instructions" });
  await oldARequest;

  assert.equal(context.guidanceContext, "Latest A instructions");
});
