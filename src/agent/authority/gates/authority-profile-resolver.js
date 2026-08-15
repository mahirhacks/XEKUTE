"use strict";

const { normalizeAuthorityProfile } = require("../profiles/profile-manifest.js");
const { allow, gate } = require("./gate-utils.js");

function createAuthorityProfileResolver() {
  return gate("authority_profile_resolver", ({ profile }) => allow("authority_profile_resolver", `Authority profile ${profile?.id || "unknown"} resolved exactly once.`));
}

function resolveAuthorityProfile(registry, requested = "approve_for_me") {
  if (!registry || typeof registry.profile !== "function") throw new TypeError("authority registry is required");
  const id = normalizeAuthorityProfile(requested);
  const profile = registry.profile(id);
  if (!profile) return { ok: false, code: "AUTHORITY_PROFILE_NOT_FOUND", error: `Authority profile '${id}' is not registered.` };
  if (new Set(profile.modulePipeline).size !== profile.modulePipeline.length) return { ok: false, code: "DUPLICATE_AUTHORITY_MODULE", error: "Authority profile contains a duplicate module." };
  if (profile.modulePipeline.includes("authority_profile_resolver")) return { ok: false, code: "AUTHORITY_RESOLVER_RECURSION", error: "The bootstrap resolver cannot appear inside a resolved profile pipeline." };
  if (profile.modulePipeline[0] !== "role_access_gate") return { ok: false, code: "AUTHORITY_PIPELINE_ORDER_INVALID", error: "The resolved authority pipeline must begin with role_access_gate." };
  const pipeline = profile.modulePipeline.map((name) => registry.module(name));
  if (pipeline.some((adapter) => !adapter)) return { ok: false, code: "AUTHORITY_MODULE_NOT_FOUND", error: "The profile references an unavailable authority module." };
  return { ok: true, profile, pipeline };
}

module.exports = { createAuthorityProfileResolver, resolveAuthorityProfile };
