#!/usr/bin/env node
// NoTokenLimit ACP adapter.
// Speaks Agent Client Protocol (JSON-RPC 2.0, one JSON message per line on stdio)
// and runs each prompt through `ntl -p`, which reuses the CLI's existing sign-in.
// stdout carries protocol messages only; diagnostics go to stderr.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const NTL = process.env.NTL_BIN || `${homedir()}/.local/bin/ntl`;
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
// File writes default on (coding agent). Shell commands default off.
const ALLOW_WRITES = process.env.NTL_ACP_ALLOW_WRITES !== "0";
const ALLOW_SHELL = process.env.NTL_ACP_ALLOW_SHELL === "1";
const TURN_TIMEOUT_MS = Number(process.env.NTL_ACP_TIMEOUT_MS) || 600_000;

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

function sendResult(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function sendError(id, err) {
  const error = { code: err.code ?? -32603, message: err.message };
  if (err.data !== undefined) error.data = err.data;
  write({ jsonrpc: "2.0", id, error });
}

function modelOption(current) {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: current,
    options: MODELS.map((m) => ({ value: m, name: m })),
  };
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new RpcError(-32602, `Unknown sessionId: ${sessionId}`);
  return session;
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

function runNtl(session, input, model) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "-m", model];
    if (ALLOW_WRITES) args.push("--allow-writes");
    if (ALLOW_SHELL) args.push("--allow-shell");

    const child = spawn(NTL, args, {
      cwd: session.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    running.set(session.id, child);

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), TURN_TIMEOUT_MS);

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
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

    child.stdin.end(input);
  });
}

function cancel(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.cancelled = true;
  running.get(sessionId)?.kill("SIGTERM");
}

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params?.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {
            image: false,
            audio: false,
            embeddedContext: true,
          },
        },
        agentInfo: { name: "ntl-acp", version: "1.0.0" },
        authMethods: [],
      };

    case "authenticate":
      // Auth is the existing `ntl login`; nothing to do here.
      return {};

    case "session/new": {
      if (typeof params?.cwd !== "string" || params.cwd === "") {
        throw new RpcError(-32602, "session/new requires an absolute cwd");
      }
      const id = randomUUID();
      sessions.set(id, {
        id,
        cwd: params.cwd,
        model: DEFAULT_MODEL,
        history: [],
        busy: false,
        cancelled: false,
      });
      return { sessionId: id, configOptions: [modelOption(DEFAULT_MODEL)] };
    }

    case "session/set_config_option": {
      const session = getSession(params?.sessionId);
      if (params.configId !== "model") {
        throw new RpcError(-32602, `Unknown config option: ${params.configId}`);
      }
      if (!MODELS.includes(params.value)) {
        throw new RpcError(-32602, `Unknown model: ${params.value}`);
      }
      session.model = params.value;
      return { configOptions: [modelOption(session.model)] };
    }

    case "session/prompt": {
      const session = getSession(params?.sessionId);
      if (session.busy) {
        throw new RpcError(-32000, "A prompt is already running in this session");
      }
      const text = promptText(params.prompt);
      if (text.trim() === "") throw new RpcError(-32602, "Prompt is empty");

      session.busy = true;
      session.cancelled = false;
      try {
        const result = await runNtl(session, buildInput(session, text), session.model);
        if (result.cancelled) return { stopReason: "cancelled" };

        session.history.push(
          { role: "user", text },
          { role: "assistant", text: result.text },
        );
        notify("session/update", {
          sessionId: session.id,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: result.text },
          },
        });
        if (result.files.length > 0) {
          notify("session/update", {
            sessionId: session.id,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `Files changed: ${result.files.join(", ")}`,
              },
            },
          });
        }
        return { stopReason: "end_turn" };
      } finally {
        session.busy = false;
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
    for (const sessionId of running.keys()) cancel(sessionId);
    process.exit(0);
  });
}

if (process.argv.includes("--check")) {
  runCheck();
} else {
  main();
}
