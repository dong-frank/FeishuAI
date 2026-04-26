import { spawn } from "node:child_process";
import type { Writable } from "node:stream";

type ExecuteCommandOptions = {
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
    cwd: process.cwd(),
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
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}
