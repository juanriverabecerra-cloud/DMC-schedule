// Reads a photo of the daily OR assignment sheet into structured JSON with Claude.
// The result is always shown to an admin for review before it is saved.
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "./auth.js";

const Room = z.object({
  or: z.string().describe("OR number as printed"),
  surgeon: z.string(),
  time: z.string().describe("Start time as printed, e.g. 8:30"),
  cases: z.string().describe("# of cases"),
  mda: z.string().describe("Attending anesthesiologist (MDA column)"),
  staff: z.string().describe("Resident/CRNA column exactly as printed, e.g. 'Smith', 'Smith/Jones' or 'X'"),
  ja: z.string().describe("JA column (junior attending), names or initials as printed"),
  breaks: z.string().describe("Breaks column"),
  extra: z.string().describe("Any other text on the row (last unlabeled column)"),
});

export const DailySchema = z.object({
  date: z.string().describe("Date printed on the sheet (top-left) as YYYY-MM-DD, or empty if unreadable"),
  rooms: z.array(Room).describe("Only OR rows that have any content"),
  opsc: z.object({
    rooms: z.string().describe("Number in parentheses after OPSC"),
    mdas: z.array(z.string()),
    residents: z.array(z.string()),
  }),
  procedures: z.array(z.object({ name: z.string(), count: z.string(), mda: z.string() }))
    .describe("Procedure areas such as Cath lab, EP lab, TEE, Angio, CT, MRI, Bedside ICU, with the count in parentheses and the MDA listed beside that block"),
  meyers: z.object({ rooms: z.string(), mda: z.string() }),
  pat: z.array(z.string()),
  ob: z.object({ mda: z.string(), residents: z.array(z.string()) }),
  night: z.array(z.string()).describe("Night coverage names"),
  notes: z.array(z.string()).describe("Free-text lines, e.g. 'SDS RESIDENTS OR 7 & 8'"),
  other: z.array(z.object({ label: z.string(), value: z.string() })).describe("Anything else on the sheet"),
  uncertain: z.array(z.string()).describe("Short notes about cells you could not read confidently"),
});

const SYSTEM = `You transcribe a phone photo of the printed daily anesthesia assignment sheet used at Harper University Hospital (Detroit Medical Center) into JSON.

Layout of the sheet:
- A dated table with columns OR, Surgeon, Time, # of cases, MDA (attending anesthesiologist), Resident/CRNA, JA (junior attending, a senior resident, sometimes written as initials such as "ABC"), Breaks (the resident giving breaks), and sometimes an unlabeled last column.
- In Resident/CRNA, "X" means a CRNA covers the room; keep "X". "Name1/Name2" means two residents share the room; keep the slash.
- Below the table: OPSC with its room count in parentheses, its MDAs and residents; procedure areas with counts in parentheses (Cath lab, EP lab, TEE, Angio, CT, MRI, Bedside ICU) and the MDA beside each block; Meyers Lab with its room count and MDA; PAT; OB with its MDA and residents; Night coverage; and free-text notes.

Resident names always follow the reference list. When a printed name, misspelling or set of initials refers to a resident on the list, write that resident's surname exactly as the list spells it. If two listed surnames look alike (for example "Lee" and "Leed"), choose the one the printed spelling matches. Names that aren't on the list (MDAs, surgeons, CRNAs, residents from other programs) are copied as printed.

If a name cell holds a role instead of a person, such as "PAT" in the Breaks column, keep the role word exactly as printed; the app fills in who that is.

The sheet is normally posted the day before it applies, so its printed date is usually tomorrow. Report that date as printed; a date that differs from today is expected, not a problem, so don't mention it in "uncertain".

Leave a field as an empty string when the cell is blank, and never invent a name. When a cell is hard to read, give your best reading and add a short note to "uncertain", for example "OR 14 surgeon: Smith?". Anything that does not fit the fields goes into "other".`;

// residents: [{ last, name, cls }] from the roster, used as the reference list for names.
export async function readDailyPhoto({ bytes, mediaType, today, residents = [], client }) {
  if (!client) {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
    client = new Anthropic({ apiKey });
  }
  const data = Buffer.from(bytes).toString("base64");

  const stream = client.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: zodOutputFormat(DailySchema) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        {
          type: "text",
          text: `Today is ${today}.\n\nReference list of residents (surname to write: full name, class):\n${residents.map((r) => `${r.last}: ${r.name}, ${r.cls || "?"}`).join("\n")}\n\nTranscribe the sheet.`,
        },
      ],
    }],
  });
  // The SDK validates the JSON against DailySchema and exposes it as parsed_output.
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined to read this image.");
  if (message.stop_reason === "max_tokens") throw new Error("The reading was cut off before it finished.");
  if (!message.parsed_output) throw new Error("The reading came back empty.");
  return { daily: message.parsed_output, model: message.model, usage: message.usage };
}
