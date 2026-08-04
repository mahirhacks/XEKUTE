(function installAppDialog(global) {
  "use strict";

  const overlay = document.getElementById("app-dialog-overlay");
  const dialogEl = document.getElementById("app-dialog");
  const iconEl = document.getElementById("app-dialog-icon");
  const titleEl = document.getElementById("app-dialog-title");
  const subtitleEl = document.getElementById("app-dialog-subtitle");
  const messageEl = document.getElementById("app-dialog-message");
  const inputEl = document.getElementById("app-dialog-input");
  const cancelBtn = document.getElementById("app-dialog-cancel");
  const confirmBtn = document.getElementById("app-dialog-confirm");

  let pending = null;

  function afterClose() {
    if (typeof global.__appDialogAfterClose === "function") {
      global.__appDialogAfterClose();
    }
  }

  function finish(value) {
    if (!overlay) return;
    overlay.hidden = true;
    dialogEl?.classList.remove("tone-danger");
    if (pending) {
      const { resolve } = pending;
      pending = null;
      resolve(value);
    }
    afterClose();
  }

  function focusTarget() {
    if (!pending) return;
    if (pending.kind === "prompt" && inputEl) {
      inputEl.focus();
      inputEl.select();
      return;
    }
    confirmBtn?.focus();
  }

  function openDialog(options) {
    if (!overlay || !messageEl || !confirmBtn) {
      return Promise.resolve(options.kind === "confirm" ? false : options.kind === "prompt" ? null : undefined);
    }

    if (pending) {
      finish(options.kind === "alert" ? undefined : false);
    }

    const kind = options.kind || "confirm";
    const tone = options.tone || "default";
    const title = String(options.title || "").trim() || (kind === "alert" ? "Notice" : kind === "prompt" ? "Input" : "Confirm");
    const message = String(options.message || "");
    const confirmLabel = String(options.confirmLabel || (kind === "alert" ? "OK" : "Confirm"));
    const cancelLabel = String(options.cancelLabel || "Cancel");
    const icon = options.icon || (tone === "danger" ? "codicon-warning" : kind === "alert" ? "codicon-info" : "codicon-question");

    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) {
      const subtitle = String(options.subtitle || "").trim();
      subtitleEl.textContent = subtitle;
      subtitleEl.hidden = !subtitle;
    }
    if (iconEl) iconEl.className = `codicon ${icon}`;
    messageEl.textContent = message;
    dialogEl?.classList.toggle("tone-danger", tone === "danger");
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle("danger-button", tone === "danger");

    if (kind === "prompt" && inputEl) {
      inputEl.hidden = false;
      inputEl.value = String(options.defaultValue ?? "");
    } else if (inputEl) {
      inputEl.hidden = true;
      inputEl.value = "";
    }

    if (cancelBtn) {
      const showCancel = kind !== "alert";
      cancelBtn.hidden = !showCancel;
      cancelBtn.textContent = cancelLabel;
    }

    overlay.hidden = false;
    requestAnimationFrame(() => focusTarget());

    return new Promise((resolve) => {
      pending = { resolve, kind };
    });
  }

  function confirm(message, options = {}) {
    return openDialog({
      kind: "confirm",
      message,
      title: options.title,
      subtitle: options.subtitle,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      tone: options.tone,
      icon: options.icon,
    }).then((value) => value === true);
  }

  function alert(message, options = {}) {
    return openDialog({
      kind: "alert",
      message,
      title: options.title,
      subtitle: options.subtitle,
      confirmLabel: options.confirmLabel,
      icon: options.icon,
    });
  }

  function prompt(message, defaultValue = "", options = {}) {
    return openDialog({
      kind: "prompt",
      message,
      defaultValue,
      title: options.title,
      subtitle: options.subtitle,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
    });
  }

  function setAfterCloseHook(fn) {
    global.__appDialogAfterClose = fn;
  }

  overlay?.addEventListener("click", (event) => {
    if (event.target !== overlay) return;
    if (!pending) return;
    finish(pending.kind === "alert" ? undefined : pending.kind === "prompt" ? null : false);
  });

  cancelBtn?.addEventListener("click", () => {
    if (!pending) return;
    finish(pending.kind === "prompt" ? null : false);
  });

  confirmBtn?.addEventListener("click", () => {
    if (!pending) return;
    if (pending.kind === "prompt") {
      finish(inputEl ? inputEl.value : "");
      return;
    }
    finish(pending.kind === "alert" ? undefined : true);
  });

  inputEl?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmBtn?.click();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!pending || overlay?.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finish(pending.kind === "alert" ? undefined : pending.kind === "prompt" ? null : false);
    }
  });

  global.AppDialog = Object.freeze({
    confirm,
    alert,
    prompt,
    setAfterCloseHook,
  });
})(globalThis);
