// The Google Apps Script that brings the program office's emails in. It runs in the owner's own
// Gmail every 30 minutes and only ever sends emails from the office that went to 10+ people.
// Who counts as the office comes from the server as salted hashes (lib/mail-intake.js), so no
// one's address is written in this public code. Apps Script's Run menu starts on the first
// function in the file, so setup comes first, and the helper ends in "_", which hides it there.
export function mailScript(address, { hashes = [], domains = [], salt = "" } = {}) {
  return `// DMC Schedule: brings the program office's emails into the app (Admin › Email intake).
// Runs in your own Gmail every 30 minutes. Only emails from the office that went to 10 or more
// people are sent, to the app's private address below; personal emails never leave Gmail.
const APP = ${JSON.stringify(address)};
const DOMAINS = ${JSON.stringify(domains)};
const SENDERS = ${JSON.stringify(hashes)}; // the office's addresses, hashed
const SALT = ${JSON.stringify(salt)};
const MIN_RECIPIENTS = 10;
const KEEP = /\\.(xlsx|xlsm|pdf|ics)$/i;
const MAX_FILE = 4 * 1024 * 1024, MAX_TOTAL = 4.2 * 1024 * 1024;

// Run this once (pick "setup" in the menu next to Debug, then Run): it checks now, then every
// 30 minutes by itself.
function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sendProgramEmails").timeBased().everyMinutes(30).create();
  sendProgramEmails();
}

function sendProgramEmails() {
  const props = PropertiesService.getUserProperties();
  const seen = JSON.parse(props.getProperty("seen") || "[]");
  const query = "from:(" + DOMAINS.join(" OR ") + ") newer_than:" + (props.getProperty("ran") ? "3d" : "45d");
  const messages = [];
  GmailApp.search(query, 0, 200).forEach((t) => t.getMessages().forEach((m) => {
    const from = (m.getFrom().match(/[\\w.+-]+@[\\w.-]+\\.\\w+/) || [""])[0].toLowerCase();
    if (seen.indexOf(m.getId()) < 0 && SENDERS.indexOf(hashOf_(SALT + from)) >= 0) messages.push(m);
  }));
  messages.sort((a, b) => a.getDate() - b.getDate()); // oldest first, so a newer copy wins
  try {
    for (const m of messages) {
      const people = ((m.getTo() || "") + "," + (m.getCc() || "")).toLowerCase().match(/[\\w.+-]+@[\\w.-]+\\.\\w+/g) || [];
      const recipients = new Set(people).size;
      if (recipients >= MIN_RECIPIENTS) {
        let total = 0;
        const attachments = [];
        m.getAttachments({ includeInlineImages: false }).forEach((a) => {
          const name = a.getName(), type = a.getContentType(), size = a.getSize();
          if (!(KEEP.test(name) || /calendar/i.test(type)) || size > MAX_FILE || total + size > MAX_TOTAL) return;
          total += size;
          attachments.push({ name: name, type: type, data: Utilities.base64Encode(a.getBytes()) });
        });
        const res = UrlFetchApp.fetch(APP, {
          method: "post", contentType: "application/json", muteHttpExceptions: true,
          payload: JSON.stringify({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), date: m.getDate().toISOString(),
            recipients: recipients, text: (m.getPlainBody() || "").slice(0, 20000), attachments: attachments }),
        });
        const code = res.getResponseCode();
        if (code === 404) throw new Error("The app's address changed: copy the script again from Admin › Email intake.");
        if (code >= 500 || code === 429) break; // the app is busy: this one is tried again next time
      }
      seen.push(m.getId());
    }
  } finally {
    props.setProperty("seen", JSON.stringify(seen.slice(-400)));
    props.setProperty("ran", "1");
  }
}

function hashOf_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ""), Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
`;
}
