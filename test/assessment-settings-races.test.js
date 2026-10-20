"use strict";

const { rendererSource, withAppState, rendererDefinitions } = require("./helpers/renderer-source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = rendererSource();
const refreshSettingsDefinition = rendererDefinitions("refreshAssessmentSettingsCache");
const saveSettingsDefinition = rendererDefinitions("saveAssessmentSettings");
const refreshStateDefinition = rendererDefinitions("refreshAssessmentState");
const toggleDefinition = rendererDefinitions("toggleInterceptorCapture");
const proxyConfigureDefinition = rendererDefinitions("configureProxyListener");
const authoritySettingsDefinition = rendererDefinitions("loadAuthoritySettings");
const persistAuthorityDefinition = rendererDefinitions("persistAuthoritySettings");

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("a delayed assessment-settings read cannot replace active interception state", async () => {
  const oldSettings = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  let visibleInterceptOn = null;
  const context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    assessmentSettingsCache: null,
    assessmentSettingsVirtual: false,
    assessmentSettingsRefreshGeneration: 0,
    authoritySettingsData: {},
    window: { api: { assessmentSettings({ path: requested }) {
      if (requested === "G:/A") {
        startedOldRead();
        return oldSettings.promise;
      }
      return Promise.resolve({ settings: { interception: { enabled: false, interceptRequests: false } }, virtual: false });
    } } },
    normalizeAuthoritySettings: value => value,
    syncInterceptorToggleUi(settings) {
      visibleInterceptOn = Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
    },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(refreshSettingsDefinition, context);

  const previousRead = context.refreshAssessmentSettingsCache();
  await oldReadStarted;
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  await context.refreshAssessmentSettingsCache();
  oldSettings.resolve({ settings: { interception: { enabled: true, interceptRequests: true } }, virtual: false });
  await previousRead;

  assert.equal(visibleInterceptOn, false);
  assert.equal(context.assessmentSettingsCache.interception.enabled, false);
});

test("a delayed assessment-settings save cannot replace active project state", async () => {
  const savedA = deferred();
  const writeCalls = [];
  let visibleInterceptOn = false;
  let proxyRefreshCount = 0;
  let context;
  context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    assessmentSettingsCache: { interception: { enabled: false, interceptRequests: false } },
    assessmentSettingsVirtual: false,
    assessmentSettingsRefreshGeneration: 0,
    authoritySettingsData: {},
    AUTHORITY_SETTINGS_KEY: "authority",
    localStorage: { setItem() {} },
    window: { api: { assessmentWriteSettings(payload) {
      writeCalls.push(payload);
      return savedA.promise;
    } } },
    normalizeAuthoritySettings: value => value,
    syncInterceptorToggleUi(settings) {
      visibleInterceptOn = Boolean(settings?.interception?.enabled && settings?.interception?.interceptRequests);
    },
    syncOpenSettingsTabContent() {},
    configureProxyListener: async () => { proxyRefreshCount += 1; },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(saveSettingsDefinition, context);

  const saveARequest = context.saveAssessmentSettings({ interception: { enabled: true, interceptRequests: true } });
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  context.assessmentSettingsCache = { interception: { enabled: false, interceptRequests: false } };
  visibleInterceptOn = false;
  savedA.resolve({ settings: { interception: { enabled: true, interceptRequests: true } } });
  await saveARequest;

  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].path, "G:/A");
  assert.equal(visibleInterceptOn, false);
  assert.equal(context.assessmentSettingsCache.interception.enabled, false);
  assert.equal(proxyRefreshCount, 0);
});

test("superseded assessment refresh cannot reconfigure the active project's proxy", async () => {
  const oldSettings = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  let proxyRefreshCount = 0;
  const titles = [];
  const context = {
    rootPath: "G:/A",
    assessmentPath: "",
    assessmentRefreshSequence: 0,
    assessmentVerification: null,
    assessmentSettingsCache: null,
    assessmentSettingsVirtual: false,
    assessmentSettingsRefreshGeneration: 0,
    BUG_BOUNTY_PATH_KEY: "assessment-path",
    browserWorkspace: { projectChanged() {} },
    localStorage: { setItem() {} },
    window: { api: { assessmentSettings({ path: requested }) {
      if (requested === "G:/A") {
        startedOldRead();
        return oldSettings.promise;
      }
      return Promise.resolve({ settings: { interception: { enabled: false, interceptRequests: false } }, virtual: false });
    } } },
    setAssessmentUiState(_mode, state) { titles.push(state.title); },
    projectName: folder => folder.split("/").pop(),
    syncInterceptorToggleUi() {},
    configureProxyListener: async () => { proxyRefreshCount += 1; },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(`${refreshSettingsDefinition}\n${refreshStateDefinition}`, context);

  const previousRefresh = context.refreshAssessmentState();
  await oldReadStarted;
  context.rootPath = "G:/B";
  await context.refreshAssessmentState();
  oldSettings.resolve({ settings: { interception: { enabled: true, interceptRequests: true } }, virtual: false });
  await previousRefresh;

  assert.equal(context.assessmentPath, "G:/B");
  assert.equal(titles.at(-1), "B");
  assert.equal(proxyRefreshCount, 1);
});

test("a delayed proxy response cannot replace the active project's listener status", async () => {
  const oldProxy = deferred();
  let startedOldRequest;
  const oldRequestStarted = new Promise(resolve => { startedOldRequest = resolve; });
  let visibleProxyStatus = "";
  const context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    proxyConfigurationGeneration: 0,
    window: { api: { proxyConfigure({ assessmentPath }) {
      if (assessmentPath === "G:/A") {
        startedOldRequest();
        return oldProxy.promise;
      }
      return Promise.resolve({ label: "B listener status" });
    } } },
    syncProxyListenerUi(status) { visibleProxyStatus = status.label; },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(proxyConfigureDefinition, context);

  const previousConfiguration = context.configureProxyListener();
  await oldRequestStarted;
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  await context.configureProxyListener();
  oldProxy.resolve({ label: "A listener status" });
  await previousConfiguration;

  assert.equal(visibleProxyStatus, "B listener status");
});

test("a project switch during interceptor refresh does not show an old error in the new project", async () => {
  const oldSettings = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const statusMessages = [];
  let context;
  context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    assessmentSettingsCache: null,
    window: { api: {} },
    refreshAssessmentSettingsCache() {
      startedOldRead();
      return oldSettings.promise;
    },
    setSecurityStatus(message) { statusMessages.push(message); },
    isInterceptionActive: () => false,
    saveAssessmentSettings: async () => ({ settings: {} }),
  };
  vm.createContext(withAppState(context));
  vm.runInContext(toggleDefinition, context);

  const previousToggle = context.toggleInterceptorCapture();
  await oldReadStarted;
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  oldSettings.resolve(null);
  await previousToggle;

  assert.deepEqual(statusMessages, []);
});

test("a delayed authority-settings read cannot replace the active project's authority settings", async () => {
  const oldSettings = deferred();
  let startedOldRead;
  const oldReadStarted = new Promise(resolve => { startedOldRead = resolve; });
  const visibleAuthority = [];
  const context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    assessmentSettingsVirtual: false,
    assessmentSettingsCache: null,
    authoritySettingsLoadGeneration: 0,
    authoritySettingsData: {},
    AUTHORITY_SETTINGS_KEY: "authority",
    localStorage: { getItem: () => JSON.stringify({ superMode: "ask" }) },
    refreshAssessmentSettingsCache() {
      if (context.assessmentPath === "G:/A") {
        startedOldRead();
        return oldSettings.promise;
      }
      return Promise.resolve({ settings: { authority: { superMode: "execute" } } });
    },
    normalizeAuthoritySettings: value => value,
    syncAuthorityLabel() { visibleAuthority.push(context.authoritySettingsData.superMode); },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(authoritySettingsDefinition, context);

  const previousLoad = context.loadAuthoritySettings();
  await oldReadStarted;
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  await context.loadAuthoritySettings();
  oldSettings.resolve(null);
  await previousLoad;

  assert.equal(context.authoritySettingsData.superMode, "execute");
  assert.deepEqual(visibleAuthority, ["execute"]);
});

test("a delayed authority write cannot replace the new project's visible or local settings", async () => {
  const writeA = deferred();
  let startedWriteA;
  const writeAStarted = new Promise(resolve => { startedWriteA = resolve; });
  const storage = new Map([["authority", JSON.stringify({ superMode: "full" })]]);
  const visible = { authority: "A", settings: null };
  const context = {
    rootPath: "G:/A",
    assessmentPath: "G:/A",
    assessmentSettingsCache: { authority: { superMode: "full" }, marker: "A" },
    assessmentSettingsVirtual: false,
    authoritySettingsData: { superMode: "full" },
    authoritySettingsWriteGeneration: 0,
    AUTHORITY_SETTINGS_KEY: "authority",
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: { api: { assessmentWriteSettings({ path, settings }) {
      assert.equal(path, "G:/A");
      startedWriteA();
      return writeA.promise;
    } } },
    normalizeAuthoritySettings: value => value,
    syncAuthorityLabel() { visible.authority = context.authoritySettingsData.superMode; },
    syncOpenSettingsTabContent(settings) { visible.settings = settings.marker; },
    addErrorMessage(message) { visible.error = message; },
  };
  vm.createContext(withAppState(context));
  vm.runInContext(persistAuthorityDefinition, context);

  const previousWrite = context.persistAuthoritySettings();
  await writeAStarted;
  context.rootPath = "G:/B";
  context.assessmentPath = "G:/B";
  context.assessmentSettingsCache = { authority: { superMode: "approve" }, marker: "B" };
  context.authoritySettingsData = { superMode: "approve" };
  storage.set("authority", JSON.stringify({ superMode: "approve" }));
  visible.authority = "approve";
  visible.settings = "B";
  writeA.resolve({ settings: { authority: { superMode: "full" }, marker: "A result" } });
  await previousWrite;

  assert.equal(context.assessmentSettingsCache.marker, "B");
  assert.equal(context.authoritySettingsData.superMode, "approve");
  assert.deepEqual(JSON.parse(storage.get("authority")), { superMode: "approve" });
  assert.equal(visible.authority, "approve");
  assert.equal(visible.settings, "B");
});
