export type LarkCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type LarkCliOutputChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type LarkCliExecutionOptions = {
  onOutput?: (chunk: LarkCliOutputChunk) => void;
};

export type LarkCliRunner = {
  run: (
    command: string,
    args: string[],
    options?: LarkCliExecutionOptions,
  ) => Promise<LarkCliResult>;
};

export type LarkCliRunOptions = {
  runner?: LarkCliRunner;
  onOutput?: (chunk: LarkCliOutputChunk) => void;
};
