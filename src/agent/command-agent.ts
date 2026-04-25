import type { CommandAgent } from "./types.js";

export function createCommandAgent(): CommandAgent {
  return {
    beforeRun() {
      console.log("beforeRun");
    },
    afterSuccess() {
      console.log("afterSuccess");
    },
    afterFail() {
      console.log("afterFail");
    },
  };
}
