import React, { Component } from "react";
import AppShell from "./AppShell.jsx";
import { LayoutProvider } from "./layout/LayoutContext.jsx";
import LayoutSync from "./layout/LayoutSync.jsx";
import { startRenderer } from "./start-renderer.js";

class FrozenAppShell extends Component {
  shouldComponentUpdate() {
    return false;
  }

  componentDidMount() {
    startRenderer();
  }

  render() {
    return <AppShell />;
  }
}

export default function App() {
  return (
    <>
      <FrozenAppShell />
      <LayoutProvider>
        <LayoutSync />
      </LayoutProvider>
    </>
  );
}
