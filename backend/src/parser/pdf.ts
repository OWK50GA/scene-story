import { PDFParse } from "pdf-parse";
import { ParseResult, parseScreenplayTextOrThrow } from "./text";

export async function parseScreenplayPdf(buffer: Buffer): Promise<ParseResult> {
    const parser = new PDFParse({ data: buffer });
    const text = await parser.getText();
    return parseScreenplayTextOrThrow(text.text);
}