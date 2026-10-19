"use strict";

const { saveFailureReason } = require("./tier1-context-coordinator.js");

// A run or a steering message that cannot be saved because the chat's folder
// cannot be written is refused with a plain reason (never a file path), and the
// chat's memory banner is told why. Other refusals pass through unchanged.
const STORAGE_FAILURE = /MEMORY_SENSITIVE_WRITE_FAILED|MEMORY_SECURE_STORAGE_UNAVAILABLE|MEMORY_SENSITIVE_ENCRYPT_FAILED|ENOSPC|EACCES|EPERM|EROFS|ENOTDIR|EEXIST/;
const STORAGE_FAILURE_TEXT = {
  secure_storage: "the system's secure storage is unavailable. Unlock it, then try again",
  disk_full: "the disk is full. Free up some space, then try again",
  no_access: "the chat's folder cannot be written to. Check its permissions, then try again",
  write_failed: "the chat's folder cannot be written to. Check the disk and its permissions, then try again",
};

function refuseUnsavedInput(result, emit) {
  if (!result || result.ok !== false || !STORAGE_FAILURE.test(`${result.code || ""} ${result.error || ""}`)) return result;
  const reason = saveFailureReason(result);
  try { emit?.({ type: "memory_save_health", ok: false, reason, code: String(result.code || "MEMORY_SAVE_FAILED") }); } catch { /* the refusal still says why */ }
  return { ...result, storage: true, error: `This message could not be saved because ${STORAGE_FAILURE_TEXT[reason]}.` };
}

module.exports = { refuseUnsavedInput };
