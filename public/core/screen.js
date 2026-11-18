// How to use a screen that keeps part of itself for the phone. A folding iPhone has a strip down
// one side of its outer screen, with the camera and clock at one end, and a clock in one corner
// of its inner screen, with the rest of that row empty. Left alone, both show up as a blank band.
//
// This works from the safe margins every browser reports and, inside the app, from the exact
// rectangles the phone says are taken (ScreenPlugin). It only decides; app.js applies the answer.

const STRIP_MIN = 56; // px: enough room for a column of tabs
const STRIP_OTHER_MAX = 24; // an ordinary phone turned sideways has the same margin on both sides
const NEAR = 2;

// insets: { top, left, right } in px. regions: [{ kind, x, y, width, height }] in page coordinates.
export function screenLayout({ width, height, insets = {}, regions = [] }) {
  const { top = 0, left = 0, right = 0 } = insets;
  const out = { strip: "", stripTop: 0, stripBottom: 0, corner: "", cornerWidth: 0, cornerHeight: 0 };
  const taken = regions.filter((r) => r && r.kind === "occlusion" && r.width > 0 && r.height > 0);

  // A strip down one side: the tabs go in it, clear of whatever the phone has at either end.
  out.strip = right >= STRIP_MIN && left <= STRIP_OTHER_MAX ? "right" : left >= STRIP_MIN && right <= STRIP_OTHER_MAX ? "left" : "";
  if (out.strip) {
    const size = out.strip === "right" ? right : left;
    for (const r of taken) {
      const inStrip = out.strip === "right" ? r.x >= width - size - NEAR : r.x + r.width <= size + NEAR;
      if (!inStrip) continue;
      if (r.y + r.height / 2 < height / 2) out.stripTop = Math.max(out.stripTop, r.y + r.height);
      else out.stripBottom = Math.max(out.stripBottom, height - r.y);
    }
    return out;
  }

  // The top margin is there for something in one corner: the header can sit in the rest of the row.
  const corner = taken.find((r) => top > 0 && r.y <= NEAR && Math.abs(r.height - top) <= NEAR
    && r.width <= width / 2 && (r.x <= NEAR || r.x + r.width >= width - NEAR));
  if (corner) Object.assign(out, { corner: corner.x <= NEAR ? "left" : "right", cornerWidth: corner.width, cornerHeight: corner.height });
  return out;
}
