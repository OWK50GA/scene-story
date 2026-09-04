import { parseScreenplayPdf } from "./pdf";
import { ParseError, ParseResult, parseScreenplayTextOrThrow } from "./text";

export type { ParsedScene, ParseResult } from "./text";
export { ParseError } from "./text";

export async function parseScreenplay(
  buffer: Buffer,
  options: { mimeType?: string; filename?: string },
): Promise<ParseResult> {
  const mime = options.mimeType?.toLowerCase() ?? "";
  const ext = options.filename?.toLowerCase().split(".").pop();

  if (mime === "application/pdf" || ext === "pdf") {
    return parseScreenplayPdf(buffer);
  }

  if (mime === "text/plain" || ext === "txt" || ext === "fountain") {
    return parseScreenplayTextOrThrow(buffer.toString("utf-8"));
  }

  throw new ParseError(
    `Unsupported file type: ${options.mimeType ?? options.filename ?? "unknown"}. ` +
      `Accepted formats: PDF (.pdf), plain text (.txt), Fountain (.fountain).`,
  );
}
