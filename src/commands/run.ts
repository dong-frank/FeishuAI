import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

import type { CommandAgent, CommandContext } from "../agent/types.js";

type ExecuteCommandOptions = {
  agent?: CommandAgent;
  stdout?: Writable;
  stderr?: Writable;
};

export async function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions = {},
): Promise<number> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
  });

  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    stdout.write(chunk);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
    stderr.write(chunk);
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", async (code) => {
      const exitCode = code ?? 1;
      const result = {
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
      };

      resolve(exitCode);
    });
  });
}
