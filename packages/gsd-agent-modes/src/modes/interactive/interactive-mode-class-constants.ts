/** Shared constants and helpers extracted from InteractiveMode (Phase E2). */

export const MAX_CHAT_COMPONENTS = 100;
export const MAX_WIDGET_LINES = 10;
export const DEFAULT_TOOL_OUTPUT_EXPANDED = true;

export const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export function matchesImageSignature(buf: Buffer, mimeType: string): boolean {
	if (buf.length < 12) return false;
	switch (mimeType) {
		case "image/png":
			return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
		case "image/jpeg":
			return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
		case "image/gif":
			return (
				buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
				(buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
			);
		case "image/webp":
			return (
				buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
				buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
			);
		default:
			return false;
	}
}
