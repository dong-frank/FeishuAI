import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

type ExecuteCommandOptions = {
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
};

export function getSpawnCommand(command: string, args: string[]) {
  if (command === "git") {
    return {
      command,
      args: ["-c", "color.ui=always", ...args],
    };
  }

  return {
    command,
    args,
  };
}

export async function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions = {},
): Promise<number> {
  const spawnCommand = getSpawnCommand(command, args);
  const child = spawn(spawnCommand.command, spawnCommand.args, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    shell: false,
  });

  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  child.stdout.on("data", (chunk: Buffer) => {
    stdout.write(chunk);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr.write(chunk);
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        stderr.write(`command not found: ${command}\n`);
        resolve(127);
        return;
      }

      reject(error);
    });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}
