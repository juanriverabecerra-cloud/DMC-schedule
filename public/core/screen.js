// How to use a screen that keeps part of itself for the phone. A folding iPhone has a strip down
// one side of its outer screen, with the camera and clock at one end, and a clock in one corner
// of its inner screen, with the rest of that row empty. Left alone, both show up as a blank band.
//
// This works from the safe margins every browser reports and, inside the app, from the exact
// rectangles the phone says are taken (ScreenPlugin). It only decides; app.js applies the answer.

const STRIP_MIN = 56; // px: enough room for a column of tabs
const STRIP_OTHER_MAX = 24; // an ordinary phone turned sideways has the same margin on both sides
const NEAR = 2;
// The unfolded phone held upright: wider than any phone, narrower than the left rail's 840px, with
// the phone's clock band across the top (an iPad's status bar is under 40px).
const UNFOLDED = { minWidth: 600, maxWidth: 840, minTop: 40, minSide: 500 }; // other iPhones are under 450 across

// insets: { top, left, right } in px. regions: [{ kind, x, y, width, height }] in page coordinates.
// screenSize: the whole screen in px ({ width, height }, held upright); phone: an iPhone's browser.
export function screenLayout({ width, height, insets = {}, regions = [], screenSize = null, phone = false }) {
  const { top = 0, left = 0, right = 0 } = insets;
  const out = { strip: "", stripTop: 0, stripBottom: 0, corner: "", cornerWidth: 0, cornerHeight: 0, rail: "", cam: "", dock: "" };
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
    // In the Home Screen web app the phone doesn't say where its camera is. Upright it's at the top
    // of the strip, about as tall as the strip is wide, twice over (the folding iPhone's is 85 x 153).
    if (!taken.length && height > width) out.stripTop = Math.round(size * 1.8);
    // Where the frosted capsule behind the camera and clock goes, since the schedule scrolls under it.
    out.cam = out.stripTop ? "top" : out.stripBottom ? "bottom" : "";
    return out;
  }

  // The top margin is there for something in one corner: the header can sit in the rest of the row.
  const corner = taken.find((r) => top > 0 && r.y <= NEAR && Math.abs(r.height - top) <= NEAR
    && r.width <= width / 2 && (r.x <= NEAR || r.x + r.width >= width - NEAR));
  if (corner) Object.assign(out, { corner: corner.x <= NEAR ? "left" : "right", cornerWidth: corner.width, cornerHeight: corner.height });
  // The tabs leave the bottom for a column down the side under the clock, the way they sit in the
  // strip when the phone is turned, so the schedule gets the full height. In the Home Screen web
  // app the phone doesn't say where its clock is, only how tall the band across the top is; the
  // folding iPhone keeps it on the right.
  const unfolded = width >= UNFOLDED.minWidth && width < UNFOLDED.maxWidth && height > width;
  if (unfolded && (corner || (!taken.length && top >= UNFOLDED.minTop))) out.rail = out.corner || "right";
  // The Home Screen web app on the folding iPhone, which can't use the camera strip (iOS keeps it
  // outside the page). Unfolded, either way up, the page is at least 500 wide and tall, which no
  // other iPhone's is: the glass tabs float down the right. Folded, the page is narrower than the
  // screen: the side next to the strip has no room to spare, so they float along the bottom.
  if (!out.rail && phone && !taken.length) {
    const across = screenSize ? (width > height ? Math.max(screenSize.width, screenSize.height) : Math.min(screenSize.width, screenSize.height)) : width;
    if (Math.min(width, height) >= UNFOLDED.minSide) out.rail = "right";
    else if (across - width >= STRIP_MIN) out.dock = "bottom";
  }
  return out;
}
