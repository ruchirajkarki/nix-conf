#!/usr/bin/env node
// NoTokenLimit ACP adapter.
// Speaks Agent Client Protocol (JSON-RPC 2.0, one JSON message per line on stdio)
// and runs each prompt through `ntl -p`, which reuses the CLI's existing sign-in.
// stdout carries protocol messages only; diagnostics go to stderr.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";

const NTL = process.env.NTL_BIN || `${homedir()}/.local/bin/ntl`;
const STATE_DIR =
  process.env.NTL_ACP_STATE_DIR ||
  join(
    process.env.XDG_STATE_HOME || `${homedir()}/.local/state`,
    "ntl-acp",
    "sessions",
  );
const DEFAULT_MODEL = "claude-opus-5.5";
const claude = (family, version) => ["claude", family, version].join("-");
const MODELS = [
  "claude-opus-5.5",
  "claude-opus-5",
  "claude-opus-4.8",
  claude("sonnet", "5.5"),
  claude("sonnet", "5"),
  claude("haiku", "4.5"),
  "gemini-3.6-flash",
  "gemini-3.1-pro",
  "glm-5.1",
  "auto",
];
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
const TURN_TIMEOUT_MS = Number(process.env.NTL_ACP_TIMEOUT_MS) || 600_000;
const CANCEL_GRACE_MS = 3000;
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

const sessions = new Map();
const running = new Map();

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

function selectOption(id, name, category, currentValue, options) {
  return { id, name, category, type: "select", currentValue, options };
}

function configOptions(s) {
  return [
    selectOption(
      "model",
      "Model",
      "model",
      s.model,
      MODELS.map((m) => ({ value: m, name: m })),
    ),
    selectOption(
      "mode",
      "Permissions",
      "mode",
      s.mode,
      Object.entries(MODES).map(([value, m]) => ({ value, name: m.label })),
    ),
    selectOption("mcp", "MCP tools", "other", s.mcp ? "on" : "off", [
      { value: "off", name: "Off" },
      { value: "on", name: "On" },
    ]),
  ];
}

function newSession(id, cwd) {
  return {
    id,
    cwd,
    model: DEFAULT_MODEL,
    mode: DEFAULT_MODE,
    mcp: DEFAULT_MCP,
    history: [],
    busy: false,
    cancelled: false,
  };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new RpcError(-32602, `Unknown sessionId: ${sessionId}`);
  return session;
}

function sessionFile(id) {
  return join(STATE_DIR, `${id}.json`);
}

// Saves what survives a restart. A failed save is logged and does not fail the turn.
function persist(s) {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const file = sessionFile(s.id);
    const data = {
      id: s.id,
      cwd: s.cwd,
      model: s.model,
      mode: s.mode,
      mcp: s.mcp,
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

function promptText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => {
      if (b?.type === "text") return b.text ?? "";
      if (b?.type === "resource" && typeof b.resource?.text === "string") {
        return b.resource.text;
      }
      if (b?.type === "resource_link") return `[resource: ${b.uri}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

// `ntl -p` is one-shot, and --continue/--resume only work interactively,
// so the adapter replays prior turns in each prompt.
function buildInput(session, text) {
  if (session.history.length === 0) return text;
  const past = session.history
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n\n");
  return [
    "Continue this conversation. Earlier turns:",
    "",
    past,
    "",
    `User: ${text}`,
    "",
    "Reply only to the latest user message.",
  ].join("\n");
}

function toolKind(text) {
  if (/^(Ran|Running)\b/i.test(text)) return "execute";
  if (/^(Read|Viewed)\b/i.test(text)) return "read";
  if (/^Deleted\b/i.test(text)) return "delete";
  if (/^(Edited|Wrote|Created|Changed|Moved)\b/i.test(text)) return "edit";
  if (/^(Searched|Listed|Found)\b/i.test(text)) return "search";
  return "other";
}

// Turns one stderr line from ntl into an ACP update while the turn runs.
function reportProgress(session, raw) {
  const line = raw.trim();
  if (line === "") return;
  const m = line.match(TOOL_LINE);
  if (m) {
    const text = m[2].trim();
    update(session.id, {
      sessionUpdate: "tool_call",
      toolCallId: randomUUID(),
      title: text,
      kind: toolKind(text),
      status: m[1] === "\u2717" ? "failed" : "completed",
    });
    return;
  }
  update(session.id, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: line },
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

function runNtl(session, input) {
  return new Promise((resolve, reject) => {
    const preset = MODES[session.mode];
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

    const child = spawn(NTL, args, {
      cwd: WORKDIR,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    running.set(session.id, child);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", () => {}); // ntl may exit before reading its input

    let stdout = "";
    let stderr = "";
    let partial = "";
    const timer = setTimeout(() => killTree(child, "SIGTERM"), TURN_TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      partial += d;
      let nl = partial.indexOf("\n");
      while (nl !== -1) {
        reportProgress(session, partial.slice(0, nl));
        partial = partial.slice(nl + 1);
        nl = partial.indexOf("\n");
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
      running.delete(session.id);
      reportProgress(session, partial);
      if (session.cancelled) return resolve({ cancelled: true });
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
            `ntl returned no JSON (exit ${code}): ${stderr.trim().slice(0, 500)}`,
          ),
        );
      }
      if (parsed.is_error || code !== 0) {
        return reject(
          new RpcError(-32000, parsed.result || `ntl failed (exit ${code})`),
        );
      }
      resolve({
        cancelled: false,
        text: parsed.result ?? "",
        files: Array.isArray(parsed.files_changed) ? parsed.files_changed : [],
      });
    });

    child.stdin.end(
      `Project directory for this task: ${session.cwd}\n\n${input}`,
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

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: true,
          },
        },
        agentInfo: { name: "ntl-acp", version: "1.1.0" },
        authMethods: [],
      };

    case "authenticate":
      // Auth is the existing `ntl login`; nothing to do here.
      return {};

    case "session/new": {
      if (typeof params?.cwd !== "string" || !isAbsolute(params.cwd)) {
        throw new RpcError(-32602, "session/new requires an absolute cwd");
      }
      const s = newSession(randomUUID(), params.cwd);
      sessions.set(s.id, s);
      persist(s);
      return { sessionId: s.id, configOptions: configOptions(s) };
    }

    case "session/load": {
      const sessionId = params?.sessionId;
      if (sessions.has(sessionId)) {
        return { configOptions: configOptions(sessions.get(sessionId)) };
      }
      const saved = readPersisted(sessionId);
      if (!saved) throw new RpcError(-32002, `Unknown session: ${sessionId}`);
      const cwd =
        typeof params.cwd === "string" && isAbsolute(params.cwd)
          ? params.cwd
          : saved.cwd;
      const s = newSession(sessionId, cwd);
      if (MODELS.includes(saved.model)) s.model = saved.model;
      if (Object.hasOwn(MODES, saved.mode)) s.mode = saved.mode;
      if (typeof saved.mcp === "boolean") s.mcp = saved.mcp;
      if (Array.isArray(saved.history)) {
        s.history = saved.history.filter(
          (t) =>
            (t?.role === "user" || t?.role === "assistant") &&
            typeof t.text === "string",
        );
      }
      sessions.set(s.id, s);
      for (const turn of s.history) {
        update(s.id, {
          sessionUpdate:
            turn.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          content: { type: "text", text: turn.text },
        });
      }
      return { configOptions: configOptions(s) };
    }

    case "session/set_config_option": {
      const s = getSession(params?.sessionId);
      const value = params?.value;
      switch (params?.configId) {
        case "model":
          if (!MODELS.includes(value)) {
            throw new RpcError(-32602, `Unknown model: ${value}`);
          }
          s.model = value;
          break;
        case "mode":
          if (!Object.hasOwn(MODES, value)) {
            throw new RpcError(-32602, `Unknown mode: ${value}`);
          }
          s.mode = value;
          break;
        case "mcp":
          if (value !== "on" && value !== "off") {
            throw new RpcError(-32602, `Unknown MCP setting: ${value}`);
          }
          s.mcp = value === "on";
          break;
        default:
          throw new RpcError(
            -32602,
            `Unknown config option: ${params?.configId}`,
          );
      }
      persist(s);
      return { configOptions: configOptions(s) };
    }

    case "session/prompt": {
      const s = getSession(params?.sessionId);
      if (s.busy) {
        throw new RpcError(-32000, "A prompt is already running in this session");
      }
      const text = promptText(params.prompt);
      if (text.trim() === "") throw new RpcError(-32602, "Prompt is empty");

      s.busy = true;
      s.cancelled = false;
      try {
        const result = await runNtl(s, buildInput(s, text));
        if (result.cancelled) return { stopReason: "cancelled" };

        s.history.push(
          { role: "user", text },
          { role: "assistant", text: result.text },
        );
        persist(s);
        update(s.id, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: result.text },
        });
        for (const file of result.files) {
          const toolCallId = randomUUID();
          update(s.id, {
            sessionUpdate: "tool_call",
            toolCallId,
            title: `Edited ${file}`,
            kind: "edit",
            status: "in_progress",
          });
          update(s.id, {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: "completed",
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
        return { stopReason: "end_turn" };
      } finally {
        s.busy = false;
      }
    }

    case "session/close": {
      const sessionId = params?.sessionId;
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

    // Responses to requests we never send, and invalid messages, are ignored.
    if (typeof msg.method !== "string") return;

    if (msg.id === undefined) {
      if (msg.method === "session/cancel") cancel(msg.params?.sessionId);
      return;
    }

    handle(msg.method, msg.params ?? {})
      .then((result) => sendResult(msg.id, result))
      .catch((err) => {
        if (!(err instanceof RpcError)) log(`internal error: ${err.stack}`);
        sendError(
          msg.id,
          err instanceof RpcError ? err : new RpcError(-32603, err.message),
        );
      });
  });

  rl.on("close", () => {
    for (const sessionId of [...running.keys()]) cancel(sessionId);
    process.exit(0);
  });
}

if (process.argv.includes("--check")) {
  runCheck();
} else {
  main();
}
