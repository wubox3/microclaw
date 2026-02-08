import { truncateText } from "../text-utils.js";

const MAX_SUMMARY_CHARS = 2000;

export function pickSummaryFromOutput(text: string | undefined) {
  const clean = (text ?? "").trim();
  if (!clean) {
    return undefined;
  }
  const limit = MAX_SUMMARY_CHARS;
  return clean.length > limit ? truncateText(clean, limit) : clean;
}

export function pickSummaryFromPayloads(payloads: Array<{ text?: string | undefined }>) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const summary = pickSummaryFromOutput(payloads[i]?.text);
    if (summary) {
      return summary;
    }
  }
  return undefined;
}

export function pickLastNonEmptyTextFromPayloads(payloads: Array<{ text?: string | undefined }>) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const clean = (payloads[i]?.text ?? "").trim();
    if (clean) {
      return clean;
    }
  }
  return undefined;
}
