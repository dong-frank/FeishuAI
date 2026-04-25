import assert from "node:assert/strict";
import test from "node:test";

import { extractLarkDocCandidates, formatDocSelectionPrompt } from "../../src/commands/init.js";

test("extractLarkDocCandidates reads common lark search result shape", () => {
  const candidates = extractLarkDocCandidates(
    JSON.stringify({
      ok: true,
      data: {
        items: [
          {
            title: "Git 规范",
            url: "https://example.feishu.cn/docx/abc",
            token: "abc",
            doc_type: "DOCX",
          },
        ],
      },
    }),
  );

  assert.deepEqual(candidates, [
    {
      title: "Git 规范",
      url: "https://example.feishu.cn/docx/abc",
      token: "abc",
      type: "DOCX",
    },
  ]);
});

test("formatDocSelectionPrompt renders numbered candidates", () => {
  const prompt = formatDocSelectionPrompt([
    {
      title: "Git 规范",
      url: "https://example.feishu.cn/docx/abc",
      token: "abc",
      type: "DOCX",
    },
  ]);

  assert.match(prompt, /1\. Git 规范/);
  assert.match(prompt, /请选择/);
});
