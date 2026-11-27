// Reads a program email for events with Claude: the holiday party, a city-wide grand rounds, a
// review conference, an RSVP deadline. Runs in the background (netlify/functions/read-mail-background.mjs).
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "./auth.js";

const Event = z.object({
  title: z.string().describe("Short name residents would recognize, e.g. 'Holiday Party' or 'City-Wide Grand Rounds: Second Victim'"),
  date: z.string().describe("YYYY-MM-DD"),
  start: z.string().describe("Start as HH:MM, 24-hour, Eastern time; empty for all day or when no time is given"),
  end: z.string().describe("End as HH:MM, 24-hour; empty when not given"),
  place: z.string().describe("Where, as written (a room, a building with its street address, or 'Zoom'); empty if none"),
  link: z.string().describe("The link to join or register, copied exactly; empty if none"),
  rsvpBy: z.string().describe("RSVP or registration deadline as YYYY-MM-DD, or empty"),
  rsvpNeeded: z.boolean().describe("True when the email asks residents to RSVP, register or sign up for it, with or without a deadline"),
  rsvpLink: z.string().describe("The RSVP or registration link, copied exactly; empty if none"),
  kind: z.enum(["social", "lecture", "didactic", "conference", "deadline", "meeting", "other"]),
  note: z.string().describe("One short line residents need (dress code, 'cameras on', 'counts as CME'), or empty"),
  who: z.string().describe("Who it is for when not everyone: 'CA-1s', 'CA-3s', 'Residents going to the ASA', 'Faculty'; empty when it's for all residents"),
  cancelled: z.boolean().describe("True only when this email cancels the event"),
  movedFrom: z.string().describe("When this email moves the event from another day, that earlier date as YYYY-MM-DD; otherwise empty"),
});
const Events = z.object({ events: z.array(Event) });

const SYSTEM = `You read emails sent by an anesthesiology residency program office to all of its residents, and list the events in them that a resident would put on a calendar: parties and dinners, lectures and grand rounds, conferences, simulation sessions, meetings and town halls, and deadlines that fall on a specific date.

Rules:
- Only events with a specific date. A reminder with no date ("please finish the survey"), a newsletter, a link to read, or a request for documents is not an event: return no events for it.
- Not the monthly call schedule itself, and not something that already happened before the email was sent.
- The email's sent date is given. Weekday and date sometimes disagree, or the year is a typo (an invitation sent in November for "Saturday, January 9, 2026" when January 9, 2026 is a Friday and January 9, 2027 is a Saturday). Use the date that matches the weekday and comes after the email was sent.
- Dates YYYY-MM-DD; times HH:MM, 24-hour, Eastern. Copy links exactly, never invent one.
- An RSVP or registration deadline belongs on the event (rsvpBy), not as a separate event. Turn relative wording into a date from the sent date: "RSVP by Friday" is the next Friday after it was sent, "a week before" is seven days before the event. When the email asks for a reply but names no deadline, leave rsvpBy empty and set rsvpNeeded.
- Not one person's own business: a duty-hour or billing correction for named residents, a receipt, a form to return. Those are not events even with a due date.
- Not the regular weekly conferences (Monday 5pm, Wednesday 6am, Friday 6:10am): the app has those from the monthly conference schedule. A one-off change to one of them (moved, cancelled, a special speaker) is an event.
- When the email is to one class or group (the CA-1s, the residents going to a meeting), say who in "who".
- A cancellation gives the event with cancelled true; a change of date gives the new date with movedFrom set to the old one.
- Write titles plainly, without "You're invited", "SAVE THE DATE" or "MANDATORY" (put "Required" in the note instead).`;

export async function readMailEvents({ subject, from, date, text, client }) {
  if (!client) {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
    client = new Anthropic({ apiKey });
  }
  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(Events) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Sent: ${date}\nFrom: ${from}\nSubject: ${subject}\n\n${String(text).slice(0, 20000)}` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to read this email.");
  if (!message.parsed_output) throw new Error("The reading came back empty.");
  return message.parsed_output.events;
}
