import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 360;
const SIDEBAR_DEFAULT = 244;
const CHAT_MIN_RATIO = 0.2;
const CHAT_MAX_RATIO = 0.5;
const CHAT_DEFAULT = 513;
const TERMINAL_MIN = 96;
const TERMINAL_DEFAULT = 240;
const EDITOR_MIN_HEIGHT = 120;
const TERMINAL_HEADER_H = 38;
const TERMINAL_MIN_EXPANDED = 96;

const LayoutContext = createContext(null);

function chatMinWidth() {
  return Math.floor(window.innerWidth * CHAT_MIN_RATIO);
}

function chatMaxWidth() {
  return Math.max(chatMinWidth(), Math.floor(window.innerWidth * CHAT_MAX_RATIO));
}

export function LayoutProvider({ children }) {
  globalThis.__XEKUTE_REACT_LAYOUT__ = true;
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalMaximized, setTerminalMaximized] = useState(false);

  const clampSidebar = useCallback((value) => {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
  }, []);

  const clampChat = useCallback((value) => {
    const min = chatMinWidth();
    const max = chatMaxWidth();
    return Math.min(max, Math.max(min, value));
  }, []);

  const clampTerminal = useCallback((value, centerHeight) => {
    const sashH = 1;
    const available = Math.max(0, centerHeight - sashH);
    const max = Math.max(TERMINAL_MIN, available - EDITOR_MIN_HEIGHT);
    return Math.max(TERMINAL_MIN_EXPANDED, Math.min(max, value));
  }, []);

  useEffect(() => {
    globalThis.__XEKUTE_REACT_LAYOUT__ = true;
    return () => {
      delete globalThis.__XEKUTE_REACT_LAYOUT__;
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (!chatCollapsed) {
        setChatWidth((w) => clampChat(w));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [chatCollapsed, clampChat]);

  const value = useMemo(
    () => ({
      sidebarWidth,
      setSidebarWidth,
      sidebarCollapsed,
      setSidebarCollapsed,
      chatWidth,
      setChatWidth,
      chatCollapsed,
      setChatCollapsed,
      terminalHeight,
      setTerminalHeight,
      terminalCollapsed,
      setTerminalCollapsed,
      terminalMaximized,
      setTerminalMaximized,
      clampSidebar,
      clampChat,
      clampTerminal,
      chatMinWidth,
      chatMaxWidth,
      TERMINAL_HEADER_H,
      TERMINAL_MIN_EXPANDED,
      EDITOR_MIN_HEIGHT,
    }),
    [
      sidebarWidth,
      sidebarCollapsed,
      chatWidth,
      chatCollapsed,
      terminalHeight,
      terminalCollapsed,
      terminalMaximized,
      clampSidebar,
      clampChat,
      clampTerminal,
    ],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout must be used within LayoutProvider");
  return ctx;
}
