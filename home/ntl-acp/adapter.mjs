#!/usr/bin/env node
// NoTokenLimit ACP adapter.
// Speaks Agent Client Protocol (JSON-RPC 2.0, one JSON message per line on stdio)
// and runs each prompt through `ntl -p`, which reuses the CLI's existing sign-in.
// stdout carries protocol messages only; diagnostics go to stderr.

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SELF_SCRIPT = fileURLToPath(import.meta.url);
const NTL = process.env.NTL_BIN || `${homedir()}/.local/bin/ntl`;
const STATE_DIR =
  process.env.NTL_ACP_STATE_DIR ||
  join(
    process.env.XDG_STATE_HOME || `${homedir()}/.local/state`,
    "ntl-acp",
    "sessions",
  );
const ATTACHMENTS_DIR = join(STATE_DIR, "attachments");
const DEFAULT_MODEL = "claude-opus-5.5";
const claude = (family, version) => ["claude", family, version].join("-");
const FALLBACK_MODELS = [
  { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
  { id: "claude-opus-5", name: "Claude Opus 5" },
  { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
  { id: claude("sonnet", "5.5"), name: "Claude Sonnet 5.5" },
  { id: claude("sonnet", "5"), name: "Claude Sonnet 5" },
  { id: claude("haiku", "4.5"), name: "Claude Haiku 4.5" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  { id: "glm-5.1", name: "GLM 5.1" },
  { id: "auto", name: "Auto" },
];
const MODEL_CACHE_TTL_MS = 300_000;
const SKILL_CACHE_TTL_MS = 10_000;
// Permission presets. ntl applies one preset to the whole run; it has no
// per-action approval prompts.
const MODES = {
  "read-only": { writes: false, shell: false, label: "Read only" },
  edit: { writes: true, shell: false, label: "Edit files" },
  "edit-and-shell": {
    writes: true,
    shell: true,
    label: "Edit files and run shell",
  },
};
// Directory ntl runs in. ntl limits file access to this folder, so "/" lets it
// reach any directory. Set NTL_ACP_WORKDIR to narrow it.
const WORKDIR = process.env.NTL_ACP_WORKDIR || "/";
const TURN_TIMEOUT_MS = Number(process.env.NTL_ACP_TIMEOUT_MS) || 1_800_000;
const CANCEL_GRACE_MS = 3000;
// How long to wait for the user's answer to a permission question. No answer
// is treated as "stay restricted"; it never silently escalates.
const PERMISSION_TIMEOUT_MS =
  Number(process.env.NTL_ACP_PERMISSION_TIMEOUT_MS) || 180_000;
const HISTORY_BUDGET_CHARS =
  Number(process.env.NTL_ACP_HISTORY_CHARS) || 60_000;
const MAX_ACTIONS_PER_TURN = 30;
const T3_INSTRUCTIONS = /<t3_code_instructions>[\s\S]*?<\/t3_code_instructions>/g;
const RUNTIME_INFO = /<runtime_info>[\s\S]*?<\/runtime_info>/g;
const PR_LINKING = /<pull_request_linking>[\s\S]*?<\/pull_request_linking>/g;
const USER_REQUEST_WRAP = /^\s*<user_request>\s*([\s\S]*?)\s*<\/user_request>\s*$/;
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ntl prints one line per finished action on stderr: "  ✓ Read ..." or "  ✗ ...".
const TOOL_LINE = /^\s*([\u2713\u2717])\s+(.+)$/u;

function defaultMode() {
  const fromEnv = process.env.NTL_ACP_MODE;
  if (fromEnv && Object.hasOwn(MODES, fromEnv)) return fromEnv;
  if (process.env.NTL_ACP_ALLOW_SHELL === "1") return "edit-and-shell";
  if (process.env.NTL_ACP_ALLOW_WRITES === "0") return "read-only";
  return "edit-and-shell";
}
const DEFAULT_MODE = defaultMode();
const DEFAULT_MCP = process.env.NTL_ACP_ALLOW_MCP === "1";
const DEFAULT_WEB = process.env.NTL_ACP_ALLOW_WEB === "1";
// Tool rounds ntl may use per turn. "default" leaves ntl's own cap (25).
const MAX_TURNS_OPTIONS = [
  { value: "default", name: "Default (25)" },
  { value: "50", name: "50" },
  { value: "100", name: "100" },
];

const sessions = new Map();
const running = new Map();
const inFlightPrompts = new Map();
// Requests the adapter sends to the client (e.g. session/request_permission).
const clientCalls = new Map();
let nextClientCallId = 10_000;
let initialized = false;
// Capabilities the client advertised during initialize. Omitted means
// unsupported, per the ACP spec.
let clientCapabilities = {};
let modelCache = null;
const skillCache = new Map();

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (text) => process.stderr.write(`[ntl-acp] ${text}\n`);
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });
const update = (sessionId, body) =>
  notify("session/update", { sessionId, update: body });

function sendResult(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function sendError(id, err) {
  const error = { code: err.code ?? -32603, message: err.message };
  if (err.data !== undefined) error.data = err.data;
  write({ jsonrpc: "2.0", id, error });
}

// Sends a request to the client and resolves with the raw response message,
// or null when it is never answered. A client that does not implement the
// method answers with a JSON-RPC error; callers treat that as "unsupported".
function callClient(method, params, timeoutMs) {
  return new Promise((resolve) => {
    const id = nextClientCallId++;
    const timer = setTimeout(() => {
      clientCalls.delete(id);
      resolve(null);
    }, timeoutMs);
    clientCalls.set(id, { timer, resolve });
    write({ jsonrpc: "2.0", id, method, params });
  });
}

function selectOption(id, name, category, currentValue, options) {
  return { id, name, category, type: "select", currentValue, options };
}

function getModels() {
  const now = Date.now();
  if (modelCache && now - modelCache.at < MODEL_CACHE_TTL_MS) {
    return modelCache.models;
  }
  let discovered = [];
  try {
    const out = execFileSync(NTL, ["models", "--no-color"], {
      encoding: "utf8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    const seen = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(
        /^\s*\u2713\s+(.+?)\s{2,}([a-z0-9][a-z0-9._-]+)(?:\s+\(default\))?\s*$/iu,
      );
      if (!m) continue;
      const id = m[2].trim();
      const name = m[1].trim();
      if (!seen.has(id)) {
        seen.add(id);
        discovered.push({ id, name });
      }
    }
  } catch {
    discovered = [];
  }
  const models = discovered.length > 0 ? discovered : FALLBACK_MODELS;
  modelCache = { at: now, models };
  return models;
}

function isKnownModel(id) {
  if (typeof id !== "string" || id.trim() === "") return false;
  return (
    getModels().some((m) => m.id === id) ||
    FALLBACK_MODELS.some((m) => m.id === id)
  );
}

function modelState(s) {
  const models = getModels();
  const availableModels = models.map((m) => ({ modelId: m.id, name: m.name }));
  if (!availableModels.some((m) => m.modelId === s.model)) {
    availableModels.unshift({ modelId: s.model, name: s.model });
  }
  return {
    currentModelId: s.model,
    availableModels,
  };
}

function configOptions(s) {
  const modelChoices = getModels().map((m) => ({ value: m.id, name: m.name }));
  if (!modelChoices.some((m) => m.value === s.model)) {
    modelChoices.unshift({ value: s.model, name: s.model });
  }
  return [
    selectOption("model", "Model", "model", s.model, modelChoices),
    selectOption(
      "mode",
      "Permissions",
      "mode",
      s.mode,
      Object.entries(MODES).map(([value, m]) => ({ value, name: m.label })),
    ),
    selectOption("web", "Web search", "other", s.web ? "on" : "off", [
      { value: "off", name: "Off" },
      { value: "on", name: "On" },
    ]),
    selectOption("mcp", "MCP tools", "other", s.mcp ? "on" : "off", [
      { value: "off", name: "Off" },
      { value: "on", name: "On" },
    ]),
    selectOption(
      "max_turns",
      "Max tool rounds",
      "other",
      s.maxTurns,
      MAX_TURNS_OPTIONS,
    ),
  ];
}

function parseAdditionalDirectories(dirs) {
  if (dirs === undefined) return [];
  if (!Array.isArray(dirs)) {
    throw new RpcError(
      -32602,
      "additionalDirectories must be an array of absolute paths",
    );
  }
  const seen = new Set();
  const out = [];
  for (const d of dirs) {
    if (typeof d !== "string" || !isAbsolute(d)) {
      throw new RpcError(
        -32602,
        "additionalDirectories entries must be absolute paths",
      );
    }
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

function parseSystemPrompt(sp) {
  if (sp === undefined || sp === null) return "";
  if (typeof sp === "string") return sp;
  if (typeof sp === "object" && !Array.isArray(sp)) {
    if (typeof sp.append === "string") return sp.append;
    if (sp.append === undefined) return "";
  }
  throw new RpcError(-32602, "Invalid systemPrompt");
}

function newSession(id, cwd) {
  return {
    id,
    cwd,
    additionalDirectories: [],
    model: DEFAULT_MODEL,
    mode: DEFAULT_MODE,
    plan: false,
    mcp: DEFAULT_MCP,
    web: DEFAULT_WEB,
    maxTurns: "default",
    systemPrompt: "",
    t3Instructions: "",
    runtimeInfo: "",
    prLinking: "",
    t3Mcp: null,
    title: null,
    updatedAt: new Date().toISOString(),
    history: [],
    busy: false,
    cancelled: false,
  };
}

function getSession(sessionId) {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new RpcError(-32602, "sessionId must be a non-empty string");
  }
  const session = sessions.get(sessionId);
  if (!session) {
    throw new RpcError(-32002, `Unknown sessionId: ${sessionId}`, {
      sessionId,
    });
  }
  return session;
}

function sessionFile(id) {
  return join(STATE_DIR, `${id}.json`);
}

// Saves what survives a restart. A failed save is logged and does not fail the turn.
function persist(s) {
  try {
    s.updatedAt = new Date().toISOString();
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const file = sessionFile(s.id);
    const data = {
      id: s.id,
      cwd: s.cwd,
      additionalDirectories: s.additionalDirectories,
      model: s.model,
      mode: s.mode,
      plan: s.plan,
      mcp: s.mcp,
      web: s.web,
      maxTurns: s.maxTurns,
      systemPrompt: s.systemPrompt,
      t3Instructions: s.t3Instructions,
      runtimeInfo: s.runtimeInfo,
      prLinking: s.prLinking,
      title: s.title,
      updatedAt: s.updatedAt,
      history: s.history,
    };
    writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    log(`could not save session ${s.id}: ${err.message}`);
  }
}

function readPersisted(id) {
  if (typeof id !== "string" || !SESSION_ID.test(id)) return null;
  const file = sessionFile(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new RpcError(-32002, `Saved session ${id} is unreadable`);
  }
}

function hydrateSession(sessionId, cwd, saved, mcpServers, additionalDirs) {
  const s = newSession(sessionId, cwd);
  s.t3Mcp = extractT3Mcp(mcpServers);
  if (additionalDirs !== undefined) {
    s.additionalDirectories = additionalDirs;
  } else if (Array.isArray(saved.additionalDirectories)) {
    s.additionalDirectories = saved.additionalDirectories.filter(
      (d) => typeof d === "string" && isAbsolute(d),
    );
  }
  if (typeof saved.systemPrompt === "string") s.systemPrompt = saved.systemPrompt;
  if (typeof saved.t3Instructions === "string") s.t3Instructions = saved.t3Instructions;
  if (typeof saved.runtimeInfo === "string") s.runtimeInfo = saved.runtimeInfo;
  if (typeof saved.prLinking === "string") s.prLinking = saved.prLinking;
  if (isKnownModel(saved.model)) s.model = saved.model;
  if (Object.hasOwn(MODES, saved.mode)) s.mode = saved.mode;
  if (typeof saved.plan === "boolean") s.plan = saved.plan;
  if (typeof saved.mcp === "boolean") s.mcp = saved.mcp;
  if (typeof saved.web === "boolean") s.web = saved.web;
  if (
    typeof saved.maxTurns === "string" &&
    MAX_TURNS_OPTIONS.some((o) => o.value === saved.maxTurns)
  ) {
    s.maxTurns = saved.maxTurns;
  }
  if (typeof saved.title === "string") s.title = saved.title;
  if (typeof saved.updatedAt === "string") s.updatedAt = saved.updatedAt;
  if (Array.isArray(saved.history)) {
    s.history = saved.history
      .filter(
        (t) =>
          (t?.role === "user" || t?.role === "assistant") &&
          typeof t.text === "string",
      )
      .map((t) =>
        t.role === "assistant"
          ? { role: t.role, text: stripToolFences(t.text) }
          : t,
      );
  }
  return s;
}

function extFromMime(mime) {
  switch (String(mime || "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function promptText(blocks) {
  if (!Array.isArray(blocks)) return "";
  const parts = [];
  const images = [];
  for (const b of blocks) {
    if (b?.type === "text") {
      if (b.text) parts.push(b.text);
    } else if (b?.type === "resource" && typeof b.resource?.text === "string") {
      parts.push(b.resource.text);
    } else if (b?.type === "resource_link") {
      parts.push(`[resource: ${b.uri}]`);
    } else if (b?.type === "image" && typeof b.data === "string") {
      images.push(b);
    }
  }
  let joined = parts.filter(Boolean).join("\n");
  if (images.length > 0 && !joined.includes("[Attached image")) {
    try {
      mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
      const savedNotes = [];
      for (const img of images) {
        const file = join(
          ATTACHMENTS_DIR,
          `${randomUUID()}.${extFromMime(img.mimeType)}`,
        );
        writeFileSync(file, Buffer.from(img.data, "base64"), { mode: 0o600 });
        savedNotes.push(
          `[Attached image saved at: ${file} (${img.mimeType || "image/png"})]`,
        );
      }
      joined = joined ? `${joined}\n\n${savedNotes.join("\n")}` : savedNotes.join("\n");
    } catch (err) {
      log(`could not save image attachment: ${err.message}`);
    }
  }
  return joined;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const yaml = m[1];
  const body = m[2];
  const meta = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (/^[>|][-+]?$/.test(val)) {
      const collected = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        i++;
        const trimmed = lines[i].trim();
        if (trimmed !== "") collected.push(trimmed);
      }
      meta[key] = collected.join(" ");
    } else {
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  return { meta, body };
}

function firstBodyLine(body) {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim().replace(/^#+\s*/, "");
    if (t) return t;
  }
  return "";
}

function walkMarkdownFiles(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const nextPrefix = prefix ? `${prefix}:${entry}` : entry;
      out.push(...walkMarkdownFiles(full, nextPrefix));
    } else if (st.isFile() && entry.endsWith(".md")) {
      const base = entry.slice(0, -3);
      out.push({ name: prefix ? `${prefix}:${base}` : base, path: full });
    }
  }
  return out;
}

function discoverSkillsAndCommands(cwds) {
  const roots = [...new Set(cwds.filter((d) => typeof d === "string" && isAbsolute(d)))];
  const cacheKey = roots.join("\0");
  const now = Date.now();
  const cached = skillCache.get(cacheKey);
  if (cached && now - cached.at < SKILL_CACHE_TTL_MS) return cached.data;

  const home = homedir();
  const skillRoots = [
    ...roots.flatMap((d) => [
      join(d, ".claude", "skills"),
      join(d, ".agents", "skills"),
      join(d, ".codex", "skills"),
    ]),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".codex", "skills"),
  ];
  const commandRoots = [
    ...roots.flatMap((d) => [
      join(d, ".claude", "commands"),
      join(d, ".agents", "commands"),
    ]),
    join(home, ".claude", "commands"),
    join(home, ".agents", "commands"),
  ];

  const skills = new Map();
  const orderedSkills = [];
  for (const root of skillRoots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const entryDir = join(root, entry);
      let st;
      try {
        st = statSync(entryDir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const skillFile = join(entryDir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      let raw;
      try {
        raw = readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      const { meta, body } = parseFrontmatter(raw);
      const name = (meta.name || entry).trim();
      if (!name || /\s/.test(name)) continue;
      const key = name.toLowerCase();
      if (skills.has(key)) continue;
      const description = (meta.description || firstBodyLine(body) || `Run ${name} skill`).slice(0, 300);
      const item = { name, description, path: skillFile, dir: entryDir, kind: "skill" };
      skills.set(key, item);
      orderedSkills.push(item);
    }
  }

  const commands = new Map();
  const orderedCommands = [];
  for (const root of commandRoots) {
    for (const file of walkMarkdownFiles(root)) {
      if (!file.name || /\s/.test(file.name)) continue;
      const key = file.name.toLowerCase();
      if (commands.has(key)) continue;
      let raw;
      try {
        raw = readFileSync(file.path, "utf8");
      } catch {
        continue;
      }
      const { meta, body } = parseFrontmatter(raw);
      const description = (meta.description || firstBodyLine(body) || `Run /${file.name}`).slice(0, 300);
      const item = {
        name: file.name,
        description,
        path: file.path,
        dir: dirname(file.path),
        kind: "command",
      };
      commands.set(key, item);
      orderedCommands.push(item);
    }
  }

  const data = { skills, commands, orderedSkills, orderedCommands };
  skillCache.set(cacheKey, { at: now, data });
  return data;
}

const BUILTIN_COMMANDS = [
  {
    name: "compact",
    description: "Summarize conversation history to free context space",
    input: { hint: "optional focus instructions" },
  },
  { name: "clear", description: "Clear conversation history in this session" },
  { name: "plan", description: "Turn plan mode on (read-only planning)" },
  { name: "skills", description: "List all discovered skills and slash commands" },
  { name: "mcp", description: "Show T3 Code MCP bridge and ntl MCP status" },
  {
    name: "web",
    description: "Toggle ntl web search (on or off)",
    input: { hint: "on | off" },
  },
  {
    name: "model",
    description: "Switch or list available models",
    input: { hint: "model-id" },
  },
  {
    name: "mode",
    description: "Switch permission preset",
    input: { hint: "read-only | edit | edit-and-shell | plan" },
  },
  {
    name: "status",
    description: "Display session settings, context usage, skills, and T3 MCP status",
  },
];

function buildAvailableCommands(s) {
  const { orderedCommands, orderedSkills } = discoverSkillsAndCommands([
    s.cwd,
    ...s.additionalDirectories,
  ]);
  const seen = new Set();
  const out = [];
  const pushUnique = (cmd) => {
    if (!cmd?.name || /\s/.test(cmd.name)) return;
    const key = cmd.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cmd);
  };
  for (const c of BUILTIN_COMMANDS) pushUnique(c);
  for (const c of orderedCommands) {
    pushUnique({
      name: c.name,
      description: c.description,
      input: { hint: "optional arguments" },
    });
  }
  for (const sk of orderedSkills) {
    pushUnique({
      name: sk.name,
      description: sk.description,
      input: { hint: "optional prompt or arguments" },
    });
    pushUnique({
      name: `$${sk.name}`,
      description: sk.description,
    });
  }
  return out;
}

function clientSupportsCompactionUpdates(capabilities) {
  const compaction = capabilities?.session?.compaction;
  return typeof compaction === "object" && compaction !== null && !Array.isArray(compaction);
}

function estimateContextChars(s) {
  return (
    s.history.reduce((n, t) => n + t.text.length + 12, 0) +
    s.systemPrompt.length +
    s.t3Instructions.length +
    s.runtimeInfo.length +
    s.prLinking.length
  );
}

function emitUsageUpdate(s) {
  const used = Math.ceil(estimateContextChars(s) / 4);
  const size = Math.ceil(HISTORY_BUDGET_CHARS / 4);
  update(s.id, {
    sessionUpdate: "usage_update",
    used,
    size,
  });
}

function emitSessionReadyUpdates(s) {
  setImmediate(() => {
    if (!sessions.has(s.id)) return;
    update(s.id, {
      sessionUpdate: "available_commands_update",
      availableCommands: buildAvailableCommands(s),
    });
    emitUsageUpdate(s);
  });
}

function extractLastMatch(text, regex) {
  const matches = text.match(regex);
  return matches && matches.length > 0 ? matches[matches.length - 1] : "";
}

function stripT3Context(text) {
  let out = text
    .replace(T3_INSTRUCTIONS, "")
    .replace(RUNTIME_INFO, "")
    .replace(PR_LINKING, "")
    .trim();
  const wrapped = out.match(USER_REQUEST_WRAP);
  if (wrapped) out = wrapped[1].trim();
  return out;
}

function formatSkillBlock(item, args) {
  let content = "";
  try {
    content = readFileSync(item.path, "utf8");
  } catch (err) {
    log(`could not read ${item.path}: ${err.message}`);
    return "";
  }
  if (args) content = content.replace(/\$ARGUMENTS/g, args);
  return [
    `<invoked_skill name="${item.name}" kind="${item.kind}" path="${item.path}" dir="${item.dir}">`,
    content.trim(),
    `</invoked_skill>`,
  ].join("\n");
}

function skillSiblingNote() {
  return "If an invoked skill references another skill by name (e.g. obsidian-second-brain), read its SKILL.md from ~/.agents/skills/<name>/SKILL.md, ~/.claude/skills/<name>/SKILL.md, ~/.codex/skills/<name>/SKILL.md, or the project's .claude/skills/<name>/SKILL.md.";
}

function expandDollarSkills(text, s) {
  const { skills } = discoverSkillsAndCommands([s.cwd, ...s.additionalDirectories]);
  const blocks = [];
  const seen = new Set();
  const re = /(?:^|[\s(])\$([a-zA-Z0-9][a-zA-Z0-9._-]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].toLowerCase();
    if (seen.has(key)) continue;
    const item = skills.get(key);
    if (!item) continue;
    seen.add(key);
    const block = formatSkillBlock(item, "");
    if (block) blocks.push(block);
    if (blocks.length >= 3) break;
  }
  if (blocks.length === 0) return text;
  return `${blocks.join("\n\n")}\n\n${skillSiblingNote()}\n\n${text}`;
}

// `ntl -p` is one-shot, and --continue/--resume only work interactively,
// so the adapter replays prior turns in each prompt.
function buildInput(session, text) {
  if (session.history.length === 0) return text;
  const kept = [];
  let used = 0;
  for (let i = session.history.length - 1; i >= 0; i--) {
    const t = session.history[i];
    const line = `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`;
    if (kept.length > 0 && used + line.length > HISTORY_BUDGET_CHARS) break;
    kept.unshift(line);
    used += line.length;
  }
  return [
    "Continue this conversation. Earlier turns:",
    "",
    kept.join("\n\n"),
    "",
    `User: ${text}`,
    "",
    "Reply only to the latest user message.",
  ].join("\n");
}

// ntl models sometimes leak their tool-call fences (```tool:run_shell …)
// into the final answer text. T3 would execute those fences a second time
// and paste the results back into the next user message, so the model sees
// outputs it never ran itself and loops. Strip them: the internal tool
// rounds already happened inside ntl, and the [Actions this turn] note
// records what ran.
function stripToolFences(text) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && /^\s*```tool:/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^\s*```\s*$/.test(line)) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toolKind(text) {
  if (/^(Ran|Running)\b/i.test(text)) return "execute";
  if (/^(Read|Viewed)\b/i.test(text)) return "read";
  if (/^Deleted\b/i.test(text)) return "delete";
  if (/^(Edited|Wrote|Created|Changed|Moved)\b/i.test(text)) return "edit";
  if (/^(Searched|Listed|Found)\b/i.test(text)) return "search";
  return "other";
}

// ntl streams the model's raw text to stderr as progress. The model
// sometimes echoes tool-call fences there; passing them through as thought
// chunks makes the client execute them a second time, so suppress whole
// ```tool: blocks exactly like stripToolFences does for final text.
function makeFenceFilter() {
  let open = false;
  return (line) => {
    const t = line.trim();
    if (open) {
      if (/^```\s*$/.test(t)) open = false;
      return false;
    }
    if (/^```tool:/.test(t)) {
      open = true;
      return false;
    }
    return true;
  };
}

function extractLocation(text) {
  const m = text.match(/(?:^|\s)(\/[^\s"'():]+)/);
  if (!m) return undefined;
  const path = m[1];
  try {
    if (existsSync(path)) return [{ path }];
  } catch {
    // ignore
  }
  return undefined;
}

function buildFileDiffContent(cwd, file) {
  const absPath = isAbsolute(file) ? file : resolve(cwd, file);
  try {
    if (!existsSync(absPath)) return null;
    const st = statSync(absPath);
    if (!st.isFile() || st.size > 200_000) return { absPath, diff: null };
    const buf = readFileSync(absPath);
    if (buf.includes(0)) return { absPath, diff: null };
    const newText = buf.toString("utf8");
    let oldText = null;
    try {
      const rel = relative(cwd, absPath);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
        oldText = execFileSync("git", ["-C", cwd, "show", `HEAD:${rel}`], {
          encoding: "utf8",
          timeout: 1000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      }
    } catch {
      oldText = null;
    }
    return {
      absPath,
      diff: { type: "diff", path: absPath, oldText, newText },
    };
  } catch {
    return null;
  }
}

// Turns one stderr line from ntl into an ACP update while the turn runs.
function reportProgress(session, raw, actions) {
  const line = raw.trim();
  if (line === "") return;
  const m = line.match(TOOL_LINE);
  if (m) {
    const text = m[2].trim();
    actions.push(text);
    const locations = extractLocation(text);
    update(session.id, {
      sessionUpdate: "tool_call",
      toolCallId: randomUUID(),
      title: text,
      kind: toolKind(text),
      status: m[1] === "\u2717" ? "failed" : "completed",
      ...(locations ? { locations } : {}),
    });
    return;
  }
  update(session.id, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: `${line}\n` },
  });
}

// ntl may start child processes (shell commands). Killing only ntl would leave
// them holding the output pipes open, so signal the whole process group.
function killTree(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

const t3McpToolCache = new Map();

function shellQuote(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function envT3Mcp() {
  const endpoint = process.env.T3_ACP_MCP_ENDPOINT;
  const authorization = process.env.T3_ACP_MCP_AUTHORIZATION;
  if (!endpoint || !authorization) return null;
  return { endpoint, authorization };
}

function extractT3Mcp(mcpServers) {
  if (!Array.isArray(mcpServers)) return null;
  const entry = mcpServers.find((s) => s?.name === "t3-code");
  if (!entry) return null;
  if (Array.isArray(entry.env)) {
    const map = new Map(
      entry.env
        .filter((e) => typeof e?.name === "string" && typeof e?.value === "string")
        .map((e) => [e.name, e.value]),
    );
    const endpoint = map.get("T3_ACP_MCP_ENDPOINT");
    const authorization = map.get("T3_ACP_MCP_AUTHORIZATION");
    if (endpoint && authorization) return { endpoint, authorization };
  }
  if (typeof entry.url === "string" && Array.isArray(entry.headers)) {
    const auth = entry.headers.find(
      (h) => typeof h?.name === "string" && h.name.toLowerCase() === "authorization",
    )?.value;
    if (auth) return { endpoint: entry.url, authorization: auth };
  }
  return null;
}

function parseMcpResponse(text, contentType) {
  if (contentType?.includes("text/event-stream") || /^\s*event:|^\s*data:/m.test(text)) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(dataLines[i]);
      } catch {
        // try earlier event
      }
    }
  }
  return JSON.parse(text);
}

async function mcpRequest(t3Mcp, method, params, timeoutMs = 5000) {
  const headers = (sid) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: t3Mcp.authorization,
    ...(sid ? { "mcp-session-id": sid } : {}),
  });
  const initRes = await fetch(t3Mcp.endpoint, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "ntl-acp", version: "1.4.0" },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!initRes.ok) {
    throw new Error(`T3 MCP initialize HTTP ${initRes.status}`);
  }
  const sid = initRes.headers.get("mcp-session-id");
  const res = await fetch(t3Mcp.endpoint, {
    method: "POST",
    headers: headers(sid),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`T3 MCP ${method} HTTP ${res.status}`);
  }
  const body = await res.text();
  const parsed = parseMcpResponse(body, res.headers.get("content-type"));
  if (parsed?.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }
  return parsed?.result;
}

async function fetchT3McpTools(t3Mcp) {
  if (!t3Mcp) return null;
  const cached = t3McpToolCache.get(t3Mcp.endpoint);
  if (cached) return cached;
  try {
    const result = await mcpRequest(t3Mcp, "tools/list", {}, 2500);
    const tools = Array.isArray(result?.tools) ? result.tools : null;
    if (tools && tools.length > 0) t3McpToolCache.set(t3Mcp.endpoint, tools);
    return tools;
  } catch (err) {
    log(`could not list T3 MCP tools: ${err.message}`);
    return null;
  }
}

function formatT3McpNote(tools) {
  const selfCmd = `${shellQuote(process.execPath)} ${shellQuote(SELF_SCRIPT)}`;
  const lines = [
    "T3 Code MCP tools ARE available to you via shell (even though they do not appear as native function tools).",
    `Never claim you lack a T3 Code tool (such as reading or launching threads). Run:`,
    `  ${selfCmd} --t3-mcp-call <tool> '<json-object>'`,
    `To inspect a tool's full schema and parameter descriptions before calling it, run:`,
    `  ${selfCmd} --t3-mcp-schema <tool>`,
  ];
  if (Array.isArray(tools) && tools.length > 0) {
    lines.push("Available T3 Code tools (* = required):");
    for (const t of tools) {
      const props = Object.keys(t.inputSchema?.properties ?? {});
      const req = Array.isArray(t.inputSchema?.required) ? t.inputSchema.required : [];
      const sig = props.map((p) => (req.includes(p) ? `${p}*` : p)).join(", ");
      lines.push(`- ${t.name}(${sig})`);
    }
  }
  return lines.join("\n");
}

// Tells ntl what it can actually do this turn. Without this, the model
// sometimes believes it is a plain chat session and tells the user to run
// commands themselves, even when it is allowed to.
function capabilityNote(preset, session) {
  const notes = [];
  if (preset.writes)
    notes.push(
      "You have direct file write access in this environment: create and edit files yourself; never tell the user to make changes manually.",
    );
  if (preset.shell)
    notes.push(
      "You have live shell access: run commands yourself; they execute on this machine. Never tell the user to run commands in their own terminal.",
    );
  if (!preset.writes)
    notes.push(
      "This run is read-only for files: do not modify or create files; describe needed changes instead.",
    );
  if (!preset.shell)
    notes.push(
      "This run cannot execute shell commands: give the user the exact commands instead of trying to run them.",
    );
  if (session.plan)
    notes.push(
      "Plan mode: produce a clear, concrete plan of the changes you would make, with steps and risks. Do not implement anything.",
    );
  return notes.join(" ");
}

async function runNtl(session, input, preset, opts = {}) {
  const skipT3Context = opts.skipT3Context === true;
  const t3Mcp = !skipT3Context ? (session.t3Mcp ?? envT3Mcp()) : null;
  const t3Tools = preset.shell && t3Mcp ? await fetchT3McpTools(t3Mcp) : null;
  const t3McpBlock =
    preset.shell && t3Mcp ? `\n\n${formatT3McpNote(t3Tools)}` : "";

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--no-color",
      "-m",
      session.model,
    ];
    if (preset.writes) args.push("--allow-writes");
    if (preset.shell) args.push("--allow-shell");
    if (session.mcp) args.push("--allow-mcp");
    if (session.web) args.push("--web");
    if (session.maxTurns !== "default") args.push("--max-turns", session.maxTurns);

    const childEnv = { ...process.env, NO_COLOR: "1" };
    if (t3Mcp) {
      childEnv.T3_ACP_MCP_ENDPOINT = t3Mcp.endpoint;
      childEnv.T3_ACP_MCP_AUTHORIZATION = t3Mcp.authorization;
    }

    const child = spawn(NTL, args, {
      cwd: WORKDIR,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });
    running.set(session.id, child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", () => {}); // ntl may exit before reading its input

    let stdout = "";
    let stderr = "";
    let partial = "";
    const actions = [];
    const keepLine = makeFenceFilter();
    let timedOut = false;
    let force;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      force = setTimeout(() => killTree(child, "SIGKILL"), CANCEL_GRACE_MS);
    }, TURN_TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      partial += d;
      let nl = partial.indexOf("\n");
      while (nl !== -1) {
        const line = partial.slice(0, nl);
        partial = partial.slice(nl + 1);
        nl = partial.indexOf("\n");
        if (keepLine(line)) reportProgress(session, line, actions);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      running.delete(session.id);
      reject(
        new RpcError(-32000, `Could not start ntl at ${NTL}: ${err.message}`),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(force);
      running.delete(session.id);
      if (keepLine(partial)) reportProgress(session, partial, actions);
      if (session.cancelled) return resolve({ cancelled: true });
      if (timedOut) {
        return reject(
          new RpcError(
            -32000,
            `ntl timed out after ${TURN_TIMEOUT_MS / 1000}s; set NTL_ACP_TIMEOUT_MS for longer turns`,
          ),
        );
      }
      if (signal) {
        return reject(
          new RpcError(-32000, `ntl stopped (${signal}) before finishing`),
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        return reject(
          new RpcError(
            -32000,
            `ntl returned no JSON (exit ${code}): ${stripToolFences(stderr.trim()).slice(0, 500)}`,
          ),
        );
      }
      if (parsed.is_error || code !== 0) {
        const msg = stripToolFences(String(parsed.result ?? ""));
        return reject(
          new RpcError(-32000, msg || `ntl failed (exit ${code})`),
        );
      }
      resolve({
        cancelled: false,
        text: parsed.result ?? "",
        files: Array.isArray(parsed.files_changed) ? parsed.files_changed : [],
        actions: actions.slice(-MAX_ACTIONS_PER_TURN),
      });
    });

    const savedContext = [];
    if (!skipT3Context) {
      if (session.systemPrompt) savedContext.push(session.systemPrompt);
      if (session.t3Instructions && !/<t3_code_instructions>/.test(input)) {
        savedContext.push(session.t3Instructions);
      }
      if (session.runtimeInfo && !/<runtime_info>/.test(input)) {
        savedContext.push(session.runtimeInfo);
      }
      if (session.prLinking && !/<pull_request_linking>/.test(input)) {
        savedContext.push(session.prLinking);
      }
    }
    const extraDirsNote =
      session.additionalDirectories.length > 0
        ? `\nAdditional workspace directories: ${session.additionalDirectories.join(", ")}`
        : "";
    const contextPrefix =
      savedContext.length > 0 ? `${savedContext.join("\n\n")}\n\n` : "";
    child.stdin.end(
      `Project directory for this task: ${session.cwd}${extraDirsNote}\n` +
        `Environment: ${capabilityNote(preset, session)}${t3McpBlock}\n\n` +
        `${contextPrefix}${input}`,
    );
  });
}

function cancel(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cancelled = true;
  const child = running.get(sessionId);
  if (!child) return;
  killTree(child, "SIGTERM");
  const force = setTimeout(() => killTree(child, "SIGKILL"), CANCEL_GRACE_MS);
  child.once("close", () => clearTimeout(force));
}

// Maps the mode ids a client may send onto ntl permission presets. Accepts
// this adapter's own ids, common aliases, and T3 Code's runtime-mode names.
function resolveModeId(modeId) {
  switch (modeId) {
    case "read-only":
    case "readonly":
      return "read-only";
    case "edit":
      return "edit";
    case "edit-and-shell":
    case "full-access":
    case "auto":
    case "auto-accept-edits":
    case "default":
      return "edit-and-shell";
    case "approval-required":
      return "edit";
    case "plan":
      return "read-only";
    default:
      return null;
  }
}

function modeState(s) {
  return {
    currentModeId: s.mode,
    availableModes: [
      {
        id: "read-only",
        name: "Read only",
        description: "ntl inspects and reports; no file changes, no shell",
      },
      {
        id: "edit",
        name: "Edit files",
        description: "ntl edits files; no shell",
      },
      {
        id: "edit-and-shell",
        name: "Full access",
        description: "ntl edits files and runs shell commands",
      },
    ],
  };
}

// When the session preset denies file or shell access, ask the user through
// the client's permission UI before the turn, the way other T3 Code agents do.
// Resolves with "allow-once", "allow-always", "reject", "cancelled" (the
// client's outcome), or "unsupported" (the client answered with an error or
// never did; the turn then proceeds with the current preset).
async function requestTurnPermission(s, preset) {
  const gap = preset.writes ? "shell commands" : "file edits and shell commands";
  const toolCallId = randomUUID();
  const title = `ntl is running "${s.mode}"`;
  const question =
    `This ntl session is restricted to "${s.mode}". ` +
    `Allow ntl to run ${gap} for this turn?`;
  update(s.id, {
    sessionUpdate: "tool_call",
    toolCallId,
    title,
    kind: preset.writes ? "execute" : "edit",
    status: "pending",
    content: [
      {
        type: "content",
        content: { type: "text", text: question },
      },
    ],
  });
  const resp = await callClient(
    "session/request_permission",
    {
      sessionId: s.id,
      toolCall: {
        toolCallId,
        title,
        kind: preset.writes ? "execute" : "edit",
        status: "pending",
        content: [
          { type: "content", content: { type: "text", text: question } },
        ],
      },
      options: [
        {
          optionId: "allow-once",
          name: preset.writes
            ? "Allow shell for this turn"
            : "Allow this turn with full access",
          kind: "allow_once",
        },
        {
          optionId: "allow-always",
          name: "Switch session to full access",
          kind: "allow_always",
        },
        { optionId: "reject", name: "Keep restricted", kind: "reject_once" },
      ],
    },
    PERMISSION_TIMEOUT_MS,
  );
  let outcome;
  if (resp?.result?.outcome?.outcome === "selected") {
    const optionId = resp.result.outcome.optionId;
    outcome = ["allow-once", "allow-always", "reject"].includes(optionId)
      ? optionId
      : "unsupported";
  } else if (resp?.result?.outcome?.outcome === "cancelled") {
    outcome = "cancelled";
  } else {
    outcome = "unsupported";
  }
  update(s.id, {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: outcome === "cancelled" ? "in_progress" : outcome === "reject" || outcome === "unsupported" ? "failed" : "completed",
  });
  return outcome;
}

async function handleBuiltinCommand(s, cmdName, cmdArgs) {
  const sendText = (msg) =>
    update(s.id, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: msg },
    });

  switch (cmdName) {
    case "clear": {
      s.history = [];
      persist(s);
      emitUsageUpdate(s);
      sendText("Session history cleared.");
      return { handled: true, stopReason: "end_turn" };
    }

    case "status": {
      const t3Mcp = s.t3Mcp ?? envT3Mcp();
      const discovered = discoverSkillsAndCommands([
        s.cwd,
        ...s.additionalDirectories,
      ]);
      const chars = estimateContextChars(s);
      const summary = [
        `**ntl-acp status** (v1.4.0)`,
        `- **Session:** \`${s.id}\``,
        `- **CWD:** \`${s.cwd}\``,
        `- **Model:** \`${s.model}\``,
        `- **Mode:** \`${s.mode}\` (plan: ${s.plan ? "on" : "off"})`,
        `- **Web search:** ${s.web ? "on" : "off"} | **Native MCP:** ${s.mcp ? "on" : "off"} | **Max turns:** ${s.maxTurns}`,
        `- **Context:** ${s.history.length} turns (~${Math.ceil(chars / 4)} / ${Math.ceil(HISTORY_BUDGET_CHARS / 4)} est. tokens)`,
        `- **T3 MCP bridge:** ${t3Mcp ? "connected" : "not configured"}`,
        `- **Discovered:** ${discovered.orderedSkills.length} skills, ${discovered.orderedCommands.length} commands`,
      ].join("\n");
      sendText(summary);
      return { handled: true, stopReason: "end_turn" };
    }

    case "plan": {
      s.mode = "read-only";
      s.plan = true;
      persist(s);
      update(s.id, { sessionUpdate: "current_mode_update", currentModeId: s.mode });
      update(s.id, { sessionUpdate: "config_option_update", configOptions: configOptions(s) });
      sendText("Switched to **plan** mode (`read-only`).");
      return { handled: true, stopReason: "end_turn" };
    }

    case "skills": {
      const { orderedSkills, orderedCommands } = discoverSkillsAndCommands([
        s.cwd,
        ...s.additionalDirectories,
      ]);
      const lines = [
        `**Discovered Skills (${orderedSkills.length}) & Commands (${orderedCommands.length})**`,
        "Invoke with `/name [args]` or `$skill-name`.",
      ];
      if (orderedCommands.length > 0) {
        lines.push("", "**Commands:**");
        for (const c of orderedCommands.slice(0, 40)) {
          lines.push(`- \`/${c.name}\` — ${c.description}`);
        }
      }
      if (orderedSkills.length > 0) {
        lines.push("", "**Skills:**");
        for (const sk of orderedSkills.slice(0, 60)) {
          lines.push(`- \`/${sk.name}\` / \`$${sk.name}\` — ${sk.description}`);
        }
        if (orderedSkills.length > 60) {
          lines.push(`- ...and ${orderedSkills.length - 60} more`);
        }
      }
      sendText(lines.join("\n"));
      return { handled: true, stopReason: "end_turn" };
    }

    case "mcp": {
      const t3Mcp = s.t3Mcp ?? envT3Mcp();
      const tools = t3Mcp ? await fetchT3McpTools(t3Mcp) : null;
      const lines = [
        `**MCP Status**`,
        `- **T3 Code MCP bridge:** ${t3Mcp ? `connected (${tools ? `${tools.length} tools` : "endpoint reachable"})` : "not present"}`,
        `- **ntl native \`--allow-mcp\`:** ${s.mcp ? "on" : "off"} (Max plan only in ntl CLI)`,
      ];
      sendText(lines.join("\n"));
      return { handled: true, stopReason: "end_turn" };
    }

    case "web": {
      const arg = cmdArgs.trim().toLowerCase();
      if (arg && arg !== "on" && arg !== "off") {
        sendText(`Usage: \`/web [on | off]\` (currently ${s.web ? "on" : "off"}).`);
        return { handled: true, stopReason: "end_turn" };
      }
      s.web = arg ? arg === "on" : !s.web;
      persist(s);
      update(s.id, { sessionUpdate: "config_option_update", configOptions: configOptions(s) });
      sendText(`Web search is now **${s.web ? "on" : "off"}**.`);
      return { handled: true, stopReason: "end_turn" };
    }

    case "model": {
      const arg = cmdArgs.trim();
      if (!arg) {
        const list = getModels()
          .map((m) => `- \`${m.id}\` (${m.name})${m.id === s.model ? " **(active)**" : ""}`)
          .join("\n");
        sendText(`Current model: \`${s.model}\`\n\nAvailable models:\n${list}`);
        return { handled: true, stopReason: "end_turn" };
      }
      if (!isKnownModel(arg)) {
        sendText(`Unknown model: \`${arg}\`. Run \`/model\` to list available models.`);
        return { handled: true, stopReason: "end_turn" };
      }
      s.model = arg;
      persist(s);
      update(s.id, { sessionUpdate: "config_option_update", configOptions: configOptions(s) });
      sendText(`Switched model to \`${s.model}\`.`);
      return { handled: true, stopReason: "end_turn" };
    }

    case "mode": {
      const arg = cmdArgs.trim();
      if (!arg) {
        sendText(
          `Current mode: \`${s.mode}\` (plan: ${s.plan ? "on" : "off"}). Options: \`read-only\`, \`edit\`, \`edit-and-shell\`, \`plan\`.`,
        );
        return { handled: true, stopReason: "end_turn" };
      }
      const mapped = resolveModeId(arg);
      if (!mapped) {
        sendText(`Unknown mode: \`${arg}\`. Options: \`read-only\`, \`edit\`, \`edit-and-shell\`, \`plan\`.`);
        return { handled: true, stopReason: "end_turn" };
      }
      s.mode = mapped;
      s.plan = arg === "plan";
      persist(s);
      update(s.id, { sessionUpdate: "current_mode_update", currentModeId: s.mode });
      update(s.id, { sessionUpdate: "config_option_update", configOptions: configOptions(s) });
      sendText(`Switched permissions to \`${s.mode}\`${s.plan ? " (plan)" : ""}.`);
      return { handled: true, stopReason: "end_turn" };
    }

    case "compact": {
      const compactionId = randomUUID();
      const useCompactionUpdate = clientSupportsCompactionUpdates(clientCapabilities);
      const emitStart = () => {
        if (useCompactionUpdate) {
          update(s.id, {
            sessionUpdate: "compaction_update",
            compactionId,
            status: "in_progress",
          });
        } else {
          update(s.id, {
            sessionUpdate: "tool_call",
            toolCallId: compactionId,
            title: "Compact conversation",
            kind: "other",
            status: "in_progress",
          });
        }
      };
      const emitEnd = (status, summaryText, errMsg) => {
        if (useCompactionUpdate) {
          update(s.id, {
            sessionUpdate: "compaction_update",
            compactionId,
            status,
            ...(status === "completed" && summaryText
              ? { summary: [{ type: "text", text: summaryText }] }
              : {}),
            ...(status === "failed" && errMsg ? { error: errMsg } : {}),
          });
        } else {
          update(s.id, {
            sessionUpdate: "tool_call_update",
            toolCallId: compactionId,
            status: status === "completed" ? "completed" : status === "cancelled" ? "in_progress" : "failed",
            ...(summaryText
              ? { content: [{ type: "content", content: { type: "text", text: summaryText } }] }
              : {}),
          });
        }
      };

      emitStart();
      if (s.history.length === 0) {
        emitEnd("completed", "History is already empty.");
        emitUsageUpdate(s);
        sendText("History is already empty; nothing to compact.");
        return { handled: true, stopReason: "end_turn" };
      }
      const focusNote = cmdArgs.trim() ? `\nFocus instructions: ${cmdArgs.trim()}\n` : "";
      const transcript = s.history
        .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
        .join("\n\n")
        .slice(-HISTORY_BUDGET_CHARS);
      const compactPrompt = [
        "Summarize the conversation below into a concise, high-signal continuation summary.",
        "Preserve user goals, architectural decisions, exact file paths, symbol names, test results, and pending next steps.",
        focusNote,
        "Conversation:",
        transcript,
      ].join("\n\n");
      try {
        const res = await runNtl(s, compactPrompt, MODES["read-only"], {
          skipT3Context: true,
        });
        if (res.cancelled) {
          emitEnd("cancelled");
          return { handled: true, stopReason: "cancelled" };
        }
        const summary = stripToolFences(res.text) || "Compacted prior conversation.";
        s.history = [
          {
            role: "assistant",
            text: `[Compacted conversation summary]\n${summary}`,
          },
        ];
        persist(s);
        emitEnd("completed", summary);
        emitUsageUpdate(s);
        sendText(`Compacted conversation history:\n\n${summary}`);
        return { handled: true, stopReason: "end_turn" };
      } catch (err) {
        emitEnd("failed", undefined, err.message);
        throw err;
      }
    }

    default:
      return { handled: false };
  }
}

async function probeStdioMcpServer(server) {
  if (!server || typeof server.command !== "string" || server.name === "t3-code") {
    return;
  }
  const extraEnv = {};
  if (Array.isArray(server.env)) {
    for (const e of server.env) {
      if (typeof e?.name === "string" && typeof e?.value === "string") {
        extraEnv[e.name] = e.value;
      }
    }
  } else if (server.env && typeof server.env === "object") {
    for (const [k, v] of Object.entries(server.env)) {
      if (typeof v === "string") extraEnv[k] = v;
    }
  }
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  await new Promise((resolveDone) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveDone();
    };
    let child;
    try {
      child = spawn(server.command, args, {
        env: { ...process.env, ...extraEnv },
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      finish();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      finish();
    }, 1500);
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("\n")) {
        clearTimeout(timer);
        try {
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
              params: {},
            })}\n`,
          );
          child.stdin.end();
        } catch {
          // ignore
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        finish();
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish();
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish();
    });
    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "ntl-acp", version: "1.4.0" },
          },
        })}\n`,
      );
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

async function connectStdioMcpServers(mcpServers) {
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) return;
  await Promise.all(mcpServers.map((srv) => probeStdioMcpServer(srv)));
}

async function handle(method, params) {
  if (!initialized && method !== "initialize") {
    throw new RpcError(-32600, "Agent not initialized");
  }

  switch (method) {
    case "initialize": {
      initialized = true;
      clientCapabilities = params?.clientCapabilities ?? {};
      log(
        `client: ${params?.clientInfo?.name ?? "unknown"} ${params?.clientInfo?.version ?? ""} ` +
          `(fs=${clientCapabilities.fs?.readTextFile ? "r" : ""}${clientCapabilities.fs?.writeTextFile ? "w" : ""}, terminal=${clientCapabilities.terminal ? "yes" : "no"})`,
      );
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: true,
            audio: false,
            embeddedContext: true,
          },
          sessionCapabilities: {
            list: {},
            fork: {},
            resume: {},
            close: {},
            delete: {},
            additionalDirectories: {},
          },
        },
        agentInfo: {
          name: "ntl-acp",
          title: "NoTokenLimit (ntl)",
          version: "1.4.0",
        },
        authMethods: [],
      };
    }

    case "authenticate":
      // Auth is the existing `ntl login`; nothing to do here.
      return {};

    case "session/new": {
      if (typeof params?.cwd !== "string" || !isAbsolute(params.cwd)) {
        throw new RpcError(-32602, "session/new requires an absolute cwd");
      }
      const additionalDirectories = parseAdditionalDirectories(
        params?.additionalDirectories,
      );
      const systemPrompt = parseSystemPrompt(params?.systemPrompt);
      const s = newSession(randomUUID(), params.cwd);
      s.additionalDirectories = additionalDirectories;
      s.systemPrompt = systemPrompt;
      s.t3Mcp = extractT3Mcp(params?.mcpServers);
      await connectStdioMcpServers(params?.mcpServers);
      sessions.set(s.id, s);
      persist(s);
      emitSessionReadyUpdates(s);
      return {
        sessionId: s.id,
        configOptions: configOptions(s),
        modes: modeState(s),
      };
    }

    case "session/load": {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new RpcError(-32602, "session/load requires sessionId");
      }
      if (
        params?.cwd !== undefined &&
        (typeof params.cwd !== "string" || !isAbsolute(params.cwd))
      ) {
        throw new RpcError(-32602, "session/load cwd must be an absolute path");
      }
      const additionalDirs =
        params?.additionalDirectories !== undefined
          ? parseAdditionalDirectories(params.additionalDirectories)
          : undefined;
      if (sessions.has(sessionId)) {
        const s = sessions.get(sessionId);
        s.t3Mcp = extractT3Mcp(params?.mcpServers) ?? s.t3Mcp;
        if (additionalDirs !== undefined) s.additionalDirectories = additionalDirs;
        await connectStdioMcpServers(params?.mcpServers);
        emitSessionReadyUpdates(s);
        return {
          configOptions: configOptions(s),
          modes: modeState(s),
        };
      }
      const saved = readPersisted(sessionId);
      if (!saved) {
        throw new RpcError(-32002, `Unknown session: ${sessionId}`, {
          sessionId,
        });
      }
      const cwd = typeof params?.cwd === "string" ? params.cwd : saved.cwd;
      const s = hydrateSession(
        sessionId,
        cwd,
        saved,
        params?.mcpServers,
        additionalDirs,
      );
      await connectStdioMcpServers(params?.mcpServers);
      sessions.set(s.id, s);
      for (const turn of s.history) {
        update(s.id, {
          sessionUpdate:
            turn.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          content: { type: "text", text: turn.text },
        });
      }
      emitSessionReadyUpdates(s);
      return {
        configOptions: configOptions(s),
        modes: modeState(s),
      };
    }

    case "session/resume": {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new RpcError(-32602, "session/resume requires sessionId");
      }
      if (
        params?.cwd !== undefined &&
        (typeof params.cwd !== "string" || !isAbsolute(params.cwd))
      ) {
        throw new RpcError(-32602, "session/resume cwd must be an absolute path");
      }
      const additionalDirs =
        params?.additionalDirectories !== undefined
          ? parseAdditionalDirectories(params.additionalDirectories)
          : undefined;
      if (sessions.has(sessionId)) {
        const s = sessions.get(sessionId);
        s.t3Mcp = extractT3Mcp(params?.mcpServers) ?? s.t3Mcp;
        if (additionalDirs !== undefined) s.additionalDirectories = additionalDirs;
        await connectStdioMcpServers(params?.mcpServers);
        emitSessionReadyUpdates(s);
        return {
          configOptions: configOptions(s),
          modes: modeState(s),
        };
      }
      const saved = readPersisted(sessionId);
      if (!saved) {
        throw new RpcError(-32002, `Unknown session: ${sessionId}`, {
          sessionId,
        });
      }
      const cwd = typeof params?.cwd === "string" ? params.cwd : saved.cwd;
      const s = hydrateSession(
        sessionId,
        cwd,
        saved,
        params?.mcpServers,
        additionalDirs,
      );
      await connectStdioMcpServers(params?.mcpServers);
      sessions.set(s.id, s);
      emitSessionReadyUpdates(s);
      return {
        configOptions: configOptions(s),
        modes: modeState(s),
      };
    }

    case "session/fork": {
      if (
        (params?.cursorId !== undefined && params?.cursorId !== null) ||
        (params?.cursor !== undefined && params?.cursor !== null)
      ) {
        throw new RpcError(-32602, "Unknown session cursor");
      }
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new RpcError(-32602, "session/fork requires sessionId");
      }
      if (
        params?.cwd !== undefined &&
        (typeof params.cwd !== "string" || !isAbsolute(params.cwd))
      ) {
        throw new RpcError(-32602, "session/fork cwd must be an absolute path");
      }
      const additionalDirs =
        params?.additionalDirectories !== undefined
          ? parseAdditionalDirectories(params.additionalDirectories)
          : undefined;
      let src = sessions.get(sessionId);
      if (!src) {
        const saved = readPersisted(sessionId);
        if (!saved) {
          throw new RpcError(-32002, `Unknown session: ${sessionId}`, {
            sessionId,
          });
        }
        src = hydrateSession(sessionId, saved.cwd, saved, undefined, undefined);
      }
      const forked = newSession(
        randomUUID(),
        typeof params?.cwd === "string" ? params.cwd : src.cwd,
      );
      forked.additionalDirectories = additionalDirs ?? [...src.additionalDirectories];
      forked.model = src.model;
      forked.mode = src.mode;
      forked.plan = src.plan;
      forked.mcp = src.mcp;
      forked.web = src.web;
      forked.maxTurns = src.maxTurns;
      forked.systemPrompt = src.systemPrompt;
      forked.t3Instructions = src.t3Instructions;
      forked.runtimeInfo = src.runtimeInfo;
      forked.prLinking = src.prLinking;
      forked.title = src.title;
      forked.t3Mcp = extractT3Mcp(params?.mcpServers) ?? src.t3Mcp;
      forked.history = src.history.map((t) => ({ ...t }));
      await connectStdioMcpServers(params?.mcpServers);
      sessions.set(forked.id, forked);
      persist(forked);
      emitSessionReadyUpdates(forked);
      return {
        sessionId: forked.id,
        configOptions: configOptions(forked),
        modes: modeState(forked),
      };
    }

    case "session/list": {
      if (
        (params?.cursor !== undefined && params?.cursor !== null) ||
        (params?.cursorId !== undefined && params?.cursorId !== null)
      ) {
        throw new RpcError(-32602, "Unknown cursor");
      }
      if (
        params?.cwd !== undefined &&
        (typeof params.cwd !== "string" || !isAbsolute(params.cwd))
      ) {
        throw new RpcError(-32602, "session/list cwd must be an absolute path");
      }
      const list = [];
      let files = [];
      try {
        files = readdirSync(STATE_DIR);
      } catch {
        files = [];
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const id = file.slice(0, -5);
        if (!SESSION_ID.test(id)) continue;
        const full = join(STATE_DIR, file);
        try {
          const data = JSON.parse(readFileSync(full, "utf8"));
          if (typeof data?.cwd !== "string" || !isAbsolute(data.cwd)) continue;
          if (params?.cwd && data.cwd !== params.cwd) continue;
          let updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : null;
          if (!updatedAt) {
            updatedAt = new Date(statSync(full).mtimeMs).toISOString();
          }
          const info = {
            sessionId: id,
            cwd: data.cwd,
            title: typeof data.title === "string" ? data.title : null,
            updatedAt,
          };
          if (Array.isArray(data.additionalDirectories) && data.additionalDirectories.length > 0) {
            info.additionalDirectories = data.additionalDirectories.filter(
              (d) => typeof d === "string" && isAbsolute(d),
            );
          }
          list.push(info);
        } catch {
          // skip unreadable or partial files
        }
      }
      list.sort((a, b) =>
        String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
      );
      return { sessions: list };
    }

    case "session/delete": {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new RpcError(-32602, "session/delete requires sessionId");
      }
      cancel(sessionId);
      sessions.delete(sessionId);
      rmSync(sessionFile(sessionId), { force: true });
      return {};
    }

    case "session/set_mode": {
      const s = getSession(params?.sessionId);
      const mapped = resolveModeId(params?.modeId);
      if (!mapped) {
        throw new RpcError(-32602, `Unknown modeId: ${params?.modeId}`);
      }
      const nextPlan = params?.modeId === "plan";
      if (mapped !== s.mode || s.plan !== nextPlan) {
        s.mode = mapped;
        s.plan = nextPlan;
        persist(s);
        update(s.id, {
          sessionUpdate: "current_mode_update",
          currentModeId: s.mode,
        });
        update(s.id, {
          sessionUpdate: "config_option_update",
          configOptions: configOptions(s),
        });
      }
      return {};
    }

    case "session/set_model": {
      const s = getSession(params?.sessionId);
      const modelId = params?.modelId;
      if (!isKnownModel(modelId)) {
        throw new RpcError(-32602, `Unknown modelId: ${modelId}`);
      }
      if (s.model !== modelId) {
        s.model = modelId;
        persist(s);
        update(s.id, {
          sessionUpdate: "config_option_update",
          configOptions: configOptions(s),
        });
      }
      return {};
    }

    case "session/set_config_option": {
      const s = getSession(params?.sessionId);
      const value = params?.value;
      switch (params?.configId) {
        case "model":
          if (!isKnownModel(value)) {
            throw new RpcError(-32602, `Unknown model: ${value}`);
          }
          s.model = value;
          break;
        case "mode": {
          let modeValue = value;
          if (modeValue === "plan") modeValue = "read-only";
          if (!Object.hasOwn(MODES, modeValue)) {
            throw new RpcError(-32602, `Unknown mode: ${value}`);
          }
          if (s.mode !== modeValue || s.plan !== (value === "plan")) {
            s.mode = modeValue;
            s.plan = value === "plan";
            update(s.id, {
              sessionUpdate: "current_mode_update",
              currentModeId: s.mode,
            });
          }
          break;
        }
        case "web":
          if (value !== "on" && value !== "off") {
            throw new RpcError(-32602, `Unknown web setting: ${value}`);
          }
          s.web = value === "on";
          break;
        case "mcp":
          if (value !== "on" && value !== "off") {
            throw new RpcError(-32602, `Unknown MCP setting: ${value}`);
          }
          s.mcp = value === "on";
          break;
        case "max_turns":
          if (!MAX_TURNS_OPTIONS.some((o) => o.value === value)) {
            throw new RpcError(-32602, `Unknown max-turns setting: ${value}`);
          }
          s.maxTurns = value;
          break;
        default:
          throw new RpcError(
            -32602,
            `Unknown config option: ${params?.configId}`,
          );
      }
      persist(s);
      const updated = configOptions(s);
      update(s.id, {
        sessionUpdate: "config_option_update",
        configOptions: updated,
      });
      return { configOptions: updated };
    }

    case "session/prompt": {
      const s = getSession(params?.sessionId);
      if (s.busy) {
        throw new RpcError(
          -32000,
          "Agent is already processing a prompt in this session",
        );
      }
      if (!Array.isArray(params?.prompt)) {
        throw new RpcError(-32602, "session/prompt requires a prompt array");
      }
      const text = promptText(params.prompt);
      if (text.trim() === "") throw new RpcError(-32602, "Prompt is empty");

      const nextInstr = extractLastMatch(text, T3_INSTRUCTIONS);
      if (nextInstr) s.t3Instructions = nextInstr;
      const nextRuntime = extractLastMatch(text, RUNTIME_INFO);
      if (nextRuntime) s.runtimeInfo = nextRuntime;
      const nextPr = extractLastMatch(text, PR_LINKING);
      if (nextPr) s.prLinking = nextPr;

      const cleanUserText = stripT3Context(text);

      s.busy = true;
      s.cancelled = false;
      try {
        const slashMatch = cleanUserText
          .trim()
          .match(/^\/([a-zA-Z0-9][a-zA-Z0-9._:-]*)(?:\s+([\s\S]*))?$/);
        let promptForNtl = text;
        let storedUserText = cleanUserText || "(empty message)";

        if (slashMatch) {
          const cmdName = slashMatch[1].toLowerCase();
          const cmdArgs = (slashMatch[2] ?? "").trim();
          const builtin = await handleBuiltinCommand(s, cmdName, cmdArgs);
          if (builtin.handled) {
            return { stopReason: builtin.stopReason };
          }
          const discovered = discoverSkillsAndCommands([
            s.cwd,
            ...s.additionalDirectories,
          ]);
          const item =
            discovered.commands.get(cmdName) ?? discovered.skills.get(cmdName);
          if (item) {
            const block = formatSkillBlock(item, cmdArgs);
            if (block) {
              const userLine = cmdArgs
                ? `User request: ${cmdArgs}`
                : `Execute this ${item.kind} for the current workspace and context.`;
              promptForNtl = `${block}\n\n${skillSiblingNote()}\n\n${userLine}`;
              storedUserText = cleanUserText.trim();
            }
          }
        } else {
          const expanded = expandDollarSkills(text, s);
          if (expanded !== text) {
            promptForNtl = expanded;
          }
        }

        const preset = MODES[s.mode];
        let effective = preset;
        if (!preset.writes || !preset.shell) {
          const decision = await requestTurnPermission(s, preset);
          if (decision === "cancelled") return { stopReason: "cancelled" };
          if (decision === "allow-once" || decision === "allow-always")
            effective = MODES["edit-and-shell"];
          if (decision === "allow-always") {
            s.mode = "edit-and-shell";
            s.plan = false;
            persist(s);
            update(s.id, {
              sessionUpdate: "current_mode_update",
              currentModeId: s.mode,
            });
            update(s.id, {
              sessionUpdate: "config_option_update",
              configOptions: configOptions(s),
            });
          } else {
            log(`permission decision for turn: ${decision}`);
          }
        }
        const result = await runNtl(s, buildInput(s, promptForNtl), effective);
        if (result.cancelled) return { stopReason: "cancelled" };

        const reply = stripToolFences(result.text);
        const actionNote =
          result.actions.length > 0
            ? `\n\n[Actions this turn: ${result.actions.join("; ")}]`
            : "";
        s.history.push(
          { role: "user", text: storedUserText },
          { role: "assistant", text: `${reply}${actionNote}` },
        );
        if (!s.title && storedUserText && storedUserText !== "(empty message)") {
          const firstLine = storedUserText.replace(/\s+/g, " ").trim();
          s.title = firstLine.slice(0, 80);
        }
        persist(s);
        if (s.title) {
          update(s.id, {
            sessionUpdate: "session_info_update",
            title: s.title,
            updatedAt: s.updatedAt,
          });
        }
        if (reply) {
          update(s.id, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: reply },
          });
        }
        for (const file of result.files) {
          const alreadyMentioned = result.actions.some((action) =>
            action.includes(file),
          );
          const diffInfo = buildFileDiffContent(s.cwd, file);
          if (alreadyMentioned && !diffInfo?.diff) continue;
          const toolCallId = randomUUID();
          const absPath = diffInfo?.absPath ?? (isAbsolute(file) ? file : resolve(s.cwd, file));
          const locations = existsSync(absPath) ? [{ path: absPath }] : undefined;
          update(s.id, {
            sessionUpdate: "tool_call",
            toolCallId,
            title: `Edited ${file}`,
            kind: "edit",
            status: "in_progress",
            ...(locations ? { locations } : {}),
          });
          update(s.id, {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
            ...(locations ? { locations } : {}),
            ...(diffInfo?.diff ? { content: [diffInfo.diff] } : {}),
          });
        }
        if (result.files.length > 0) {
          update(s.id, {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `Files changed: ${result.files.join(", ")}`,
            },
          });
        }
        emitUsageUpdate(s);
        return { stopReason: "end_turn" };
      } finally {
        s.busy = false;
      }
    }

    case "session/close": {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new RpcError(-32602, "session/close requires sessionId");
      }
      cancel(sessionId);
      sessions.delete(sessionId);
      return {};
    }

    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

function runCheck() {
  const child = spawn(NTL, ["--version"], { stdio: "inherit" });
  child.on("error", (err) => {
    log(`ntl not found at ${NTL}: ${err.message}`);
    process.exit(1);
  });
  child.on("close", (code) => process.exit(code ?? 1));
}

function main() {
  const rl = createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    if (line.trim() === "") return;

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      write({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    // Responses to our own client requests (e.g. session/request_permission)
    // carry no method; anything else without one is invalid and ignored.
    if (typeof msg.method !== "string") {
      if (msg.id !== undefined) {
        const pending = clientCalls.get(msg.id);
        if (pending) {
          clientCalls.delete(msg.id);
          clearTimeout(pending.timer);
          pending.resolve(msg);
        }
      }
      return;
    }

    if (msg.id === undefined) {
      if (msg.method === "session/cancel") {
        cancel(msg.params?.sessionId);
      } else if (msg.method === "$/cancel_request") {
        const sid = inFlightPrompts.get(msg.params?.id);
        if (sid) cancel(sid);
      }
      return;
    }

    if (
      msg.params !== undefined &&
      (typeof msg.params !== "object" ||
        msg.params === null ||
        Array.isArray(msg.params))
    ) {
      sendError(msg.id, new RpcError(-32602, "params must be an object"));
      return;
    }

    const params = msg.params ?? {};
    if (msg.method === "session/prompt" && typeof params.sessionId === "string") {
      inFlightPrompts.set(msg.id, params.sessionId);
    }

    handle(msg.method, params)
      .then((result) => sendResult(msg.id, result))
      .catch((err) => {
        if (!(err instanceof RpcError)) log(`internal error: ${err.stack}`);
        sendError(
          msg.id,
          err instanceof RpcError ? err : new RpcError(-32603, err.message),
        );
      })
      .finally(() => {
        if (msg.method === "session/prompt") inFlightPrompts.delete(msg.id);
      });
  });

  rl.on("close", () => {
    for (const sessionId of [...running.keys()]) cancel(sessionId);
    process.exit(0);
  });
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function runT3McpSchema(toolName) {
  const t3Mcp = envT3Mcp();
  if (!t3Mcp) {
    process.stderr.write("T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION must be set.\n");
    process.exit(2);
  }
  const result = await mcpRequest(t3Mcp, "tools/list", {}, 5000);
  const tools = result?.tools ?? [];
  if (!toolName) {
    process.stdout.write(`${JSON.stringify(tools.map((t) => t.name), null, 2)}\n`);
    return;
  }
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    process.stderr.write(`Unknown T3 MCP tool: ${toolName}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(tool, null, 2)}\n`);
}

async function runT3McpCall(toolName, rawArgs) {
  const t3Mcp = envT3Mcp();
  if (!t3Mcp) {
    process.stderr.write("T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION must be set.\n");
    process.exit(2);
  }
  if (!toolName) {
    process.stderr.write("Usage: ntl-acp --t3-mcp-call <tool> [json-object | -]\n");
    process.exit(2);
  }
  let argText = rawArgs;
  if (argText === "-") {
    argText = await readAllStdin();
  } else if (argText === undefined) {
    argText = process.stdin.isTTY ? "{}" : (await readAllStdin()) || "{}";
  }
  let parsedArgs;
  try {
    parsedArgs = JSON.parse(argText);
  } catch (err) {
    process.stderr.write(`Invalid JSON arguments: ${err.message}\n`);
    process.exit(2);
  }
  if (typeof parsedArgs !== "object" || parsedArgs === null || Array.isArray(parsedArgs)) {
    process.stderr.write("Tool arguments must be a JSON object.\n");
    process.exit(2);
  }
  const result = await mcpRequest(
    t3Mcp,
    "tools/call",
    { name: toolName, arguments: parsedArgs },
    30_000,
  );
  const out =
    result && typeof result === "object" && "structuredContent" in result && result.structuredContent !== undefined
      ? result.structuredContent
      : result;
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (result?.isError) process.exit(1);
}

const schemaIdx = process.argv.indexOf("--t3-mcp-schema");
const callIdx = process.argv.indexOf("--t3-mcp-call");
if (process.argv.includes("--check")) {
  runCheck();
} else if (schemaIdx !== -1) {
  runT3McpSchema(process.argv[schemaIdx + 1]).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
} else if (callIdx !== -1) {
  runT3McpCall(process.argv[callIdx + 1], process.argv[callIdx + 2]).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
} else {
  main();
}
