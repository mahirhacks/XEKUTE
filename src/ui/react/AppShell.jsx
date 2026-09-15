/* AUTO-GENERATED — run: node scripts/convert-ui-to-jsx.mjs */
import React, { memo } from "react";

const MCP_KALI_EXAMPLE = [
  "{",
  '  "mcpServers": {',
  '    "sqlmap": {',
  '      "command": "python3",',
  '      "args": ["server.py"],',
  '      "xekute": {',
  '        "transport": "kali",',
  '        "remoteCwd": "/opt/sqlmap-mcp"',
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

export default memo(function AppShell() {
  return (
    <div id="app-shell">
      <div id="app-topbar">
        <div className="app-brand" aria-label="XEKUTE">
          <img src="./xekute_icon.png" alt="" className="app-brand-icon" />
        </div>
        <nav id="app-menu" aria-label="Application menu">
          <div className="app-menu-item">
            <button type="button" className="app-menu-button" data-menu="files" aria-haspopup="true" aria-expanded="false">File</button>
            <div className="app-menu-dropdown" data-menu-panel="files" role="menu" hidden>
              <button type="button" data-action="create-project" role="menuitem">Create New Project</button>
              <button type="button" data-action="open-project" role="menuitem">Open Existing Project</button>
              <div className="app-menu-separator"></div>
              <button type="button" data-action="new-file" role="menuitem">Create New File</button>
              <button type="button" data-action="new-folder" role="menuitem">Create New Folder</button>
              <div className="app-menu-separator"></div>
              <button type="button" data-action="open-file" role="menuitem">Open File</button>
              <button type="button" data-action="save-file" role="menuitem">Save File <span className="app-menu-shortcut">Ctrl+S</span></button>
              <button type="button" data-action="close-editor" role="menuitem">Close Editor <span className="app-menu-shortcut">Ctrl+W</span></button>
            </div>
          </div>
          <div className="app-menu-item">
            <button type="button" className="app-menu-button" data-menu="edit" aria-haspopup="true" aria-expanded="false">Edit</button>
            <div className="app-menu-dropdown" data-menu-panel="edit" role="menu" hidden>
              <button type="button" data-action="undo" role="menuitem">Undo <span className="app-menu-shortcut">Ctrl+Z</span></button>
              <button type="button" data-action="redo" role="menuitem">Redo <span className="app-menu-shortcut">Ctrl+Y</span></button>
              <div className="app-menu-separator"></div>
              <button type="button" data-action="cut" role="menuitem">Cut <span className="app-menu-shortcut">Ctrl+X</span></button>
              <button type="button" data-action="copy" role="menuitem">Copy <span className="app-menu-shortcut">Ctrl+C</span></button>
              <button type="button" data-action="paste" role="menuitem">Paste <span className="app-menu-shortcut">Ctrl+V</span></button>
              <button type="button" data-action="select-all" role="menuitem">Select All <span className="app-menu-shortcut">Ctrl+A</span></button>
            </div>
          </div>
          <div className="app-menu-item">
            <button type="button" className="app-menu-button" data-menu="view" aria-haspopup="true" aria-expanded="false">View</button>
            <div className="app-menu-dropdown" data-menu-panel="view" role="menu" hidden>
              <button type="button" data-action="zoom-in" role="menuitem">Zoom In <span className="app-menu-shortcut">Ctrl+=</span></button>
              <button type="button" data-action="zoom-out" role="menuitem">Zoom Out <span className="app-menu-shortcut">Ctrl+-</span></button>
              <button type="button" data-action="zoom-reset" role="menuitem">Reset Zoom <span className="app-menu-shortcut">Ctrl+0</span></button>
              <div className="app-menu-separator"></div>
              <button type="button" data-action="toggle-minimap" role="menuitem" aria-checked="false">Show Minimap</button>
              <button type="button" data-action="toggle-terminal" role="menuitem">Toggle Terminal</button>
              <button type="button" data-action="toggle-chat" role="menuitem">Toggle Chat</button>
              <button type="button" data-action="show-project" role="menuitem">Project Workspace</button>
              <button type="button" data-action="show-security" role="menuitem">Security Tools</button>
              <button type="button" data-action="show-settings" role="menuitem">XEKUTE Settings</button>
            </div>
          </div>
          <div className="app-menu-item">
            <button type="button" className="app-menu-button" data-menu="help" aria-haspopup="true" aria-expanded="false">Help</button>
            <div className="app-menu-dropdown" data-menu-panel="help" role="menu" hidden>
              <button type="button" data-action="check-updates" role="menuitem">Check for Updates</button>
              <button type="button" data-action="help-guide" role="menuitem">XEKUTE Guide</button>
              <button type="button" data-action="about" role="menuitem">About XEKUTE</button>
            </div>
          </div>
        </nav>
        <button type="button" id="btn-top-filetree" className="topbar-icon active" title="Toggle file tree" aria-label="Toggle file tree" aria-pressed="true">
          <img className="chrome-icon" src="assets/icons/filetree_collapse_expand_icon.svg" alt="" aria-hidden="true" />
        </button>
        <button type="button" id="command-center" className="command-center" title="Search (Ctrl+F)">
          <span>Search</span>
        </button>
        <div className="app-topbar-spacer"></div>
        <button type="button" id="btn-notifications" className="topbar-icon notification-button" title="Notifications" aria-haspopup="dialog" aria-expanded="false">
          <img className="chrome-icon" src="assets/icons/notification_icon.svg" alt="" aria-hidden="true" /><span id="notification-count" className="notification-count" hidden>0</span>
        </button>
        <div id="notification-panel" className="notification-panel" role="dialog" aria-label="Notifications" hidden>
          <header><div className="notification-panel-heading"><span className="codicon codicon-bell" aria-hidden="true"></span><strong>Notifications</strong></div><button type="button" id="notification-clear" className="icon-btn" title="Clear notifications" aria-label="Clear notifications"><span className="codicon codicon-clear-all"></span></button></header>
          <div id="notification-list" className="notification-list"><div className="notification-empty">No notifications</div></div>
        </div>
        <button type="button" id="btn-top-terminal" className="topbar-icon active" title="Toggle terminal">
          <img className="chrome-icon" src="assets/icons/terminal_collapse_expand_icon.svg" alt="" aria-hidden="true" />
        </button>
        <button type="button" id="btn-top-chat" className="topbar-icon active" title="Toggle AI chat">
          <img className="chrome-icon" src="assets/icons/chat_collapse_expand_icon.svg" alt="" aria-hidden="true" />
        </button>
        <button type="button" id="btn-top-settings" className="topbar-icon" title="XEKUTE Settings">
          <img className="chrome-icon" src="assets/icons/settings_icon.svg" alt="" aria-hidden="true" />
        </button>
        <button type="button" id="btn-window-minimize" className="window-control" title="Minimize">
          <span className="codicon codicon-chrome-minimize"></span>
        </button>
        <button type="button" id="btn-window-maximize" className="window-control" title="Maximize">
          <span className="codicon codicon-chrome-maximize"></span>
        </button>
        <button type="button" id="btn-window-close" className="window-control close" title="Close">
          <span className="codicon codicon-chrome-close"></span>
        </button>
      </div>
      <div id="layout">
        <nav id="activitybar" aria-label="Primary activity">
          <div className="activitybar-primary">
            <button type="button" id="activity-search" className="activity-item" title="Search (Ctrl+F)" aria-label="Search">
              <span className="codicon codicon-search"></span>
            </button>
            <button type="button" id="activity-bugbounty" className="activity-item active" title="Project" aria-label="Project" aria-pressed="true">
              <span className="codicon codicon-folder-library"></span>
            </button>
            <button type="button" id="activity-security" className="activity-item" title="Security Tools" aria-label="Security Tools" aria-pressed="false">
              <span className="codicon codicon-shield"></span>
            </button>
          </div>
        </nav>
    
        <aside id="sidebar">
          <div id="sidebar-titlebar">
            <span id="sidebar-view-title" className="sidebar-view-title">Project</span>
            <button type="button" id="btn-sidebar-more" className="sidebar-title-action" title="Project Actions" aria-label="Project actions">
              <span className="codicon codicon-ellipsis"></span>
            </button>
          </div>
          <div id="explorer-sidebar-view" className="sidebar-view" aria-hidden="false">
            <div id="project-setup" className="project-setup">
              <span className="codicon codicon-folder-library project-setup-icon" aria-hidden="true"></span>
              <strong>No Project Open</strong>
              <p>Create a blank project folder or open an existing folder. XEKUTE does not scaffold files or assessment sections.</p>
              <div className="project-setup-actions">
                <button type="button" id="btn-create-project-sidebar" className="bugbounty-primary-button"><span className="codicon codicon-new-folder"></span><span>Create New Project</span></button>
                <button type="button" id="btn-open-project-sidebar" className="bugbounty-secondary-button"><span className="codicon codicon-folder-opened"></span><span>Open Existing Project</span></button>
              </div>
            </div>
            <div id="sidebar-header" hidden>
              <button type="button" id="explorer-root-toggle" className="explorer-root-toggle" title="Toggle project tree">
                <span id="explorer-root-chevron" className="codicon codicon-chevron-down"></span>
                <span id="explorer-title" className="panel-title" title="">Explorer</span>
              </button>
              <div className="sidebar-actions">
                <button id="btn-new-file" className="icon-btn" title="New File" disabled={true}>
                  <span className="codicon codicon-new-file"></span>
                </button>
                <button id="btn-new-folder" className="icon-btn" title="New Folder" disabled={true}>
                  <span className="codicon codicon-new-folder"></span>
                </button>
                <button id="btn-open-folder" className="icon-btn" title="Open Folder">
                  <span className="codicon codicon-folder-opened"></span>
                </button>
              </div>
            </div>
            <div id="file-tree" role="tree" aria-multiselectable="true"></div>
          </div>
    
          <div id="bugbounty-sidebar-view" className="sidebar-view bugbounty-sidebar-view ide-internal" hidden aria-hidden="true">
            <div className="bugbounty-target-header">
              <span className="codicon codicon-target" aria-hidden="true"></span>
              <span id="bugbounty-target-label" className="bugbounty-target-label">ASSESSMENT</span>
              <button type="button" id="btn-create-project-header" className="icon-btn project-create-header" title="Create New Project" aria-label="Create new project">
                <span className="codicon codicon-add"></span>
              </button>
              <button type="button" id="btn-bugbounty-more" className="icon-btn bugbounty-action" title="Assessment Actions" aria-label="Assessment actions">
                <span className="codicon codicon-ellipsis"></span>
              </button>
            </div>
            <div id="bugbounty-setup" className="bugbounty-setup">
              <span id="bugbounty-state-icon" className="codicon codicon-folder-library bugbounty-setup-icon" aria-hidden="true"></span>
              <strong id="bugbounty-state-title" className="bugbounty-state-title">No Assessment</strong>
              <span id="bugbounty-state-message" className="bugbounty-state-message">No assessment folder is linked.</span>
              <div className="bugbounty-setup-actions">
                <button type="button" id="btn-create-project" className="bugbounty-primary-button">
                  <span className="codicon codicon-folder-library" aria-hidden="true"></span>
                  <span>Create New Project</span>
                </button>
                <button type="button" id="btn-create-assessment" className="bugbounty-secondary-button">
                  <span className="codicon codicon-new-folder" aria-hidden="true"></span>
                  <span>Create Assessment Folder</span>
                </button>
                <button type="button" id="btn-open-assessment" className="bugbounty-secondary-button">
                  <span className="codicon codicon-folder-opened" aria-hidden="true"></span>
                  <span>Open Existing Assessment</span>
                </button>
              </div>
            </div>
            <div id="bugbounty-tree" className="bugbounty-tree" role="tree" aria-label="Bug bounty assessment phases" hidden>
              <div className="bounty-subsection-label"><span>Project Artifacts</span></div>
              <button type="button" className="bounty-report-item" data-bounty-item="project-info" data-bounty-file=".xekute/project_info/index.md" role="treeitem"><span className="codicon codicon-project"></span><span>Project Info</span></button>
              <section className="bounty-phase expanded" data-bounty-section="traffic">
                <button type="button" className="bounty-phase-toggle" aria-expanded="true">
                  <span className="codicon codicon-chevron-right bounty-chevron" aria-hidden="true"></span>
                  <span className="bounty-phase-name">Traffic</span>
                  <span className="bounty-phase-count">0/2</span>
                </button>
                <div className="bounty-phase-items" role="group">
                  <button type="button" className="bounty-tree-item" data-bounty-item="raw-traffic" data-bounty-file="traffic/raw.jsonl" role="treeitem"><span className="bounty-status"></span><span>Raw</span></button>
                  <button type="button" className="bounty-tree-item" data-bounty-item="filtered-traffic" data-bounty-file="traffic/filtered.jsonl" role="treeitem"><span className="bounty-status"></span><span>Filtered</span></button>
                </div>
              </section>
              <div className="bounty-subsection-label bounty-custom-label"><span>Custom</span><span className="bounty-subsection-actions"><button type="button" id="btn-custom-file" className="icon-btn" title="New custom file"><span className="codicon codicon-new-file"></span></button><button type="button" id="btn-custom-folder" className="icon-btn" title="New custom folder"><span className="codicon codicon-new-folder"></span></button></span></div>
              <div id="custom-tree-items" className="custom-tree-items"></div>
            </div>
            <button type="button" id="bugbounty-repair" className="bugbounty-repair" hidden aria-hidden="true" tabIndex="-1">
              <span className="codicon codicon-warning" aria-hidden="true"></span>
              <span id="bugbounty-repair-label">Some files are missing, click here to fix</span>
            </button>
          </div>
        </aside>
    
        <div id="sidebar-resize" className="sash-v" role="separator" tabIndex="0" aria-label="Resize Project sidebar" aria-orientation="vertical" aria-valuemin="200" aria-valuemax="360" aria-valuenow="240"></div>
    
        <div id="center-panel">
          <main id="editor-pane" aria-label="Resource preview">
            <section id="resource-viewer" className="resource-viewer">
              <header className="resource-viewer-header">
                <div className="resource-viewer-heading">
                  <span id="resource-viewer-icon" className="codicon codicon-folder-library" aria-hidden="true"></span>
                  <div>
                    <strong id="resource-viewer-title">Project workspace</strong>
                    <span id="resource-viewer-meta">Open a project, select a file, or use Search to preview content.</span>
                  </div>
                </div>
                <div id="resource-viewer-actions" className="resource-viewer-actions">
                  <button type="button" id="resource-viewer-save" className="icon-btn" title="Save (Ctrl+S)" disabled={true}>
                    <span className="codicon codicon-save" aria-hidden="true"></span>
                  </button>
                  <button type="button" id="resource-viewer-copy" className="icon-btn" title="Copy resource contents" disabled={true}>
                    <span className="codicon codicon-copy" aria-hidden="true"></span>
                  </button>
                </div>
              </header>
              <div id="resource-viewer-empty" className="resource-viewer-empty">
                <img src="./xekute_icon.png" alt="" className="resource-viewer-empty-logo" />
              </div>
              <div id="resource-editor-shell" className="resource-editor-shell">
                <div id="resource-line-numbers" className="resource-line-numbers" aria-hidden="true"></div>
                <textarea id="resource-viewer-content" className="resource-viewer-content" wrap="off" spellCheck="false" aria-label="Workspace editor" hidden></textarea>
              </div>
              <div id="checklist-ui-view" className="checklist-ui-view" hidden>
                <header className="checklist-dashboard">
                  <div><strong id="checklist-framework-name">Security checklist</strong><span id="checklist-framework-version"></span></div>
                  <div id="checklist-progress" className="checklist-progress"></div>
                </header>
                <div className="checklist-filters"><span className="codicon codicon-search"></span><input id="checklist-search" type="search" placeholder="Filter checks, IDs, and categories" /><select id="checklist-status-filter"><option value="all">All statuses</option><option value="not-tested">Not tested</option><option value="in-progress">In progress</option><option value="passed">Passed</option><option value="failed">Failed / observed</option><option value="not-applicable">Not applicable</option><option value="blocked">Blocked</option></select></div>
                <div id="checklist-groups" className="checklist-groups"></div>
              </div>
              <div id="scope-ui-view" className="scope-ui-view" hidden>
                <header className="scope-ui-header"><div><strong id="scope-ui-title">Scope</strong><span id="scope-ui-description"></span></div></header>
                <div id="scope-ui-form" className="scope-ui-form"></div>
              </div>
              <div id="assessment-module-view" className="assessment-module-view" hidden>
                <header className="assessment-module-header">
                  <div><strong id="assessment-module-title">Assessment module</strong><span id="assessment-module-description"></span></div>
                  <div className="assessment-module-actions">
                    <button type="button" id="assessment-module-open-json" className="secondary-button"><span className="codicon codicon-json"></span>Open JSON</button>
                    <button type="button" id="assessment-report-generate" className="secondary-button" hidden><span className="codicon codicon-file-text"></span>Generate report</button>
                    <select id="assessment-run-profile" aria-label="Run role"><option value="agent">Agent</option><option value="ask">Ask</option></select>
                    <button type="button" id="assessment-run-start" className="primary-button"><span className="codicon codicon-play"></span>Start run</button>
                    <button type="button" id="assessment-run-stop" className="secondary-button" disabled={true}><span className="codicon codicon-debug-stop"></span>Stop run</button>
                  </div>
                </header>
                <div id="assessment-module-summary" className="assessment-module-summary"></div>
                <div id="assessment-module-content" className="assessment-module-content"></div>
              </div>
            </section>
            <section id="app-settings-workspace" className="app-settings-workspace" aria-label="XEKUTE Settings" hidden>
              <aside className="app-settings-sidebar">
                <div className="app-settings-profile"><span className="app-settings-avatar">X</span><div><strong id="app-settings-profile-name">Local workspace</strong><small id="app-settings-profile-plan">XEKUTE</small></div></div>
                <label className="app-settings-search"><span className="codicon codicon-search" aria-hidden="true"></span><input id="app-settings-search" type="search" placeholder="Search settings" autoComplete="off" spellCheck="false" aria-label="Search settings" /></label>
                <nav className="app-settings-tabs" aria-label="Settings sections">
                  <div className="app-settings-nav-group">
                    <button type="button" className="active" data-app-settings-section="general" aria-label="General" aria-pressed="true"><span className="codicon codicon-settings-gear"></span><span>General</span></button>
                    <button type="button" data-app-settings-section="project" aria-label="Project" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/project_file_icon.svg" alt="" aria-hidden="true" /><span>Project</span></button>
                  </div>
                  <div className="app-settings-nav-divider" aria-hidden="true"></div>
                  <div className="app-settings-nav-group">
                    <button type="button" data-app-settings-section="authority" aria-label="Agents" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/agents_icon.svg" alt="" aria-hidden="true" /><span>Agents</span></button>
                  </div>
                  <div className="app-settings-nav-divider" aria-hidden="true"></div>
                  <div className="app-settings-nav-group">
                    <button type="button" data-app-settings-section="llm" aria-label="Models" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/models_icon.svg" alt="" aria-hidden="true" /><span>Models</span></button>
                    <button type="button" data-app-settings-section="prompts" aria-label="Rules, Skills, Subagents" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/rulesnskillnsubagent_icon.svg" alt="" aria-hidden="true" /><span>Rules, Skills, Subagents</span></button>
                    <button type="button" data-app-settings-section="commands" aria-label="Tools and MCPs" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/tools_icon.svg" alt="" aria-hidden="true" /><span>Tools &amp; MCPs</span></button>
                    <button type="button" data-app-settings-section="certificates" aria-label="Browser &amp; Network" aria-pressed="false"><img className="settings-nav-icon" src="assets/icons/browse.svg" alt="" aria-hidden="true" /><span>Browser &amp; Network</span></button>
                  </div>
                </nav>
              </aside>
              <div className="app-settings-main">
                <header className="app-settings-workspace-header"><div><span className="codicon codicon-settings-gear" aria-hidden="true"></span><div><strong id="app-settings-page-title">General</strong><small id="app-settings-page-subtitle"></small></div></div><div className="app-settings-workspace-actions"><span id="command-settings-status" hidden>Ready</span></div></header>
                <div className="app-settings-content">
              <section id="app-settings-general-panel" className="app-settings-panel general-settings-panel">
                <div className="general-settings-canvas">
    
                  <h2 className="general-settings-section-title">Interface</h2>
                  <section className="general-settings-card general-settings-list">
                    <div className="general-settings-row">
                      <div><strong>Status Bar</strong><p>Show status bar at the bottom of the window</p></div>
                      <label className="general-toggle" aria-label="Show status bar"><input id="general-status-bar-toggle" type="checkbox" defaultChecked /><span aria-hidden="true"></span></label>
                    </div>
                  </section>
                  <h2 className="general-settings-section-title">Updates</h2>
                  <section className="general-settings-card general-settings-list">
                    <div className="general-settings-row">
                      <div><strong>Check for updates automatically</strong><p>XEKUTE checks GitHub for a new version each time it starts. You can still check manually from the Help menu.</p></div>
                      <label className="general-toggle" aria-label="Check for updates automatically"><input id="general-updates-toggle" type="checkbox" defaultChecked /><span aria-hidden="true"></span></label>
                    </div>
                    <div className="general-settings-divider" aria-hidden="true"></div>
                    <div className="general-settings-row">
                      <div><strong>Current version</strong><p id="general-current-version">Loading current version…</p></div>
                    </div>
                  </section>
                </div>
              </section>
              <section id="app-settings-project-panel" className="app-settings-panel project-settings-panel">
                <div id="project-settings-unavailable" className="project-settings-unavailable" hidden>
                  <span className="codicon codicon-folder-library" aria-hidden="true"></span>
                  <h2>Open a project to configure its engagement</h2>
                  <p>Project settings are linked to a folder without creating files inside it.</p>
                  <div><button type="button" id="project-settings-create" className="primary-button">Create New Project</button><button type="button" id="project-settings-open" className="secondary-button">Open Existing Project</button></div>
                </div>
                <div id="project-settings-shell" className="project-settings-shell">
                  <aside className="project-settings-nav" aria-label="Project settings sections">
                    <div className="project-settings-identity"><span className="codicon codicon-folder-library"></span><div><strong id="project-settings-name">Project</strong><small id="project-settings-root"></small></div></div>
                    <button type="button" className="active" data-project-settings-target="project-settings-overview"><span className="codicon codicon-dashboard"></span>Overview</button>
                    <button type="button" data-project-settings-target="project-settings-engagement"><span className="codicon codicon-organization"></span>Engagement</button>
                    <button type="button" data-project-settings-target="project-settings-authorization"><span className="codicon codicon-verified"></span>Authorization</button>
                    <button type="button" data-project-settings-target="project-settings-scope"><span className="codicon codicon-target"></span>Scope &amp; ROE</button>
                    <button type="button" data-project-settings-target="project-settings-context"><span className="codicon codicon-book"></span>Context</button>
                    <button type="button" data-project-settings-target="project-settings-data"><span className="codicon codicon-lock"></span>Data Handling</button>
                    <aside className="project-storage-note"><span className="codicon codicon-shield"></span><p>Saved in protected XEKUTE app data. The project folder stays untouched.</p></aside>
                  </aside>
                  <main id="project-settings-form" className="project-settings-form">
                    <section id="project-settings-overview" className="project-settings-section">
                      <header><div><span className="codicon codicon-dashboard"></span><div><h2>Project Overview</h2><p>Identify this engagement clearly across operators, clients, and reporting.</p></div></div><span className="project-settings-badge">App-managed</span></header>
                      <div className="project-settings-card">
                        <div className="project-field-grid">
                          <label className="wide">Project name<input data-project-field="project.name" maxLength="240" autoComplete="off" /></label>
                          <label>Project code<input data-project-field="project.code" maxLength="120" placeholder="ENG-2026-001" /></label>
                          <label>Status<select data-project-field="project.status"><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option></select></label>
                          <label>Classification<select data-project-field="project.classification"><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
                          <label className="wide">Description<textarea data-project-field="project.description" rows="3" placeholder="Purpose, owner, and concise project summary"></textarea></label>
                          <label className="wide">Tags <small>One per line</small><textarea data-project-field="project.tags" data-project-kind="array" rows="3" placeholder="web&#10;external&#10;priority"></textarea></label>
                        </div>
                      </div>
                    </section>
    
                    <section id="project-settings-engagement" className="project-settings-section">
                      <header><div><span className="codicon codicon-organization"></span><div><h2>Professional Engagement</h2><p>Record who owns the work, why it is being performed, and what must be delivered.</p></div></div></header>
                      <div className="project-settings-card">
                        <div className="project-field-grid">
                          <label>Engagement name<input data-project-field="engagement.name" /></label>
                          <label>Client/Asset Owner<input data-project-field="engagement.clientOrOwner" /></label>
                          <label>Program name<input data-project-field="engagement.programName" /></label>
                          <label>Platform/Portal<input data-project-field="engagement.platform" /></label>
                          <label>Engagement type<select data-project-field="engagement.engagementType"><option value="penetration-test">Penetration test</option><option value="bug-bounty">Bug bounty</option><option value="vulnerability-assessment">Vulnerability assessment</option><option value="red-team">Red team</option><option value="security-review">Security review</option></select></label>
                          <label>Environment<select data-project-field="engagement.environment"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="mixed">Mixed</option></select></label>
                          <label>Methodology<input data-project-field="engagement.methodology" placeholder="OWASP WSTG / PTES / client standard" /></label>
                          <label>Time Zone<input data-project-field="engagement.timezone" placeholder="UTC or Asia/Kuala_Lumpur" /></label>
                          <label className="wide">Execution path<select data-project-field="engagement.executionModel"><option value="operator_choice">Ask me when browser state changes the approach</option><option value="browser_bound">Use the shared browser for stateful or JS-gated work</option><option value="standard">Use normal scoped tools</option></select><small>This is operator guidance. Shared browser state is not exported to command-line scanners.</small></label>
                          <label>Start date<input type="date" data-project-field="engagement.startDate" /></label>
                          <label>End date<input type="date" data-project-field="engagement.endDate" /></label>
                          <label className="wide">Objective<textarea data-project-field="engagement.objective" rows="4" placeholder="Business and security objectives"></textarea></label>
                          <label>Success criteria <small>One per line</small><textarea data-project-field="engagement.successCriteria" data-project-kind="array" rows="5"></textarea></label>
                          <label>Deliverables <small>One per line</small><textarea data-project-field="engagement.deliverables" data-project-kind="array" rows="5" placeholder="Technical report&#10;Executive summary&#10;Retest memo"></textarea></label>
                       </div>
                      </div>
                      <section className="engagement-subsection engagement-authentication-accounts" aria-labelledby="engagement-authentication-title">
                        <h3 id="engagement-authentication-title">Authentication Accounts</h3>
                        <div id="engagement-account-list" className="engagement-account-list"></div>
                        <button type="button" id="engagement-account-add" className="engagement-account-add">Add more +</button>
                      </section>
                      <div className="project-settings-card">
                        <h3>Contacts &amp; Reporting</h3>
                        <div className="project-field-grid">
                          <label>Primary Contact<input data-project-field="contacts.primary" /></label>
                          <label>Emergency Contact<input data-project-field="contacts.emergency" /></label>
                          <label>Escalation window<input data-project-field="contacts.escalationWindow" placeholder="Business hours / immediate for critical" /></label>
                          <label>Report Recipients<input data-project-field="contacts.reportRecipients" data-project-kind="array" /></label>
                          <label className="wide">Notification Preferences<textarea data-project-field="contacts.notificationPreferences" rows="4"></textarea></label>
                        </div>
                      </div>
                    </section>
    
                    <section id="project-settings-authorization" className="project-settings-section">
                      <header><div><span className="codicon codicon-verified"></span><div><h2>Authorization &amp; Review</h2><p>Record the engagement authorization and review metadata. Runtime tool access is determined by the active mode and configured scope.</p></div></div></header>
                      <div className="project-settings-card project-critical-card">
                        <div className="project-toggle-grid">
                          <label><input type="checkbox" data-project-field="authorization.confirmed" data-project-kind="boolean" /><span><strong>Written Authorization Confirmed</strong><small>Confirms the named owner has authorized this work.</small></span></label>
                          <label><input type="checkbox" data-project-field="review.scopeReviewed" data-project-kind="boolean" /><span><strong>In-scope targets reviewed</strong><small>Every target and wildcard has been checked.</small></span></label>
                          <label><input type="checkbox" data-project-field="review.exclusionsConfirmed" data-project-kind="boolean" /><span><strong>Exclusions confirmed</strong><small>Out-of-scope and third-party assets are understood.</small></span></label>
                          <label><input type="checkbox" data-project-field="review.thirdPartyRiskReviewed" data-project-kind="boolean" /><span><strong>Third-party risk reviewed</strong><small>Ownership and dependent services have been considered.</small></span></label>
                          <label><input type="checkbox" data-project-field="review.rulesAccepted" data-project-kind="boolean" /><span><strong>Rules of Engagement accepted</strong><small>Windows, techniques, limits, and stop conditions are approved.</small></span></label>
                        </div>
                        <div className="project-field-grid">
                          <label>Authorized by<input data-project-field="authorization.authorizedBy" /></label>
                          <label>Authorization reference<input data-project-field="authorization.authorizationReference" placeholder="Contract, ticket, URL, or document ID" /></label>
                          <label>Signed at<input type="datetime-local" data-project-field="authorization.signedAt" /></label>
                          <label>Expires at<input type="datetime-local" data-project-field="authorization.expiresAt" /></label>
                          <label>Reviewed by<input data-project-field="review.reviewedBy" /></label>
                          <label>Reviewed at<input type="datetime-local" data-project-field="review.reviewedAt" /></label>
                          <label className="wide">Authorization evidence references <small>One per line; references only, no files are copied</small><textarea data-project-field="authorization.evidenceReferences" data-project-kind="array" rows="4"></textarea></label>
                        </div>
                      </div>
                    </section>
    
                    <section id="project-settings-scope" className="project-settings-section">
                      <header><div><span className="codicon codicon-target"></span><div><h2>Scope &amp; Rules of Engagement</h2><p>Define a strict allowlist, exclusions, operating limits, techniques, and emergency stops.</p></div></div></header>
                      <div className="project-settings-card">
                        <h3>Scope boundaries</h3>
                        <div className="project-field-grid">
                          <label>In-scope targets <small>One host, URL, or CIDR per line</small><textarea data-project-field="scope.inScopeTargets" data-project-kind="array" rows="8" placeholder="https://app.example.com&#10;api.example.com/v1&#10;203.0.113.0/28"></textarea></label>
                          <label>Out-of-scope targets <small>One rule per line</small><textarea data-project-field="scope.outOfScopeTargets" data-project-kind="array" rows="8"></textarea></label>
                          <label>Wildcard rules <small>Use *.example.com</small><textarea data-project-field="scope.wildcardRules" data-project-kind="array" rows="5"></textarea></label>
                          <label>Third-party assets <small>One dependency per line</small><textarea data-project-field="scope.thirdPartyAssets" data-project-kind="array" rows="5"></textarea></label>
                          <label>Authentication dependencies <small>Login-only hosts; never added to normal assessment scope</small><textarea data-project-field="scope.authenticationDependencies" data-project-kind="array" rows="5" placeholder="login.example.com&#10;https://idp.example.com/oauth"></textarea></label>
                          <label className="wide">Scope notes<textarea data-project-field="scope.notes" rows="4"></textarea></label>
                        </div>
                      </div>
                      <div className="project-settings-card">
                        <h3>Operating limits</h3>
                        <div className="project-field-grid compact">
                          <label>Maximum concurrency<input type="number" min="1" max="100" data-project-field="rulesOfEngagement.maximumConcurrency" data-project-kind="number" /></label>
                          <label>Requests / second<input type="number" min="0.1" max="1000" step="0.1" data-project-field="rulesOfEngagement.requestsPerSecond" data-project-kind="number" /></label>
                          <label>Request timeout (seconds)<input type="number" min="1" max="300" data-project-field="rulesOfEngagement.requestTimeoutSeconds" data-project-kind="number" /></label>
                          <label>Approved source IPs <small>One per line</small><textarea data-project-field="rulesOfEngagement.sourceIpAddresses" data-project-kind="array" rows="4"></textarea></label>
                          <label>Testing windows <small>One per line: Mon,Tue | 09:00-17:00</small><textarea data-project-field="rulesOfEngagement.testingWindows" data-project-kind="array" rows="4"></textarea></label>
                          <label>Emergency stop contact<input data-project-field="rulesOfEngagement.emergencyStopContact" /></label>
                        </div>
                        <div className="project-toggle-grid project-capability-grid">
                        </div>
                      </div>
                      <div className="project-settings-card">
                        <h3>Technique boundaries</h3>
                        <div className="project-field-grid">
                          <label>Allowed technique IDs <small>One adapter or technique ID per line</small><textarea data-project-field="rulesOfEngagement.allowedTechniques" data-project-kind="array" rows="6" placeholder="httpx&#10;nmap&#10;T1595"></textarea></label>
                          <label>Restricted techniques <small>One per line</small><textarea data-project-field="rulesOfEngagement.restrictedTechniques" data-project-kind="array" rows="6"></textarea></label>
                          <label>Prohibited actions <small>One per line</small><textarea data-project-field="rulesOfEngagement.prohibitedActions" data-project-kind="array" rows="7"></textarea></label>
                          <label>Stop conditions <small>One per line</small><textarea data-project-field="rulesOfEngagement.stopConditions" data-project-kind="array" rows="7"></textarea></label>
                        </div>
                      </div>
                    </section>
    
                    <section id="project-settings-context" className="project-settings-section">
                      <header><div><span className="codicon codicon-book"></span><div><h2>Application &amp; Engagement Context</h2><p>Keep app and engagement context in app-managed Project Settings.</p></div></div></header>
                      <div className="project-settings-card">
                        <div className="project-field-grid">
                          <label className="wide">Background<textarea data-project-field="context.background" rows="4" placeholder="Business purpose, history, and why this assessment is happening"></textarea></label>
                          <label className="wide">Application overview<textarea data-project-field="context.applicationOverview" rows="5" placeholder="Primary workflows, trust boundaries, sensitive operations, and data"></textarea></label>
                          <label className="wide">Architecture<textarea data-project-field="context.architecture" rows="5" placeholder="Components, hosting, networks, APIs, integrations, and data flows"></textarea></label>
                          <label>Technology stack <small>One item per line</small><textarea data-project-field="context.technologyStack" data-project-kind="array" rows="5"></textarea></label>
                          <label>Known user roles <small>One role per line</small><textarea data-project-field="context.userRoles" data-project-kind="array" rows="5"></textarea></label>
                          <label className="wide">Authentication and session model<textarea data-project-field="context.authentication" rows="4"></textarea></label>
                          <label className="wide">Test account reference <small>Reference a secure vault entry; do not paste secrets</small><input data-project-field="context.testAccountReference" placeholder="Vault path, ticket, or handoff reference" /></label>
                          <label>Known constraints <small>One per line</small><textarea data-project-field="context.knownConstraints" data-project-kind="array" rows="5"></textarea></label>
                          <label>Repositories <small>One path or URL per line</small><textarea data-project-field="context.repositories" data-project-kind="array" rows="5"></textarea></label>
                          <label className="wide">Documentation references <small>One path, URL, or document ID per line</small><textarea data-project-field="context.documentation" data-project-kind="array" rows="4"></textarea></label>
                          <label className="wide">Operator notes<textarea data-project-field="context.notes" rows="5"></textarea></label>
                        </div>
                      </div>
                    </section>
    
                    <section id="project-settings-data" className="project-settings-section">
                      <header><div><span className="codicon codicon-lock"></span><div><h2>Evidence &amp; Data Handling</h2><p>Document how sensitive assessment material must be collected, stored, retained, and removed.</p></div></div></header>
                      <div className="project-settings-card">
                        <div className="project-toggle-grid">
                          <label><input type="checkbox" data-project-field="dataHandling.collectMinimumNecessary" data-project-kind="boolean" /><span><strong>Collect minimum necessary data</strong><small>Avoid retaining unrelated client or personal data.</small></span></label>
                          <label><input type="checkbox" data-project-field="dataHandling.redactSecrets" data-project-kind="boolean" /><span><strong>Redact secrets</strong><small>Mask credentials, tokens, and session material in evidence.</small></span></label>
                          <label><input type="checkbox" data-project-field="dataHandling.encryptAtRest" data-project-kind="boolean" /><span><strong>Encrypt at rest</strong><small>Use approved encrypted storage for sensitive evidence.</small></span></label>
                        </div>
                        <div className="project-field-grid">
                          <label>Retention days<input type="number" min="0" max="3650" data-project-field="dataHandling.retentionDays" data-project-kind="number" /></label>
                          <label>Evidence classification<select data-project-field="dataHandling.classification"><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option></select></label>
                          <label className="wide">Deletion and handoff procedure<textarea data-project-field="dataHandling.deletionProcedure" rows="5" placeholder="Approved handoff, retention expiry, secure deletion, and confirmation steps"></textarea></label>
                        </div>
                      </div>
                    </section>
                  </main>
                </div>
              </section>
              <section id="app-settings-commands-panel" className="app-settings-panel guidance-settings-panel" hidden>
                <div className="guidance-customize-page tools-settings-page">
                  <header className="guidance-page-header">
                    <div className="guidance-page-heading">
                      <span className="codicon codicon-tools" aria-hidden="true"></span>
                      <div><h2>Tools &amp; MCPs</h2><p>Manage MCP servers and the tools they expose to the agent</p></div>
                    </div>
                    <div id="mcp-settings-tabs" className="guidance-scope-tabs" role="tablist" aria-label="MCP scope">
                      <button type="button" role="tab" data-mcp-scope="all" aria-selected="true">All</button>
                      <button type="button" role="tab" data-mcp-scope="project" aria-selected="false">Project</button>
                      <button type="button" role="tab" data-mcp-scope="global" aria-selected="false">Global</button>
                    </div>
                  </header>
                  <div id="mcp-settings-list" className="guidance-settings-list"></div>
                  <section id="kali-access-panel" className="mcp-connection-editor kali-access-panel">
                    <header>
                      <div>
                        <h3>Local Kali access</h3>
                        <p>Reuse one SSH connection for MCP servers running inside your local Kali VM.</p>
                      </div>
                      <label className="kali-access-switch"><input id="kali-access-enabled" type="checkbox" /><span aria-hidden="true"></span><strong>Enable</strong></label>
                    </header>
                    <form id="kali-access-form" autoComplete="off">
                      <div id="kali-access-fields" hidden>
                        <div className="mcp-form-grid">
                          <label>Kali host or IP<input id="kali-access-host" maxLength="253" spellCheck="false" placeholder="192.168.56.20" /></label>
                          <label>SSH port<input id="kali-access-port" type="number" min="1" max="65535" defaultValue="22" /></label>
                          <label>SSH username<input id="kali-access-username" maxLength="64" spellCheck="false" defaultValue="kali" placeholder="kali" /></label>
                          <label>Connection type<input defaultValue="SSH key or Windows SSH agent" disabled /></label>
                          <label className="wide">SSH private key<div className="mcp-key-row"><input id="kali-access-key" maxLength="32768" spellCheck="false" placeholder="Optional when your SSH agent already has the key" /><button type="button" id="kali-access-key-browse">Browse…</button></div></label>
                        </div>
                        <div className="mcp-form-options">
                          <label><input id="kali-access-accept-host-key" type="checkbox" defaultChecked /><span><strong>Trust a new SSH host key</strong><small>Accepts the first key but still rejects a changed key.</small></span></label>
                        </div>
                        <div className="mcp-form-note"><span className="codicon codicon-shield"></span><p>Password login is intentionally unsupported. Credentials and remote tool output are not stored in the MCP configuration.</p></div>
                        <details className="mcp-setup-help">
                          <summary>Using Kali-hosted MCP servers</summary>
                          <ol>
                            <li>Start the Kali VM and run <code>sudo systemctl enable --now ssh</code>.</li>
                            <li>Connect from Windows once with <code>ssh kali@KALI_IP</code>, then configure key authentication or your SSH agent.</li>
                            <li>Add each server normally in <code>mcp.json</code>. Set <code>xekute.transport</code> to <code>kali</code>; its command and arguments then run through this connection.</li>
                            <li>Allowlist the server's exact tool names in the relevant skill Markdown so XEKUTE can lease them to the agent.</li>
                            <li>The remote command must start an MCP server. A CLI such as SQLMap requires an MCP wrapper; enabling Kali access does not expose arbitrary shell commands.</li>
                          </ol>
                          <pre><code>{MCP_KALI_EXAMPLE}</code></pre>
                        </details>
                        <div id="kali-access-status" className="mcp-connection-status">Enter the Kali SSH connection details.</div>
                        <footer>
                          <button type="button" id="kali-access-open-mcp">Open MCP JSON</button>
                          <span></span>
                          <button type="button" id="kali-access-test">Test SSH access</button>
                        </footer>
                      </div>
                    </form>
                  </section>
                </div>
              </section>
              <section id="app-settings-authority-panel" className="app-settings-panel authority-settings-panel" hidden>
                <section className="agent-subagent-settings" aria-label="Sub-agent model">
                  <h2>Sub-agent model</h2>
                  <select id="models-explore-subagent" className="models-select" aria-label="Sub-agent model"></select>
                </section>
              </section>
              <section id="app-settings-prompts-panel" className="app-settings-panel guidance-settings-panel" hidden>
                <div className="guidance-customize-page rules-settings-page">
                  <header className="guidance-page-header">
                    <div className="guidance-page-heading">
                      <span className="codicon codicon-symbol-keyword" aria-hidden="true"></span>
                      <div><h2>Rules, Skills, Subagents</h2><p>Provide domain-specific knowledge and workflows for the agent</p></div>
                    </div>
                    <div id="guidance-scope-tabs" className="guidance-scope-tabs" role="tablist" aria-label="Guidance scope">
                      <button type="button" role="tab" data-guidance-scope="all" aria-selected="true">All</button>
                      <button type="button" role="tab" data-guidance-scope="project" aria-selected="false">Project</button>
                      <button type="button" role="tab" data-guidance-scope="global" aria-selected="false">Global</button>
                    </div>
                  </header>
                  <div id="guidance-settings-list" className="guidance-settings-list"></div>
                </div>
              </section>
              <section id="app-settings-llm-panel" className="app-settings-panel models-settings-panel" hidden>
                <div className="models-customize-page">
                  <section className="models-catalog-section" aria-labelledby="models-catalog-title">
                    <header className="settings-redesign-section-heading">
                      <div><h3 id="models-catalog-title">Available models</h3><p>Choose the models shown in chat and agent model selectors.</p></div>
                    </header>
                    <div className="models-search-row">
                      <input id="models-settings-search" type="text" spellCheck="false" placeholder="Add or search model" aria-label="Add or search model" />
                      <button type="button" id="models-settings-refresh" className="models-refresh-btn" title="Refresh models" aria-label="Refresh models"><span className="codicon codicon-refresh"></span></button>
                    </div>
                    <div id="models-settings-list" className="models-settings-list" aria-live="polite"></div>
                    <button type="button" id="models-view-all" className="models-view-all" hidden>View more</button>
                  </section>
    
                  <details id="models-api-keys" className="models-api-keys" open>
                    <summary className="models-api-keys-summary"><span><strong>Providers &amp; API keys</strong><small>Configure the active inference provider and its connection details.</small></span><span className="codicon codicon-chevron-down" aria-hidden="true"></span></summary>
                    <div className="models-api-keys-body">
                      <div className="models-api-row">
                        <div>
                          <strong>Active provider</strong>
                          <p>Only one provider is used for chat, agents, model listing, and verification.</p>
                        </div>
                        <select id="llm-provider" className="models-select" aria-label="Active LLM provider">
                          <option value="ollama">Ollama</option>
                          <option value="openrouter">OpenRouter</option>
                        </select>
                      </div>
                      <input type="radio" name="llm-provider" id="llm-provider-ollama" value="ollama" hidden aria-hidden="true" />
                      <input type="radio" name="llm-provider" id="llm-provider-openrouter" value="openrouter" hidden aria-hidden="true" />
    
                      <div id="llm-openrouter-config" className="models-api-provider-block" hidden>
                        <div className="models-api-row models-api-row-toggle">
                          <div>
                            <strong>OpenRouter API Key</strong>
                            <p>You can put in your OpenRouter key to use hosted models at cost.</p>
                            <span id="llm-openrouter-key-status" className="models-secret-status" hidden>Secret saved</span>
                          </div>
                          <label className="general-toggle" aria-label="Use OpenRouter API key"><input id="llm-openrouter-key-toggle" type="checkbox" /><span aria-hidden="true"></span></label>
                        </div>
                        <div id="llm-openrouter-key-fields" className="models-api-fields" hidden>
                          <input id="openrouter-api-key" type="password" autoComplete="off" spellCheck="false" placeholder="Secret saved. Enter a new key to replace it" aria-label="OpenRouter API key" />
                        </div>
                        <div className="models-api-row models-api-row-toggle">
                          <div>
                            <strong>Override OpenRouter Base URL</strong>
                            <p>Change the base URL for OpenRouter API requests.</p>
                          </div>
                          <label className="general-toggle" aria-label="Override OpenRouter base URL"><input id="llm-openrouter-base-toggle" type="checkbox" /><span aria-hidden="true"></span></label>
                        </div>
                        <div id="llm-openrouter-base-fields" className="models-api-fields" hidden>
                          <input id="openrouter-base-url" type="url" spellCheck="false" placeholder="https://openrouter.ai/api/v1" aria-label="OpenRouter base URL" />
                        </div>
                        <input id="openrouter-model" type="hidden" aria-hidden="true" />
                      </div>
    
                      <div id="llm-ollama-config" className="models-api-provider-block">
                        <div className="models-api-row models-api-row-toggle">
                          <div>
                            <strong>Enable Ollama</strong>
                            <p>Use your local or remote Ollama server for chat, agents, and model listing.</p>
                          </div>
                          <label className="general-toggle" aria-label="Enable Ollama"><input id="llm-ollama-enable-toggle" type="checkbox" defaultChecked /><span aria-hidden="true"></span></label>
                        </div>
                        <div className="models-api-row models-api-row-toggle">
                          <div>
                            <strong>Custom Ollama endpoint</strong>
                            <p>Override the default <code>http://127.0.0.1:11435</code> endpoint.</p>
                            <span id="llm-ollama-endpoint-status" className="models-secret-status" hidden>Endpoint saved</span>
                          </div>
                          <label className="general-toggle" aria-label="Use custom Ollama endpoint"><input id="llm-ollama-endpoint-toggle" type="checkbox" /><span aria-hidden="true"></span></label>
                        </div>
                        <div id="llm-ollama-endpoint-fields" className="models-api-fields" hidden>
                          <input id="ollama-host-input" type="url" spellCheck="false" placeholder="http://127.0.0.1:11435" aria-label="Ollama API base URL" />
                        </div>
                        <div className="models-api-actions">
                          <button type="button" id="ollama-host-test" className="secondary-button"><span className="codicon codicon-pulse"></span>Test Ollama</button>
                          <button type="button" id="ollama-host-reset" className="secondary-button">Use local default</button>
                        </div>
                        <div className="models-api-status-grid">
                          <div><strong>Active endpoint</strong><code id="ollama-active-endpoint">http://127.0.0.1:11435</code> <span id="ollama-location-badge" className="models-location-badge">Default</span></div>
                          <div><strong>Connection status</strong><span id="ollama-connection-status">Not tested</span></div>
                        </div>
                      </div>
    
                      <div className="models-api-actions models-api-actions-footer llm-provider-actions">
                        <button type="button" id="llm-settings-test" className="secondary-button">Test provider</button>
                      </div>
                      <p id="llm-settings-status" className="models-api-status">Ready</p>
                    </div>
                  </details>
                </div>
              </section>
              <section id="app-settings-certificates-panel" className="app-settings-panel certificate-settings-panel" hidden>
                <div className="certificate-settings-content browser-network-page">
                  <header className="settings-redesign-section-heading"><div><h3>Proxy certificate</h3></div></header>
                  <section className="certificate-settings-card">
                    <div className="certificate-setting-heading"><div><strong>Central CA storage folder</strong><small>All assessment proxy listeners use this location. The private key is never copied into an assessment.</small></div><span id="certificate-location-badge" className="certificate-location-badge">Default</span></div>
                    <div className="certificate-location-row"><input id="certificate-directory" type="text" readOnly aria-label="Central CA storage folder" /><button type="button" id="certificate-browse" className="secondary-button"><span className="codicon codicon-folder-opened"></span>Choose folder</button></div>
                    <div className="certificate-setting-actions"><button type="button" id="certificate-open-folder" className="secondary-button"><span className="codicon codicon-folder"></span>Open folder</button><button type="button" id="certificate-reset" className="secondary-button">Use default location</button></div>
                  </section>
                </div>
              </section>
                </div>
              </div>
            </section>
            <section id="security-workspace" className="security-workspace" aria-label="Security workspace" hidden>
              <header className="security-workspace-header">
                <div className="security-workspace-heading">
                  <span className="codicon codicon-shield" aria-hidden="true"></span>
                  <div>
                    <strong>Security Workbench</strong>
                  </div>
                </div>
                <div id="security-workspace-tools" className="security-workspace-tools">
                  <div id="security-proxy-browser-wrap" className="security-proxy-browser-wrap">
                    <button type="button" id="security-proxy-browser" className="security-proxy-browser" aria-label="Open browser through XEKUTE proxy" title="Open browser through XEKUTE proxy" aria-haspopup="menu" aria-expanded="false">
                      <span className="codicon codicon-globe" aria-hidden="true"></span>
                      <span>Browser</span>
                    </button>
                    <div id="security-proxy-browser-menu" className="security-proxy-browser-menu" role="menu" hidden></div>
                  </div>
                  <button type="button" id="security-history-toggle" className="security-history-toggle" aria-pressed="false" title="Show Traffic/Raw history">
                    <span className="codicon codicon-history" aria-hidden="true"></span>
                    <span>History</span>
                  </button>
                </div>
              </header>
              <div id="security-workspace-body" className="security-workspace-body">
                <section id="security-history-panel" className="security-history-panel" aria-label="HTTP history" hidden>
                  <header className="security-history-header">
                    <div>
                      <strong>HTTP History</strong>
                      <span id="security-history-summary">Traffic/Raw</span>
                    </div>
                    <button type="button" id="security-history-refresh" className="security-workbench-icon" title="Refresh history" aria-label="Refresh history">
                      <span className="codicon codicon-refresh"></span>
                    </button>
                  </header>
                  <div className="security-history-table-wrap">
                    <table className="security-history-table">
                      <thead>
                        <tr>
                          <th scope="col" data-history-sort="number" aria-sort="none"><button type="button"><span>#</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="host" aria-sort="none"><button type="button"><span>Host</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="method" aria-sort="none"><button type="button"><span>Method</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="path" aria-sort="none"><button type="button"><span>URL</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="params" aria-sort="none"><button type="button"><span>Params</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="status" aria-sort="none"><button type="button"><span>Status</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="length" aria-sort="none"><button type="button"><span>Length</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="mime" aria-sort="none"><button type="button"><span>MIME type</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="tool" aria-sort="none"><button type="button"><span>Tool</span><i className="codicon codicon-chevron-down"></i></button></th>
                          <th scope="col" data-history-sort="time" aria-sort="descending"><button type="button"><span>Time</span><i className="codicon codicon-chevron-down"></i></button></th>
                        </tr>
                      </thead>
                      <tbody id="security-history-rows"></tbody>
                    </table>
                    <div id="security-history-empty" className="security-history-empty">Open an assessment to load Traffic/Raw history.</div>
                  </div>
                </section>
                <div id="security-workbench-resize" className="sash-h security-workbench-resize" role="separator" tabIndex="0" aria-label="Resize HTTP history" aria-orientation="horizontal" aria-valuemin="120" aria-valuemax="800" aria-valuenow="280" title="Drag or use arrow keys to resize"></div>
              </div>
            </section>
            <section id="webclone-workspace" className="webclone-workspace" aria-label="WebClone workspace" hidden>
              <header className="webclone-workspace-header">
                <div className="webclone-heading"><span className="codicon codicon-globe"></span><div><strong>WebClone</strong><small>Build a local, reviewable copy of authorized public pages and their text assets.</small></div></div>
                <div className="webclone-actions"><input id="webclone-target" className="webclone-target" type="url" placeholder="https://authorized-target" aria-label="Authorized WebClone target" /><span id="webclone-status" className="webclone-status">No clone built</span><button type="button" id="webclone-build-action" className="primary-button"><span className="codicon codicon-cloud-download"></span>Build</button><button type="button" id="webclone-preview-action" className="secondary-button" disabled={true}><span className="codicon codicon-play"></span>Preview</button></div>
              </header>
              <div id="webclone-empty" className="webclone-empty"><span className="codicon codicon-globe"></span><strong>No WebClone yet</strong><p>Build from an in-scope HTTPS target. XEKUTE downloads bounded text assets for review and keeps the original assessment untouched.</p></div>
              <div id="webclone-content" className="webclone-content" hidden>
                <section className="webclone-editor-pane"><header><span id="webclone-file-title">index.html</span><span id="webclone-file-meta"></span></header><pre id="webclone-file-content" tabIndex="0" aria-label="WebClone file contents"></pre></section>
                <section className="webclone-preview-pane" hidden><header><strong>Website preview</strong><button type="button" id="webclone-preview-close" className="icon-btn" title="Show file" aria-label="Show file"><span className="codicon codicon-close"></span></button></header><div id="webclone-preview-frame" className="webclone-preview-surface" aria-label="WebClone preview"></div></section>
                <aside className="webclone-files"><header><strong>Files</strong><span><span id="webclone-file-count">0</span><button type="button" id="webclone-files-toggle" className="icon-btn" title="Collapse files" aria-label="Collapse files"><span className="codicon codicon-chevron-right"></span></button></span></header><div id="webclone-file-list" role="tree" aria-label="WebClone files"></div></aside>
              </div>
            </section>
            <div id="editor-tab-bar" hidden></div>
            <div id="editor-path-bar" className="editor-path-bar" hidden><span id="editor-path-label" className="editor-path-label"></span></div>
            <div id="editor-body" hidden>
              <div id="editor-empty">
                <img src="./xekute_icon.png" alt="" className="resource-viewer-empty-logo" />
              </div>
              <div id="editor-view" hidden>
                <div id="settings-editor-toolbar" className="settings-editor-toolbar" hidden>
                  <div className="settings-editor-title"><span className="codicon codicon-settings-gear"></span><span>Assessment Settings</span></div>
                  <div className="settings-view-switch" role="group" aria-label="Settings editor view">
                    <button type="button" id="settings-view-json" className="active" aria-pressed="true">JSON</button>
                    <button type="button" id="settings-view-ui" aria-pressed="false">UI</button>
                  </div>
                </div>
                <div id="monaco-container"></div>
                <div id="markdown-preview" className="markdown-file-preview assistant-reply" hidden aria-label="Rendered Markdown preview"></div>
                <div id="settings-ui-view" className="settings-ui-view" hidden>
                  <div className="settings-ui-content">
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-radio-tower"></span><div><h2>Proxy Listener</h2><p>Local interface used by the assessment interception workbench.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-listener-enabled">Listener enabled</label><input id="setting-listener-enabled" type="checkbox" data-setting-path="listener.enabled" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-bind-address">Bind address</label><input id="setting-bind-address" type="text" data-setting-path="listener.bindAddress" /></div>
                      <div className="settings-row"><label htmlFor="setting-listener-port">Port</label><input id="setting-listener-port" type="number" min="1" max="65535" step="1" data-setting-path="listener.port" data-setting-type="number" /></div>
                      <div className="settings-row"><label htmlFor="setting-http2">HTTP/2 support</label><input id="setting-http2" type="checkbox" data-setting-path="listener.supportHttp2" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label>Listener status</label><output id="proxy-listener-status" className="proxy-listener-status">Stopped</output></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-lock"></span><div><h2>TLS</h2><p>Certificate and upstream verification behavior.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-tls-enabled">TLS interception</label><input id="setting-tls-enabled" type="checkbox" data-setting-path="tls.enabled" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-certificate-mode">Certificate mode</label><select id="setting-certificate-mode" data-setting-path="tls.certificateMode"><option value="project-ca">Project CA</option><option value="custom">Custom certificate</option><option value="passthrough">Passthrough</option></select></div>
                      <div className="settings-row"><label htmlFor="setting-min-tls">Minimum TLS version</label><select id="setting-min-tls" data-setting-path="tls.minimumVersion"><option>TLSv1.2</option><option>TLSv1.3</option></select></div>
                      <div className="settings-row"><label htmlFor="setting-verify-upstream">Verify upstream certificates</label><input id="setting-verify-upstream" type="checkbox" data-setting-path="tls.verifyUpstreamCertificates" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label>Project CA certificate</label><div className="settings-inline-action"><input id="proxy-ca-path" type="text" readOnly defaultValue="Generated when the listener starts" /><button type="button" id="btn-show-proxy-ca" title="Show CA certificate"><span className="codicon codicon-folder-opened"></span></button></div></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-shield"></span><div><h2>Authorization</h2><p>Confirm written permission before sending traffic from Repeater, Intruder, or Interceptor.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-auth-confirmed">Authorization confirmed</label><input id="setting-auth-confirmed" type="checkbox" data-setting-path="authorization.confirmed" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-authorized-by">Authorized by</label><input id="setting-authorized-by" type="text" data-setting-path="authorization.authorizedBy" placeholder="Program owner or approver" /></div>
                      <div className="settings-row"><label htmlFor="setting-auth-reference">Authorization reference</label><input id="setting-auth-reference" type="text" data-setting-path="authorization.authorizationReference" placeholder="Ticket, email, or program URL" /></div>
                      <div className="settings-row"><label htmlFor="setting-auth-signed-at">Signed at</label><input id="setting-auth-signed-at" type="text" data-setting-path="authorization.signedAt" placeholder="YYYY-MM-DD" /></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-debug-disconnect"></span><div><h2>Interception</h2><p>Control which HTTP messages stop in the Interceptor.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-interception-enabled">Intercept traffic</label><input id="setting-interception-enabled" type="checkbox" data-setting-path="interception.enabled" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-intercept-requests">Intercept requests</label><input id="setting-intercept-requests" type="checkbox" data-setting-path="interception.interceptRequests" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-intercept-responses">Intercept responses</label><input id="setting-intercept-responses" type="checkbox" data-setting-path="interception.interceptResponses" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-only-scope">Only intercept in-scope targets</label><input id="setting-only-scope" type="checkbox" data-setting-path="interception.onlyInScope" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-content-length">Update Content-Length</label><input id="setting-content-length" type="checkbox" data-setting-path="interception.automaticallyUpdateContentLength" data-setting-type="boolean" /></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-globe"></span><div><h2>Requests and Upstream Proxy</h2><p>Network limits used by Repeater and Intruder.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-request-timeout">Request timeout (seconds)</label><input id="setting-request-timeout" type="number" min="1" max="30" data-setting-path="requests.timeoutSeconds" data-setting-type="number" /></div>
                      <div className="settings-row"><label htmlFor="setting-max-response">Maximum response bytes</label><input id="setting-max-response" type="number" min="1024" max="1000000" data-setting-path="requests.maximumResponseBytes" data-setting-type="number" /></div>
                      <div className="settings-row"><label htmlFor="setting-upstream-enabled">Use upstream proxy</label><input id="setting-upstream-enabled" type="checkbox" data-setting-path="upstreamProxy.enabled" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-upstream-url">Upstream proxy URL</label><input id="setting-upstream-url" type="url" data-setting-path="upstreamProxy.url" placeholder="http://127.0.0.1:8081" /></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-symbol-event"></span><div><h2>Intruder</h2><p>Bounded automated request behavior.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-intruder-limit">Maximum requests per run</label><input id="setting-intruder-limit" type="number" min="1" max="25" data-setting-path="intruder.maximumRequestsPerRun" data-setting-type="number" /></div>
                      <div className="settings-row"><label htmlFor="setting-intruder-delay">Delay between requests (ms)</label><input id="setting-intruder-delay" type="number" min="500" max="60000" data-setting-path="intruder.delayBetweenRequestsMs" data-setting-type="number" /></div>
                      <div className="settings-row"><label htmlFor="setting-stop-error">Stop on error</label><input id="setting-stop-error" type="checkbox" data-setting-path="intruder.stopOnError" data-setting-type="boolean" /></div>
                    </section>
                    <section className="settings-group">
                      <div className="settings-group-heading"><span className="codicon codicon-output"></span><div><h2>Traffic Logging</h2><p>Evidence retained in Traffic/Raw and Traffic/Filtered.</p></div></div>
                      <div className="settings-row"><label htmlFor="setting-log-raw">Log raw traffic</label><input id="setting-log-raw" type="checkbox" data-setting-path="logging.logRawTraffic" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-log-filtered">Log filtered traffic</label><input id="setting-log-filtered" type="checkbox" data-setting-path="logging.logFilteredTraffic" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-log-bodies">Include message bodies</label><input id="setting-log-bodies" type="checkbox" data-setting-path="logging.includeBodies" data-setting-type="boolean" /></div>
                      <div className="settings-row"><label htmlFor="setting-redact-auth">Redact Authorization headers</label><input id="setting-redact-auth" type="checkbox" data-setting-path="logging.redactAuthorizationHeaders" data-setting-type="boolean" /></div>
                    </section>
                  </div>
                </div>
                <div id="editor-error" hidden></div>
              </div>
            </div>
          </main>
    
          <div id="terminal-resize" className="sash-h" role="separator" tabIndex="0" aria-label="Resize terminal panel" aria-orientation="horizontal" aria-valuemin="96" aria-valuemax="800" aria-valuenow="240"></div>
    
          <section id="terminal-pane">
            <div id="terminal-header">
              <div className="terminal-panel-tabs" role="tablist" aria-label="Panel views">
                <button type="button" id="terminal-shell-tab" className="terminal-panel-tab active" role="tab" aria-selected="true">Terminal</button>
              </div>
              <div id="security-tool-switcher" className="security-tool-switcher" hidden>
                <button type="button" id="security-tool-button" className="security-tool-button" aria-haspopup="menu" aria-expanded="false" title="Security tool">
                  <span id="security-tool-icon" className="codicon codicon-shield" aria-hidden="true"></span>
                  <span id="security-tool-label">Security Tools</span>
                  <span className="codicon codicon-chevron-down security-tool-chevron" aria-hidden="true"></span>
                </button>
                <div id="security-tool-menu" className="security-tool-menu" role="menu" hidden>
                  <button type="button" className="security-tool-option" data-security-tool="interceptor" role="menuitemradio" aria-checked="false">
                    <span className="codicon codicon-debug-disconnect"></span><span><strong>Interceptor</strong><small>Capture, modify, then forward</small></span><span className="codicon codicon-check"></span>
                  </button>
                  <button type="button" className="security-tool-option" data-security-tool="repeater" role="menuitemradio" aria-checked="false">
                    <span className="codicon codicon-sync"></span><span><strong>Repeater</strong><small>Edit and resend requests</small></span><span className="codicon codicon-check"></span>
                  </button>
                  <button type="button" className="security-tool-option" data-security-tool="intruder" role="menuitemradio" aria-checked="false">
                    <span className="codicon codicon-symbol-event"></span><span><strong>Intruder</strong><small>Payload-position testing</small></span><span className="codicon codicon-check"></span>
                  </button>
                </div>
                <button type="button" id="security-analyze-button" className="security-analyze-button" title="Analyze request and response with AI" aria-label="Analyze exchange with AI" hidden>
                  <span className="codicon codicon-copilot security-analyze-icon" aria-hidden="true"></span>
                </button>
              </div>
              <div className="terminal-actions">
                <button type="button" id="terminal-active-session" className="terminal-session-button terminal-shell-action" title="Select terminal or shell" aria-haspopup="menu" aria-expanded="false" disabled={true}>
                  <span className="codicon codicon-terminal"></span>
                  <span id="terminal-active-name">Terminal</span>
                  <span className="codicon codicon-chevron-down terminal-session-chevron"></span>
                </button>
                <button type="button" id="btn-terminal-new" className="icon-btn terminal-action terminal-shell-action" title="New Terminal">
                  <span className="codicon codicon-add"></span>
                </button>
                <button type="button" id="btn-terminal-new-menu" className="icon-btn terminal-action terminal-shell-action" title="New terminal with profile" aria-haspopup="menu" aria-expanded="false">
                  <span className="codicon codicon-chevron-down"></span>
                </button>
                <button id="btn-terminal-split" className="icon-btn terminal-action terminal-shell-action" title="Split Terminal" disabled={true}>
                  <span className="codicon codicon-split-horizontal"></span>
                </button>
                <button id="btn-terminal-clear" className="icon-btn terminal-action terminal-shell-action" title="Clear Terminal" disabled={true}>
                  <span className="codicon codicon-clear-all"></span>
                </button>
                <button id="btn-terminal-kill" className="icon-btn terminal-action terminal-shell-action" title="Kill Terminal" disabled={true}>
                  <span className="codicon codicon-trash"></span>
                </button>
                <button id="btn-terminal-more" className="icon-btn terminal-action" title="More terminal actions" aria-haspopup="menu" aria-expanded="false">
                  <span className="codicon codicon-ellipsis"></span>
                </button>
                <button id="btn-terminal-maximize" className="icon-btn terminal-action" title="Maximize Panel">
                  <span className="codicon codicon-chevron-up"></span>
                </button>
                <button id="btn-terminal-close" className="icon-btn terminal-action" title="Close Panel">
                  <span className="codicon codicon-close"></span>
                </button>
              </div>
              <div id="terminal-session-menu" className="terminal-session-menu" role="menu" hidden></div>
              <div id="terminal-more-menu" className="terminal-more-menu" role="menu" hidden>
                <button type="button" data-terminal-more-action="split" role="menuitem">Split Terminal</button>
                <button type="button" data-terminal-more-action="clear" role="menuitem">Clear Terminal</button>
                <button type="button" data-terminal-more-action="kill" role="menuitem">Kill Terminal</button>
              </div>
            </div>
            <div id="terminal-body">
              <div id="terminal-viewport">
                <div id="terminal-empty" hidden></div>
              </div>
              <div id="security-workbench" className="security-workbench" hidden>
                <div className="security-workbench-toolbar">
                  <div className="security-workbench-state">
                    <span id="security-workbench-mode" className="security-workbench-mode">Interceptor</span>
                    <span id="security-workbench-status" className="security-workbench-status">Ready</span>
                  </div>
                  <div id="security-repeater-history" className="security-repeater-history" hidden>
                    <button type="button" id="security-repeater-prev" className="security-workbench-icon" title="Previous response" aria-label="Previous response"><span className="codicon codicon-chevron-left"></span></button>
                    <span id="security-repeater-position" className="security-repeater-position">0 / 0</span>
                    <button type="button" id="security-repeater-next" className="security-workbench-icon" title="Next response" aria-label="Next response"><span className="codicon codicon-chevron-right"></span></button>
                  </div>
                  <button type="button" id="security-intercept-toggle" className="security-intercept-toggle" title="Pause or resume request interception" hidden>
                    <span id="security-intercept-toggle-icon" className="codicon codicon-debug-pause" aria-hidden="true"></span>
                    <span id="security-intercept-toggle-label">Intercept Off</span>
                  </button>
                  <button type="button" id="security-run-button" className="security-run-button"><span className="codicon codicon-play"></span><span id="security-run-label">Forward</span></button>
                  <button type="button" id="security-clear-button" className="security-workbench-icon" title="Clear exchange" aria-label="Clear exchange"><span className="codicon codicon-clear-all"></span></button>
                  <button type="button" id="security-drop-button" className="security-drop-button" title="Drop intercepted request" hidden><span className="codicon codicon-circle-slash"></span><span>Drop</span></button>
                </div>
                <div className="security-workbench-main">
                  <div className="security-workbench-center">
                    <div id="security-repeater-tabs" className="security-repeater-tabs" hidden>
                      <div id="security-repeater-tab-list" className="security-repeater-tab-list" role="tablist" aria-label="Workbench tabs"></div>
                      <button type="button" id="security-repeater-add" className="security-repeater-add" title="New tab" aria-label="New tab"><span className="codicon codicon-add"></span></button>
                    </div>
                    <div id="security-intruder-panel" className="security-intruder-panel" hidden>
                      <nav className="security-subtabs" role="tablist" aria-label="Intruder sections">
                        <button type="button" className="active" data-intruder-tab="positions" role="tab" aria-selected="true"><span>Positions</span><span id="security-positions-count" className="security-subtab-badge">0</span></button>
                        <button type="button" data-intruder-tab="payloads" role="tab" aria-selected="false"><span>Payloads</span><span id="security-payloads-count" className="security-subtab-badge">0</span></button>
                        <button type="button" data-intruder-tab="results" role="tab" aria-selected="false"><span>Results</span><span id="security-results-count" className="security-subtab-badge">0</span></button>
                      </nav>
                      <section className="security-intruder-section" data-intruder-panel="positions">
                        <div className="security-attack-picker" role="radiogroup" aria-label="Attack type">
                          <button type="button" className="active" data-attack-type="sniper" role="radio" aria-checked="true"><strong>Sniper</strong><small>One position at a time</small></button>
                          <button type="button" data-attack-type="battering-ram" role="radio" aria-checked="false"><strong>Battering Ram</strong><small>Same payload everywhere</small></button>
                          <button type="button" data-attack-type="pitchfork" role="radio" aria-checked="false"><strong>Pitchfork</strong><small>Sets advance together</small></button>
                          <button type="button" data-attack-type="cluster-bomb" role="radio" aria-checked="false"><strong>Cluster Bomb</strong><small>Every combination</small></button>
                        </div>
                        <div className="security-position-bar">
                          <div className="security-position-actions">
                            <button type="button" id="security-position-mark" className="security-mini-button"><span className="codicon codicon-symbol-variable"></span>Mark selection</button>
                            <button type="button" id="security-position-auto" className="security-mini-button"><span className="codicon codicon-lightbulb"></span>Auto-detect</button>
                            <button type="button" id="security-position-clear" className="security-mini-button"><span className="codicon codicon-clear-all"></span>Clear all</button>
                          </div>
                          <div id="security-position-chips" className="security-position-chips" aria-live="polite"></div>
                        </div>
                      </section>
                      <section className="security-intruder-section" data-intruder-panel="payloads" hidden>
                        <div className="security-payload-toolbar">
                          <span id="security-payload-hint" className="security-payload-hint">Mark a payload position first.</span>
                          <button type="button" id="security-payload-json-toggle" className="security-mini-button" aria-pressed="false"><span className="codicon codicon-json"></span>Raw JSON</button>
                        </div>
                        <div id="security-payload-sets" className="security-payload-sets"></div>
                        <div id="security-payload-panel" className="security-payload-panel" hidden>
                          <label htmlFor="security-payload-editor">Payload sets (JSON)</label>
                          <textarea id="security-payload-editor" spellCheck="false" aria-label="Intruder payload sets" defaultValue='{"value":["test"]}'></textarea>
                        </div>
                      </section>
                      <section className="security-intruder-section security-results-section" data-intruder-panel="results" hidden>
                        <div className="security-results-wrap">
                          <table className="security-results-table">
                            <thead><tr><th>#</th><th>Payload</th><th>Status</th><th>Length</th><th>Time</th></tr></thead>
                            <tbody id="security-results-rows"></tbody>
                          </table>
                          <div id="security-results-empty" className="security-results-empty">Run an attack to collect results.</div>
                        </div>
                      </section>
                    </div>
                    <div className="security-exchange" id="security-exchange">
                      <section className="security-message-pane security-request-pane">
                        <header><span>Request</span><span id="security-request-size">0 B</span></header>
                        <textarea id="security-request-editor" spellCheck="false" aria-label="Raw HTTP request" placeholder="GET / HTTP/1.1&#10;Host: authorized.example&#10;Accept: */*"></textarea>
                      </section>
                      <div id="security-exchange-sash" className="security-exchange-sash sash-v" role="separator" aria-label="Resize request and response panels" aria-orientation="vertical" tabIndex="0"></div>
                      <section className="security-message-pane security-response-pane">
                        <header><span>Response</span><span id="security-response-size">0 B</span></header>
                        <textarea id="security-response-editor" spellCheck="false" aria-label="Raw HTTP response" readOnly placeholder="Response appears here"></textarea>
                      </section>
                    </div>
                  </div>
                  <aside id="security-inspector" className="security-inspector collapsed" aria-label="Inspector utilities">
                    <button type="button" id="security-inspector-toggle" className="security-inspector-toggle" aria-expanded="false" title="Open Inspector"><span className="codicon codicon-inspect"></span><span>Inspector</span></button>
                    <div id="security-inspector-panel" className="security-inspector-panel" hidden>
                      <header className="security-inspector-header"><div><strong>Inspector</strong><small id="security-inspector-context">Local decode and analysis tools</small></div><button type="button" id="security-inspector-close" className="icon-btn" title="Close Inspector"><span className="codicon codicon-close"></span></button></header>
                      <nav className="security-inspector-tabs" aria-label="Inspector tools">
                        <button type="button" className="active" data-inspector-tab="decoder" aria-pressed="true">Decoder</button>
                        <button type="button" data-inspector-tab="jwt" aria-pressed="false">JWT</button>
                        <button type="button" data-inspector-tab="cookies" aria-pressed="false">Cookies</button>
                      </nav>
                      <div className="security-inspector-content">
                        <section className="security-inspector-tool" data-inspector-panel="decoder">
                          <div className="inspector-source-actions"><button type="button" data-inspector-source="selection">Selection</button><button type="button" data-inspector-source="request">Request</button><button type="button" data-inspector-source="response">Response</button></div>
                          <label>Transform<select id="inspector-decoder-format"><option value="url-component">URL component</option><option value="url">Full URL</option><option value="base64">Base64</option><option value="base64url">Base64URL</option><option value="html">HTML entities</option><option value="hex">Hex</option><option value="json">JSON</option></select></label>
                          <label>Input<textarea id="inspector-decoder-input" spellCheck="false" placeholder="Paste or load a value"></textarea></label>
                          <div className="inspector-action-row"><button type="button" id="inspector-decode">Decode / Format</button><button type="button" id="inspector-encode">Encode / Minify</button><button type="button" id="inspector-swap">Swap</button></div>
                          <label>Output<textarea id="inspector-decoder-output" spellCheck="false" readOnly></textarea></label>
                          <button type="button" id="inspector-copy-output" className="inspector-wide-action"><span className="codicon codicon-copy"></span>Copy output</button>
                        </section>
                        <section className="security-inspector-tool" data-inspector-panel="jwt" hidden>
                          <div className="inspector-source-actions"><button type="button" data-jwt-source="request">Find in request</button><button type="button" data-jwt-source="response">Find in response</button></div>
                          <label>JWT<textarea id="inspector-jwt-token" spellCheck="false" placeholder="eyJhbGciOi..."></textarea></label>
                          <div className="inspector-action-row"><button type="button" id="inspector-jwt-decode">Decode &amp; analyze</button><button type="button" id="inspector-jwt-copy">Copy token</button></div>
                          <div id="inspector-jwt-analysis" className="inspector-analysis-empty">Load a JWT to inspect its algorithm, claims, lifetime, and signature state.</div>
                          <label>Header JSON<textarea id="inspector-jwt-header" spellCheck="false" defaultValue='{"alg":"HS256","typ":"JWT"}'></textarea></label>
                          <label>Payload JSON<textarea id="inspector-jwt-payload" spellCheck="false" defaultValue="{}"></textarea></label>
                          <div className="inspector-two-column"><label>Algorithm<select id="inspector-jwt-alg"><option>HS256</option><option>HS384</option><option>HS512</option><option value="none">none</option></select></label><label>HMAC secret<input id="inspector-jwt-secret" type="password" autoComplete="off" placeholder="Local only" /></label></div>
                          <div className="inspector-action-row"><button type="button" id="inspector-jwt-sign">Encode / Sign</button><button type="button" id="inspector-jwt-verify">Verify signature</button></div>
                        </section>
                        <section className="security-inspector-tool" data-inspector-panel="cookies" hidden>
                          <div className="inspector-source-actions"><button type="button" data-cookie-source="request">Request Cookie</button><button type="button" data-cookie-source="response">Response Set-Cookie</button></div>
                          <label>Cookie data<textarea id="inspector-cookie-input" spellCheck="false" placeholder="session=...; theme=dark"></textarea></label>
                          <div className="inspector-action-row"><button type="button" id="inspector-cookie-analyze">Analyze</button><button type="button" id="inspector-cookie-decode">Decode values</button><button type="button" id="inspector-cookie-encode">Encode values</button></div>
                          <div id="inspector-cookie-results" className="inspector-analysis-empty">Load a Cookie or Set-Cookie header to inspect values and security attributes.</div>
                          <label>Output<textarea id="inspector-cookie-output" spellCheck="false" readOnly></textarea></label>
                          <button type="button" id="inspector-cookie-copy" className="inspector-wide-action"><span className="codicon codicon-copy"></span>Copy output</button>
                        </section>
                      </div>
                      <footer id="security-inspector-status">Transforms run locally. JWT HMAC secrets are never saved.</footer>
                    </div>
                  </aside>
                </div>
              </div>
              <div id="terminal-tabs-resize" className="sash-v" role="separator" tabIndex="0" aria-label="Resize terminal session list" aria-orientation="vertical" hidden></div>
              <div id="terminal-tabs-list" hidden></div>
            </div>
          </section>
        </div>
    
        <div id="chat-resize" className="sash-v" role="separator" tabIndex="0" aria-label="Resize chat panel" aria-orientation="vertical" aria-valuemin="384" aria-valuemax="960" aria-valuenow="513"></div>
    
        <aside id="chat-pane">
          <div id="chat-header">
            <div id="chat-session-select" className="chat-session-tabs" title="Chat sessions"></div>
            <div className="chat-session-controls">
              <button type="button" id="btn-chat-new" className="icon-btn chat-session-action" title="New chat">
                <span className="codicon codicon-add"></span>
              </button>
              <button type="button" id="btn-chat-history" className="icon-btn chat-session-action" title="Chat history">
                <span className="codicon codicon-history"></span>
              </button>
              <button type="button" id="btn-chat-more" className="icon-btn chat-session-action" title="Chat options">
                <span className="codicon codicon-ellipsis"></span>
              </button>
              <button type="button" id="btn-chat-collapse" className="icon-btn chat-session-action" title="Collapse chat">
                <img className="chrome-icon" src="assets/icons/chat_collapse_expand_icon.svg" alt="" aria-hidden="true" />
              </button>
            </div>
          </div>
    
          <div id="messages"></div>
    
          <div id="input-bar">
            <div id="chat-history-security-warning" className="chat-history-security-warning" role="status" aria-live="polite" hidden></div>
            <div id="composer-questions" className="composer-questions" hidden aria-live="polite"></div>
            <div id="composer-task-list" className="composer-task-list" hidden aria-live="polite"></div>
            <div id="chat-error-toast" className="chat-error-toast" role="status" aria-live="polite" hidden>
              <p className="chat-error-toast-text"></p>
              <button type="button" className="chat-error-toast-close" title="Dismiss" aria-label="Dismiss">
                <span className="codicon codicon-close" aria-hidden="true"></span>
              </button>
            </div>
            <div className="composer">
              <div id="slash-command-suggestions" className="slash-command-suggestions" role="listbox" aria-label="Available slash commands" hidden></div>
              <div className="composer-input-row">
                <div id="chat-input" contentEditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="Chat message" data-placeholder="Ask, investigate, run, or search" className="chat-input-empty"><span id="selected-slash-command" className="selected-slash-command" hidden></span></div>
              </div>
              <div id="chat-input-measure" aria-hidden="true"></div>
              <div className="composer-toolbar">
                <div className="composer-meta">
                  <div id="chat-mode-toggle" className="chat-mode-toggle">
                    <button type="button" id="chat-mode-button" className="chat-mode-button mode-agent" aria-haspopup="menu" aria-expanded="false" title="Chat mode">
                      <span id="chat-mode-icon" className="codicon codicon-copilot chat-mode-icon" aria-hidden="true"></span>
                      <span id="chat-mode-button-label">Agent</span>
                      <span className="codicon codicon-chevron-down chat-mode-chevron"></span>
                    </button>
                  </div>
                  <button type="button" id="model-picker" className="model-pill composer-pill" title="Select model">
                    <span id="model-label">Select model</span>
                    <span className="codicon codicon-chevron-down model-chevron"></span>
                  </button>
                  <button type="button" id="authority-picker" className="authority-pill composer-pill" title="Agent authority" aria-haspopup="menu" aria-expanded="false">
                    <span className="codicon codicon-shield authority-pill-icon" aria-hidden="true"></span>
                    <span id="authority-label">Ask Approval</span>
                    <span className="codicon codicon-chevron-down authority-chevron"></span>
                  </button>
                </div>
                <div className="composer-actions">
                  <button type="button" id="context-usage-btn" className="context-ring-btn" title="Context usage" aria-label="View context usage" aria-expanded="false">
                    <svg className="context-ring" viewBox="0 0 20 20" aria-hidden="true">
                      <circle className="context-ring-bg" cx="10" cy="10" r="8"></circle>
                      <circle id="context-ring-fill" className="context-ring-fill" cx="10" cy="10" r="8"></circle>
                    </svg>
                  </button>
                  <button type="button" id="send-btn" className="send-btn" title="Send message" aria-label="Send message" disabled={true}>
                    <span className="codicon codicon-arrow-up"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div id="app-settings-overlay" className="tool-config-overlay" hidden>
        <form id="app-settings-dialog" className="tool-config-dialog app-settings-dialog"><header><div><span className="codicon codicon-settings-gear"></span><div><strong>XEKUTE Settings</strong><small>User-authored slash guidance is separate from Xekute's read-only system skills.</small></div></div><button type="button" id="app-settings-close" className="icon-btn"><span className="codicon codicon-close"></span></button></header><div className="app-settings-body"><label>Custom slash commands <small>One per line: /name = prompt guidance for the Agent</small></label><textarea id="custom-commands-input" placeholder="/myrecon = Perform my recon workflow"></textarea><label>Command registry JSON <small>Optional metadata for user-authored AI prompts. System skills appear in the picker but cannot be edited or overridden here.</small></label><textarea id="command-registry-input" className="command-registry-input" spellCheck="false" placeholder='{"/myrecon":{"role":"ai","prompt":"Perform my recon workflow."}}'></textarea></div><footer><button type="submit" className="primary-button">Save Settings</button></footer></form>
      </div>
      <div id="help-guide-overlay" className="help-guide-overlay" hidden>
        <section className="help-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="help-guide-title">
          <header><div><span className="codicon codicon-book"></span><div><strong id="help-guide-title">XEKUTE Guide</strong><small>Quick orientation for the local-first pentesting workspace.</small></div></div><button type="button" id="help-guide-close" className="icon-btn" title="Close guide" aria-label="Close guide"><span className="codicon codicon-close"></span></button></header>
          <div className="help-guide-body">
            <section><h3>Start with a project</h3><p>Use <strong>Files → Create New Project</strong> to create a workspace, or <strong>Open Project</strong> to open an existing folder. The Target sidebar holds assessment files and custom files.</p></section>
            <section><h3>Workspaces</h3><p><strong>Search</strong> finds evidence, <strong>Target</strong> organizes project scope and investigation state, and <strong>Security Tools</strong> handles request/response work.</p></section>
            <section><h3>Chat guidance</h3><p>Type <code>/</code> to choose a read-only <strong>System Skill</strong> or one of your <strong>Custom Skills</strong>. System skills can also be selected automatically from an ordinary request; their Markdown instructions remain internal.</p></section>
            <section><h3>Authority and modes</h3><p><strong>Modes</strong> (Agent, Ask) set which tools the model can call. <strong>Authority</strong> (Full Authority, Ask for Approval, Approve for me) controls scope and whether sensitive actions auto-run or need your approval. Switch both from the Chat composer.</p></section>
            <section><h3>Terminal and safety</h3><p>Use Terminal for local commands and keep testing within the authorization and scope recorded in the assessment. Tool configurations and results stay inside the current project.</p></section>
            <section><h3>Useful shortcuts</h3><p><code>Ctrl+F</code> Search · <code>Ctrl+P</code> Quick Open · <code>Ctrl+S</code> Save · <code>Ctrl+`</code> Toggle Terminal · <code>Ctrl+=</code>/<code>Ctrl+-</code> Zoom.</p></section>
          </div>
        </section>
      </div>
      <div id="custom-context-menu" className="custom-context-menu" role="menu" hidden>
        <button type="button" id="custom-context-delete" role="menuitem"><span className="codicon codicon-trash"></span><span id="custom-context-delete-label">Delete</span></button>
      </div>
      <div id="workspace-context-menu" className="custom-context-menu workspace-context-menu" role="menu" hidden>
        <button type="button" data-workspace-context-action="open" role="menuitem">
          <span>Open</span>
        </button>
        <button type="button" data-workspace-context-action="analyze" role="menuitem">
          <span>Analyze</span>
        </button>
        <div className="context-menu-separator" data-workspace-context-separator="clipboard" aria-hidden="true"></div>
        <button type="button" data-workspace-context-action="cut" role="menuitem">
          <span>Cut</span>
        </button>
        <button type="button" data-workspace-context-action="copy" role="menuitem">
          <span>Copy</span>
        </button>
        <button type="button" data-workspace-context-action="paste" role="menuitem" hidden>
          <span>Paste</span>
        </button>
        <div className="context-menu-separator" data-workspace-context-separator="create" aria-hidden="true"></div>
        <button type="button" data-workspace-context-action="new-file" role="menuitem">
          <span>New File</span>
        </button>
        <button type="button" data-workspace-context-action="new-folder" role="menuitem">
          <span>New Folder</span>
        </button>
        <button type="button" data-workspace-context-action="terminal" role="menuitem">
          <span>Run in Integrated Terminal</span>
        </button>
        <div className="context-menu-separator" data-workspace-context-separator="delete" aria-hidden="true"></div>
        <button type="button" data-workspace-context-action="rename" role="menuitem">
          <span>Rename</span>
        </button>
        <button type="button" data-workspace-context-action="delete" role="menuitem">
          <span id="workspace-context-delete-label">Delete</span>
        </button>
      </div>
    
      <div id="editor-tab-context-menu" className="custom-context-menu editor-tab-context-menu" role="menu" hidden>
        <button type="button" data-editor-tab-action="close-all" role="menuitem">Close All</button>
        <button type="button" data-editor-tab-action="close-right" role="menuitem">Close to the right</button>
        <button type="button" data-editor-tab-action="close" role="menuitem">Close</button>
        <div className="context-menu-separator" aria-hidden="true"></div>
        <button type="button" data-editor-tab-action="toggle-pin" role="menuitem">Pin</button>
        <div className="context-menu-separator" data-editor-tab-separator="explorer" aria-hidden="true"></div>
        <button type="button" data-editor-tab-action="reveal-explorer" role="menuitem">Reveal in File Explorer</button>
        <div className="context-menu-separator" data-editor-tab-separator="copy" aria-hidden="true"></div>
        <button type="button" data-editor-tab-action="copy-path" role="menuitem">Copy path</button>
        <button type="button" data-editor-tab-action="copy-relative-path" role="menuitem">Copy Relative Path</button>
      </div>
    
      <div id="update-toast" className="update-toast" role="status" aria-label="Update available" hidden>
        <div className="update-toast-body">
          <img className="update-toast-icon" src="assets/icons/gift_update_icon.svg" alt="" aria-hidden="true" />
          <div className="update-toast-text">
            <strong className="update-toast-title">New version is available</strong>
            <p className="update-toast-version"></p>
            <span id="update-toast-version" hidden></span>
          </div>
        </div>
        <div className="update-toast-actions">
          <button type="button" id="update-toast-ignore" className="update-toast-btn update-toast-ignore">Ignore</button>
          <button type="button" id="update-toast-install" className="update-toast-btn update-toast-install">Install</button>
        </div>
      </div>
    
      <footer id="statusbar">
        <div className="statusbar-left">
          <span id="status-workspace" className="statusbar-item">No project</span>
          <span id="status-agent" className="statusbar-item">Agent ready</span>
        </div>
        <div className="statusbar-right">
          <span id="status-ln-col" className="statusbar-item">Ln 1, Col 1</span>
          <span id="status-ollama-port" className="statusbar-item">Ollama :11435</span>
        </div>
      </footer>

      <div id="quick-overlay" className="quick-overlay" hidden>
        <div id="quick-panel" className="quick-panel" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="quick-input-row">
            <span id="quick-icon" className="codicon codicon-chevron-right"></span>
            <input id="quick-input" type="text" autoComplete="off" spellCheck="false" />
            <button id="quick-search-help" className="quick-search-help" type="button" title="Workspace search" aria-label="Workspace search" aria-expanded="false">
              <span className="codicon codicon-copilot"></span>
            </button>
          </div>
          <div id="quick-search-suggestions" className="quick-search-suggestions" role="listbox" aria-label="Advanced search suggestions" hidden></div>
          <div id="quick-search-assist" className="quick-search-assist" hidden>
            <div className="quick-search-assist-heading">
              <span>VAPT search presets</span>
              <span className="quick-search-assist-hint">AND · OR · NOT · quotes · Ctrl+Space autocomplete</span>
            </div>
            <div id="quick-search-presets" className="quick-search-presets"></div>
            <div id="quick-search-reference" className="quick-search-reference"></div>
          </div>
          <div id="quick-search-chips" className="quick-search-chips" hidden></div>
          <div id="quick-meta" className="quick-meta" aria-live="polite"></div>
          <div id="quick-results" className="quick-results"></div>
        </div>
      </div>
    
      <div id="context-usage-popover" className="context-usage-popover" hidden>
        <div className="context-usage-header">
          <div className="context-usage-heading-group">
            <div className="context-usage-heading">Context Usage</div>
          </div>
          <button type="button" id="context-usage-close" className="context-usage-close" title="Close context usage">
            <span className="codicon codicon-close"></span>
          </button>
        </div>
        <div className="context-usage-summary">
          <span id="context-usage-heading-value" className="context-usage-summary-left">0 / 0</span>
          <span id="context-usage-used" className="context-usage-summary-left">0%</span>
        </div>
        <div className="context-usage-track">
          <div id="context-usage-fill" className="context-usage-fill"></div>
          <div id="context-usage-segments" className="context-usage-segments"></div>
        </div>
        <div id="context-usage-breakdown" className="context-usage-list"></div>
      </div>
    
      <div id="chat-history-popover" className="chat-history-popover" hidden>
        <div className="chat-history-header">
          <label className="chat-history-search-wrap" htmlFor="chat-history-search">
            <span className="codicon codicon-search" aria-hidden="true"></span>
            <input type="search" id="chat-history-search" className="chat-history-search" placeholder="Search Agents..." autoComplete="off" spellCheck="false" aria-label="Search chat history" />
          </label>
        </div>
        <div id="chat-history-body" className="chat-history-body"></div>
        <div id="chat-history-empty" className="chat-history-empty" hidden>No chat sessions yet.</div>
      </div>
    
      <div id="security-history-menu" className="security-history-menu" role="menu" hidden>
        <button type="button" className="security-history-menu-item" data-action="send-repeater" role="menuitem">
          <span className="codicon codicon-sync"></span>
          <span id="security-history-repeater-label">Send to Repeater</span>
        </button>
        <button type="button" className="security-history-menu-item" data-action="send-intruder" role="menuitem">
          <span className="codicon codicon-symbol-event"></span>
          <span id="security-history-intruder-label">Send to Intruder</span>
        </button>
        <div className="security-tool-menu-separator" role="separator"></div>
        <button type="button" className="security-history-menu-item" data-action="delete" role="menuitem">
          <span className="codicon codicon-trash"></span>
          <span id="security-history-delete-label">Delete</span>
        </button>
      </div>
    
      <div id="chat-mode-menu" className="chat-mode-menu" role="menu" aria-label="Chat modes" hidden>
        <div className="chat-mode-group">
          <button type="button" className="chat-mode-option mode-agent" data-chat-mode="agent" role="menuitemradio" aria-checked="true" title="Execute the user's request with tools, then observe, verify, and report">
            <span className="codicon codicon-copilot chat-mode-option-icon" aria-hidden="true"></span><span className="chat-mode-option-copy"><span className="chat-mode-option-label">Agent</span><span className="chat-mode-option-desc">Execute, observe, and verify</span></span><span className="codicon codicon-check chat-mode-option-check" aria-hidden="true"></span>
          </button>
          <button type="button" className="chat-mode-option mode-ask" data-chat-mode="ask" role="menuitemradio" aria-checked="false" title="Read-only questions and analysis over available evidence">
            <span className="codicon codicon-comment-discussion chat-mode-option-icon" aria-hidden="true"></span><span className="chat-mode-option-copy"><span className="chat-mode-option-label">Ask</span><span className="chat-mode-option-desc">Read-only questions and analysis</span></span><span className="codicon codicon-check chat-mode-option-check" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    
      <div id="authority-menu" className="authority-menu" hidden>
        <div id="authority-menu-options">
          <button type="button" className="authority-menu-option" data-authority-mode="full" role="menuitemradio" aria-checked="false">
            <span className="codicon codicon-shield authority-menu-option-icon" aria-hidden="true"></span>
            <span className="authority-menu-option-copy"><span className="authority-menu-option-label">Full Authority</span></span>
            <span className="codicon codicon-check authority-menu-option-check" aria-hidden="true"></span>
          </button>
          <button type="button" className="authority-menu-option" data-authority-mode="ask" role="menuitemradio" aria-checked="true">
            <span className="codicon codicon-shield authority-menu-option-icon" aria-hidden="true"></span>
            <span className="authority-menu-option-copy"><span className="authority-menu-option-label">Ask for Approval</span></span>
            <span className="codicon codicon-check authority-menu-option-check" aria-hidden="true"></span>
          </button>
          <button type="button" className="authority-menu-option" data-authority-mode="approve" role="menuitemradio" aria-checked="false">
            <span className="codicon codicon-shield authority-menu-option-icon" aria-hidden="true"></span>
            <span className="authority-menu-option-copy"><span className="authority-menu-option-label">Approve for me</span></span>
            <span className="codicon codicon-check authority-menu-option-check" aria-hidden="true"></span>
          </button>
        </div>
      </div>
    
      <div id="model-menu" className="model-menu" hidden>
        <input id="model-search" type="text" placeholder="Search models" spellCheck="false" />
        <div id="model-list" className="model-list"></div>
        <div className="model-menu-divider"></div>
        <button type="button" id="model-add-btn" className="model-add-btn">
          <span className="codicon codicon-add"></span>
          Add Models
        </button>
        <div id="model-add-form" className="model-add-form" hidden>
          <input id="model-custom" type="text" placeholder="model-name:tag" spellCheck="false" />
          <button type="button" id="model-custom-add" className="model-custom-add">Add</button>
        </div>
      </div>
    
      <div id="model-edit-menu" className="model-edit-menu" hidden>
        <div id="openrouter-reasoning-row" className="model-edit-section model-reasoning-section" hidden>
          <div className="model-edit-label">Effort</div>
          <div id="reasoning-options" className="reasoning-options" role="radiogroup" aria-label="Reasoning effort"></div>
        </div>
        <div id="ollama-thinking-section" className="model-edit-section">
          <div className="model-edit-label">Options</div>
          <div id="ollama-thinking-row" className="model-edit-row">
            <span className="model-edit-row-name">Thinking</span>
            <button type="button" id="thinking-toggle" className="toggle-switch" aria-pressed="false" title="Enable thinking">
              <span className="toggle-thumb"></span>
            </button>
          </div>
        </div>
        <div className="model-edit-divider"></div>
        <div id="model-context-section" className="model-edit-section">
          <div className="model-edit-label">Context</div>
          <div id="context-options" className="context-options"></div>
        </div>
      </div>
    
      <div id="app-dialog-overlay" className="app-dialog-overlay" hidden>
        <section id="app-dialog" className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
          <header>
            <div className="app-dialog-heading">
              <span id="app-dialog-icon" className="app-dialog-icon codicon codicon-question" aria-hidden="true"></span>
              <div>
                <strong id="app-dialog-title">Confirm</strong>
                <small id="app-dialog-subtitle" hidden></small>
              </div>
            </div>
          </header>
          <div className="app-dialog-body">
            <p id="app-dialog-message"></p>
            <input id="app-dialog-input" type="text" hidden spellCheck="false" />
          </div>
          <footer>
            <button type="button" id="app-dialog-cancel" className="secondary-button">Cancel</button>
            <button type="button" id="app-dialog-confirm" className="primary-button">OK</button>
          </footer>
        </section>
      </div>
    
      <div id="assessment-repair-overlay" className="assessment-repair-overlay" hidden>
        <section className="assessment-repair-dialog" role="dialog" aria-modal="false" aria-labelledby="assessment-repair-title">
          <header>
            <div className="assessment-repair-heading">
              <span className="codicon codicon-warning" aria-hidden="true"></span>
              <div>
                <strong id="assessment-repair-title">Assessment template notice</strong>
                <small id="assessment-repair-subtitle">Your workspace remains fully usable.</small>
              </div>
            </div>
            <button type="button" id="assessment-repair-close" className="icon-btn" title="Close" aria-label="Close repair dialog">
              <span className="codicon codicon-close"></span>
            </button>
          </header>
          <div className="assessment-repair-body">
            <p id="assessment-repair-description">XEKUTE found missing or incomplete assessment items. Existing files are never overwritten.</p>
            <div id="assessment-repair-summary" className="assessment-repair-summary"></div>
            <div id="assessment-repair-list" className="assessment-repair-list" role="list"></div>
          </div>
          <footer>
            <button type="button" id="assessment-repair-cancel" className="secondary-button">Cancel</button>
            <button type="button" id="assessment-repair-confirm" className="primary-button">Create missing items</button>
          </footer>
        </section>
      </div>
    </div>
  );
});
