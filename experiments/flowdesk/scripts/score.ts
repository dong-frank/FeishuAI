import { scoreFlowdeskExperiment } from "./reset.js";

scoreFlowdeskExperiment()
  .then((result) => {
    console.log(`Wrote FlowDesk score summary to ${result.outputPath}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
