export function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    if ("code" in err && typeof (err as { code?: unknown }).code === "string") {
      return (err as { code: string }).code;
    }
  }
  return undefined;
}

export function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}
