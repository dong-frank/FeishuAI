import { execFile, spawn } from "node:child_process";

export type LarkCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LarkCliRunner = {
  run: (command: string, args: string[]) => Promise<LarkCliResult>;
};

export function getLarkCliInstallHint(): string {
  return [
    "未检测到 lark-cli。",
    "",
    "请先安装：",
    "npm install -g @larksuite/cli",
    "npx skills add larksuite/cli -y -g",
  ].join("\n");
}

export function statusLarkCli(runner?: LarkCliRunner): Promise<LarkCliResult> {
  return runLarkCli(["auth", "status"], runner);
}

export function setupLarkCli(runner?: LarkCliRunner): Promise<LarkCliResult> {
  return streamLarkCli(["config", "init", "--new"], runner);
}

export function loginLarkCli(runner?: LarkCliRunner): Promise<LarkCliResult> {
  return streamLarkCli(["auth", "login", "--recommend"], runner);
}

export function searchLarkDocs(
  query: string,
  runner?: LarkCliRunner,
): Promise<LarkCliResult> {
  return runLarkCli(
    ["docs", "+search", "--query", query, "--page-size", "10", "--format", "json"],
    runner,
  );
}

export async function runLarkCli(
  args: string[],
  runner: LarkCliRunner = { run: execLarkCli },
): Promise<LarkCliResult> {
  try {
    return await runner.run("lark-cli", args);
  } catch (error) {
    if (isCommandMissing(error)) {
      throw new Error(getLarkCliInstallHint());
    }

    throw error;
  }
}

export async function streamLarkCli(
  args: string[],
  runner: LarkCliRunner = { run: spawnLarkCli },
): Promise<LarkCliResult> {
  try {
    return await runner.run("lark-cli", args);
  } catch (error) {
    if (isCommandMissing(error)) {
      throw new Error(getLarkCliInstallHint());
    }

    throw error;
  }
}

function execLarkCli(command: string, args: string[]): Promise<LarkCliResult> {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function spawnLarkCli(command: string, args: string[]): Promise<LarkCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: "",
        stderr: "",
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
