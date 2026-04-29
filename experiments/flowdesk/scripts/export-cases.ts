import { exportFlowdeskCases } from "./reset.js";

exportFlowdeskCases()
  .then((result) => {
    console.log(`Exported ${result.caseCount} FlowDesk cases to ${result.outputPath}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
