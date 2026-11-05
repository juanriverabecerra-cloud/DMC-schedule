// Reads the department's monthly conference schedule (PDF) into structured JSON with Claude.
// The result is always shown to an admin for review before it is saved.
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "./auth.js";

const Person = z.object({
  name: z.string().describe("Resident: surname as the reference list spells it. Faculty: as printed, e.g. 'Dr. Smith' or 'Jordan Smith, MD'"),
  role: z.enum(["presenter", "examinee", "moderator", "faculty", "examiner"]),
  topic: z.string().describe("The resident's own topic when the session lists one per resident, else empty"),
  start: z.string().describe("This person's own time slot start as HH:MM (24-hour), e.g. a mock oral slot; else empty"),
  end: z.string().describe("This person's own time slot end as HH:MM (24-hour); else empty"),
});

const Event = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  start: z.string().describe("Session start as HH:MM, 24-hour"),
  end: z.string().describe("Session end as HH:MM, 24-hour, or empty"),
  series: z.enum(["wednesday", "monday", "friday", "other"]).describe("wednesday = Wednesday CME conference, monday = Monday review, friday = Friday mock orals"),
  kind: z.enum(["pbld", "lecture", "grand-rounds", "mm", "board-review", "mock-oral", "journal-club", "simulation", "other", "none"]),
  title: z.string().describe("Lecture title without quotation marks, or the session name"),
  people: z.array(Person),
  location: z.string().describe("Room if the session names one, e.g. 'Resident Conference Room'; empty when it uses the default room"),
  virtual: z.boolean().describe("True for virtual-only sessions"),
  zoom: z.string().describe("key of the zoom entry that applies, or empty"),
  cancelled: z.boolean().describe("True for 'No Lecture' and similar"),
  cme: z.boolean().describe("True if the session carries CME credit"),
  audience: z.string(),
  objectives: z.string().describe("Learning objectives, condensed to one paragraph"),
  note: z.string(),
});

export const DidacticsSchema = z.object({
  month: z.string().describe("YYYY-MM of the schedule"),
  events: z.array(Event),
  zoom: z.array(z.object({
    key: z.string().describe("Short key: 'wednesday', 'monday' or 'friday' when the link belongs to those sessions"),
    label: z.string().describe("e.g. 'Wednesday conference Zoom'"),
    url: z.string(),
    phones: z.array(z.string()).describe("Dial-in numbers"),
    meetingId: z.string(),
    passcode: z.string().describe("Passcode or code"),
  })),
  location: z.string().describe("Default room for in-person sessions, e.g. 'Main Auditorium'"),
  notes: z.array(z.string()).describe("Short general notes worth keeping (not the CME accreditation boilerplate)"),
  uncertain: z.array(z.string()).describe("Short notes about anything you could not read or place confidently"),
});

const SYSTEM = `You turn the Detroit Medical Center Department of Anesthesiology monthly conference schedule (a PDF) into JSON for the residents' schedule app.

The schedule usually has:
- Wednesday CME conference, 6:00-6:30 AM a Problem Based Learning Discussion (PBLD) led by a faculty member, then 6:30-7:30 AM a lecture, Grand Rounds or Mortality & Morbidity conference with a presenter (and sometimes a moderator), audience and objectives. "No Lecture" means that Wednesday is cancelled.
- Monday evening review sessions (often 5:00-6:00 PM, virtual): faculty-led board review, or several residents each presenting a topic with a faculty moderator.
- Friday morning mock oral board examinations: a faculty examiner and residents with their own time slots (e.g. "6:00am-6:30am: J. DOE").
- Zoom details for each series (link, dial-in numbers, meeting ID, passcode) and the default room ("Unless otherwise noted ... take place in <room>").

Rules:
- One event per session block. A Wednesday with a PBLD and a lecture is two events. A Friday mock oral session is one event whose residents each carry their own start and end; the event's own start/end are the times printed in its header.
- Roles: residents who present are "presenter", residents taking a mock oral are "examinee"; faculty are "faculty" (PBLD leader, board review lead), "moderator" or "examiner". A faculty member who gives a lecture is a "presenter" written as printed with the title, e.g. "Jordan Smith, MD".
- Resident names always follow the reference list: when a printed name or initial-and-surname ("J. DOE", "A.B. LEE", "Jane Doe, DO") refers to a listed resident, write that resident's surname exactly as the list spells it. Faculty names are copied as printed.
- Times are 24-hour HH:MM. Dates are YYYY-MM-DD in the schedule's month and year.
- Link each event to the Zoom entry for its series with the zoom key. Copy URLs, meeting IDs and passcodes exactly.
- Never invent a name, time or link. If something is ambiguous, give your best reading and add a short note to "uncertain".`;

// residents: [{ last, name, cls }] from the roster; faculty: attending names from the directory.
export async function readDidacticsPdf({ bytes, today, residents = [], faculty = [], client }) {
  if (!client) {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
    client = new Anthropic({ apiKey });
  }
  const data = Buffer.from(bytes).toString("base64");
  const lists = [
    `Today is ${today}.`,
    `Reference list of residents (surname to write: full name, class):\n${residents.map((r) => `${r.last}: ${r.name}, ${r.cls || "?"}`).join("\n")}`,
    faculty.length ? `Faculty in the department directory (for spelling only):\n${faculty.join("; ")}` : "",
    "Read the conference schedule.",
  ].filter(Boolean).join("\n\n");

  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: zodOutputFormat(DidacticsSchema) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
        { type: "text", text: lists },
      ],
    }],
  });
  // The SDK validates the JSON against DidacticsSchema and exposes it as parsed_output.
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to read this PDF.");
  if (message.stop_reason === "max_tokens") throw new Error("The reading was cut off before it finished.");
  if (!message.parsed_output) throw new Error("The reading came back empty.");
  return { didactics: message.parsed_output, model: message.model, usage: message.usage };
}
