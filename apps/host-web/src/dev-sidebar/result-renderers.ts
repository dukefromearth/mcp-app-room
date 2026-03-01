import type { NormalizedResult, ResultRenderer } from "./contracts";

interface JsonRenderModel {
  kind: NormalizedResult["kind"];
  summary: string;
  json: string;
}

const jsonRenderer: ResultRenderer = {
  id: "json-renderer",
  supports() {
    return true;
  },
  renderModel(result): JsonRenderModel {
    return {
      kind: result.kind,
      summary: result.summary,
      json: JSON.stringify(result.payload, null, 2),
    };
  },
};

export const DEFAULT_RESULT_RENDERERS: ResultRenderer[] = [jsonRenderer];

