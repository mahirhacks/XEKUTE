export function normalizeLoadedSkills(skills) {
  return [...new Set((Array.isArray(skills) ? skills : [])
    .filter((name) => typeof name === "string")
    .map((name) => name.trim().slice(0, 200)).filter(Boolean))].slice(0, 200);
}

export function createSkillLoadRow(skills, doc = globalThis.document) {
  const names = normalizeLoadedSkills(skills);
  if (!names.length || !doc) return null;
  const row = doc.createElement("div");
  row.className = "agent-skill-event";
  row.dataset.lane = "activity";
  row.dataset.skills = JSON.stringify(names);
  const label = doc.createElement("div");
  label.className = "agent-skill-label";
  const verb = doc.createElement("span");
  verb.className = "agent-tool-verb";
  verb.textContent = "Skill";
  const detail = doc.createElement("span");
  detail.className = "agent-tool-detail";
  detail.textContent = "loaded";
  label.append(verb, doc.createTextNode(" "), detail);
  const list = doc.createElement("ul");
  list.className = "agent-skill-list";
  for (const name of names) {
    const item = doc.createElement("li");
    item.textContent = name;
    list.append(item);
  }
  row.append(label, list);
  return row;
}

export function readSkillLoadRow(row) {
  try { return normalizeLoadedSkills(JSON.parse(row?.dataset?.skills || "[]")); }
  catch { return []; }
}
