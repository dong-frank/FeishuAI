import { execFile } from "node:child_process";

export type TldrResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type TldrRunner = {
  run: (command: string, args: string[]) => Promise<TldrResult>;
};

export async function readTldrPage(
  command: string,
  runner: TldrRunner = { run: execTldr },
): Promise<string> {
  const pageName = normalizeTldrPageName(command);
  const result = await runner.run("tldr", [pageName]);

  if (result.exitCode === 0) {
    return result.stdout.trim();
  }

  return [
    `未找到 tldr 页面：${pageName}`,
    result.stderr.trim() || result.stdout.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeTldrPageName(command: string): string {
  return command.trim().replace(/\s+/g, "-");
}

function execTldr(command: string, args: string[]): Promise<TldrResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (isCommandMissing(error)) {
        reject(new Error("未检测到 tldr。请先安装 tldr，例如：npm install -g tldr"));
        return;
      }

      resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function isCommandMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
