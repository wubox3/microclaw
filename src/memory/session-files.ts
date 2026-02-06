export type SessionFileEntry = {
  sessionKey: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

export function formatSessionContent(entries: SessionFileEntry[]): string {
  return entries
    .map((e) => `[${e.role}] ${e.content}`)
    .join("\n\n");
}
