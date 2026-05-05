import { spawn } from "node:child_process";

import type {
  LarkCliExecutionOptions,
  LarkCliResult,
  LarkCliRunOptions,
} from "./types.js";

function getLarkCliInstallHint(): string {
  return [
    "未检测到 lark-cli。",
    "",
    "请先安装：",
    "npm install -g @larksuite/cli",
    "npx skills add larksuite/cli -y -g",
  ].join("\n");
}

export async function runLarkCli(
  args: string[],
  options: LarkCliRunOptions = {},
): Promise<LarkCliResult> {
  const runner = options.runner ?? { run: execLarkCli };
  const executionOptions: LarkCliExecutionOptions = {
    ...(options.onOutput ? { onOutput: options.onOutput } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  try {
    return await runner.run("lark-cli", args, executionOptions);
  } catch (error) {
    if (isCommandMissing(error)) {
      throw new Error(getLarkCliInstallHint());
    }

    throw error;
  }
}

function execLarkCli(
  command: string,
  args: string[],
  options: LarkCliExecutionOptions = {},
): Promise<LarkCliResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener("abort", abortChild);
      callback();
    };

    const abortChild = () => {
      child.kill();
      settle(() => reject(createAbortError()));
    };

    options.signal?.addEventListener("abort", abortChild, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onOutput?.({ stream: "stdout", text });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onOutput?.({ stream: "stderr", text });
    });

    child.on("error", (error) => {
      settle(() => reject(error));
    });

    child.on("close", (code) => {
      settle(() =>
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
        }),
      );
    });
  });
}

function createAbortError() {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

function isCommandMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
