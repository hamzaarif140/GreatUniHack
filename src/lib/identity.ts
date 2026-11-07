const PALETTE = ["#ec407a", "#7e57c2", "#26a69a", "#5c6bc0", "#ef6c00", "#0288d1", "#c2185b", "#558b2f"];

/** A stable avatar colour for a display name. */
export function colorForName(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function randomLetters(length: number) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return result;
}

/** A meeting code like "aog-esnb-dfj". */
export function generateMeetingCode() {
  return `${randomLetters(3)}-${randomLetters(4)}-${randomLetters(3)}`;
}

/** Pulls a meeting code out of whatever was pasted: a code or a full link. */
export function parseMeetingCode(input: string) {
  const last = input.trim().split("/").filter(Boolean).pop() ?? "";
  const code = last.split(/[?#]/)[0].toLowerCase();
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(code) ? code : null;
}
