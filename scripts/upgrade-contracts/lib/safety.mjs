// Manual-contract safety validator.
//
// The plan forbids unsafe manual contracts landing in the harness. Any manual
// step that mutates data, invokes a paid/provider/external API, changes auth,
// downloads, or writes project/workspace files must explicitly declare the
// staging/test prerequisites, expected mutations, cleanup/rollback, and
// evidence-capture procedures. Contracts that fail this validator are treated
// as authoring bugs — the harness must refuse to register them.
//
// This exists so a well-meaning contributor cannot silently ship a manual
// step that would drive a paid call against production, or that would leave a
// workspace file behind, without an operator-visible safety declaration.

const MUTATION_KEYWORDS =
  /(memory_store|memory_forget|memory_delete|memory_remove|\bstore\s+data|\bwrite\s+to|\bupload\s+(?:a|the|one|files?)|\bcreate\s+(?:a|the|one)\s+(?:record|row|canary|file)|\bdelete\s+(?:a|the|one|every|canary)|drop\s+table|truncate|migrate|resend\b|retry\b|commit\b|deploy\b|restart\b|reboot\b|kill\b|memory_store|hand-edit)/i;
const AUTH_KEYWORDS =
  /(\blogin\b|\blogout\b|oauth|reauth|refresh(?:\s+token)?|credential|\bprofile\b|burn|revoke)/i;
const PAID_KEYWORDS =
  /(send\s+a\s+turn|send\s+a\s+message|send\s+a\s+prompt|dispatch\s+a\s+turn|api\s+call\s+to|invoke\s+.*(anthropic|openai|codex|opus|sonnet|claude|chatgpt|gpt-)|account\s+balance)/i;
const DOWNLOAD_KEYWORDS = /(\bdownload\b|\bfetch\s+file)/i;
const WORKSPACE_WRITE_KEYWORDS =
  /(workspace\/|\.openclaw\/|conversations\.db|ui-transcripts|project\.md|project_files\.md)/i;
const NETWORK_MESSAGE_KEYWORDS =
  /(\bslack\b|\bdiscord\b|\btelegram\b|\bsignal\b|imessage|whatsapp|\bmatrix\b|\bzalo\b|voice call|webhook)/i;

const WRITE_HAZARDS = new Set(["mutatesData", "changesAuth", "writesWorkspaceFiles"]);

function inferHazards(manual) {
  const text = [manual.expected, ...(manual.steps ?? []), ...(manual.prerequisites ?? [])].join(
    "\n",
  );
  return {
    mutatesData: MUTATION_KEYWORDS.test(text),
    invokesPaidApi: PAID_KEYWORDS.test(text),
    changesAuth: AUTH_KEYWORDS.test(text),
    downloadsExternal: DOWNLOAD_KEYWORDS.test(text),
    writesWorkspaceFiles: WORKSPACE_WRITE_KEYWORDS.test(text),
    externalMessaging: NETWORK_MESSAGE_KEYWORDS.test(text),
  };
}

const HAZARD_FLAGS = [
  "mutatesData",
  "invokesPaidApi",
  "changesAuth",
  "downloadsExternal",
  "writesWorkspaceFiles",
  "externalMessaging",
];

function safetyIsCompleteFor(hazards, safety) {
  if (!safety || typeof safety !== "object") {
    return false;
  }
  const declared = safety;
  // Author must explicitly declare a value (true or false) for every flag the
  // text heuristic inferred as a potential hazard. We do not require the
  // author to agree with the heuristic — we require them to acknowledge it.
  for (const f of HAZARD_FLAGS) {
    if (hazards[f] && !Object.prototype.hasOwnProperty.call(declared, f)) {
      return false;
    }
  }
  const anyWriteHazardTrue = HAZARD_FLAGS.some((f) => WRITE_HAZARDS.has(f) && declared[f] === true);
  // stagingOnly must always be declared true for anything that might touch
  // shared state. Triple arrays must be present; expectedMutations must be
  // non-empty when any WRITE hazard (data/auth/workspace) is declared true.
  if (declared.stagingOnly !== true) {
    return false;
  }
  if (!Array.isArray(declared.expectedMutations)) {
    return false;
  }
  if (!Array.isArray(declared.cleanupRollback) || declared.cleanupRollback.length === 0) {
    return false;
  }
  if (!Array.isArray(declared.evidenceCapture) || declared.evidenceCapture.length === 0) {
    return false;
  }
  if (anyWriteHazardTrue && declared.expectedMutations.length === 0) {
    return false;
  }
  return true;
}

export function validateManualSafety(check) {
  if (check.automated !== "manual" || !check.manual) {
    return { ok: true, hazards: null };
  }
  const hazards = inferHazards(check.manual);
  const anyHazard = Object.values(hazards).some(Boolean);
  if (!anyHazard) {
    return { ok: true, hazards };
  }

  const safety = check.manual.safety;
  const complete = safetyIsCompleteFor(hazards, safety);
  const missing = [];

  // Hand-editing live credentials is disallowed regardless of other safety
  // declarations. Only fire when a step actually instructs the operator to do
  // it (imperative or non-negated), not when steps warn against it.
  const negated = /\b(never|not|no|avoid|do not|don't)\s+[^.]{0,40}hand.?edit/i;
  const handEditImperative = (check.manual.steps ?? []).some((step) => {
    if (negated.test(step)) {
      return false;
    }
    return /(^|\s)hand.?edit(ing|s)?\s+.*credentials?/i.test(step);
  });
  if (handEditImperative) {
    missing.push("manual step suggests hand-editing live credentials — refuse");
  }

  if (!complete) {
    if (!safety) {
      missing.push("manual.safety block is missing");
    } else {
      for (const [k, v] of Object.entries(hazards)) {
        if (v && !Object.prototype.hasOwnProperty.call(safety, k)) {
          missing.push(`manual.safety.${k} must be explicitly declared (true or false)`);
        }
      }
      if (safety.stagingOnly !== true) {
        missing.push("manual.safety.stagingOnly must be true");
      }
      if (!Array.isArray(safety.expectedMutations)) {
        missing.push("manual.safety.expectedMutations[] required");
      }
      if (!Array.isArray(safety.cleanupRollback) || safety.cleanupRollback.length === 0) {
        missing.push("manual.safety.cleanupRollback[] required");
      }
      if (!Array.isArray(safety.evidenceCapture) || safety.evidenceCapture.length === 0) {
        missing.push("manual.safety.evidenceCapture[] required");
      }
      const anyWriteHazardTrue = HAZARD_FLAGS.some(
        (f) => WRITE_HAZARDS.has(f) && safety[f] === true,
      );
      if (
        anyWriteHazardTrue &&
        (!Array.isArray(safety.expectedMutations) || safety.expectedMutations.length === 0)
      ) {
        missing.push(
          "manual.safety.expectedMutations[] must be non-empty when any WRITE hazard (mutatesData/changesAuth/writesWorkspaceFiles) is declared true",
        );
      }
    }
  }

  if (missing.length === 0) {
    return { ok: true, hazards };
  }
  return { ok: false, hazards, missing };
}

export function assertAllManualsSafe(checks) {
  const violations = [];
  for (const c of checks) {
    const v = validateManualSafety(c);
    if (!v.ok) {
      violations.push({ id: c.id, hazards: v.hazards, missing: v.missing });
    }
  }
  return violations;
}
