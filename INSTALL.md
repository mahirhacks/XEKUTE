# Install XEKUTE on Windows

XEKUTE is a local-first desktop workspace for **authorized** penetration testing and vulnerability assessment. The release installer is the easiest way to use it: you do not need Node.js, npm, Git, or any development tooling.

## 1. Install the app

1. Download `XEKUTESetup.exe` from the project's GitHub Releases page.
2. If the release includes `SHA256SUMS.txt`, verify the installer before opening it:

   ```powershell
   Get-FileHash .\XEKUTESetup.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

   The displayed SHA-256 value must match the entry for `XEKUTESetup.exe`.
3. Run `XEKUTESetup.exe` and follow the Windows installer prompts.
4. Open **XEKUTE** from the Start menu.

The installer writes only its application files and Windows-managed app settings. It does not install assessment tools, create projects, or transmit your assessment data.

> XEKUTE is currently an unsigned alpha release. Windows may show a SmartScreen warning. Only continue after confirming that you downloaded the installer from the project's official release and, where supplied, that its SHA-256 checksum matches.

## 2. Set up AI assistance (optional)

XEKUTE works without an AI provider. To enable chat and agent features, choose one provider in the app's Chat or Settings screen:

- **Ollama (local):** install [Ollama](https://ollama.com/), then in PowerShell run:

  ```powershell
  ollama pull qwen2.5-coder:7b
  ```

  Start Ollama if it is not already running, then select the installed model in XEKUTE.
- **OpenRouter:** add your own API key and model ID in XEKUTE Settings. Your key is stored locally; never paste it into project files or source control.

Only one AI provider is active at a time.

## 3. Start an assessment

1. Create a new project folder or open an existing one.
2. In **Settings > Project**, record the authorization, in-scope targets, exclusions, Rules of Engagement, and stop conditions.
3. Use the workbench only against systems you own or are explicitly authorized to assess.

XEKUTE keeps its application settings locally and leaves newly created project folders empty until you add your own assessment material.

## Optional tools

XEKUTE does not bundle third-party security tools. Install only tools that your engagement permits, and make their executables available on `PATH`. Some Linux-first tools are most convenient through WSL. Each tool has its own license and installation requirements.

## Updates and removal

Install a newer release by running its `XEKUTESetup.exe`. To remove XEKUTE, use **Settings > Apps > Installed apps > XEKUTE > Uninstall** in Windows. Back up important project folders before uninstalling or upgrading.

## Build from source (developers)

For development rather than ordinary use:

```powershell
git clone https://github.com/mahirhacks/XEKUTE.git
cd XEKUTE
npm ci
npm start
```

Use Node.js 22+ and npm 10+. See the root [README](README.md) for development verification and packaging commands.
