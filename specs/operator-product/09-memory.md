# 09 Memory — "What your assistant knows"

**Purpose:** give the operator control over what the assistant knows about them and their business.
The trust surface for memory.

**When used:** occasional. Opened to correct or review what the assistant has learned.

## Reframe

The developer view of the memory system (salience scores, consolidation timelines, decay
visualizations) is a toy for this audience. The operator wants **control**: see what it knows, correct
what is wrong, delete what should not be there. The consolidation/decay engine keeps running
underneath; the operator sees a clean, editable knowledge base. This turns a backend feature into a
trust surface. The decay visualization, if kept at all, goes to the hidden Labs area, not a primary
screen.

## Layout

- Header "What I know about you", with a prominent local-storage assurance: "Stored on this machine.
  Edit or delete anything." Plus an Add action.
- Facts grouped by category:
  - **Your business** ("You run a 6-person product studio focused on B2B SaaS"; "Invoices go out
    net-30, chased at 7 days overdue")
  - **Your clients** ("Acme is your largest client, renewal due in July")
  - **How you like to work** ("Short, direct emails. No filler"; "Prefer to approve anything
    client-facing before it sends")
- Each fact is a row with: the fact text, a **provenance tag**, and inline Edit / Delete.

## Provenance is the hero (D11)

Every fact shows where it came from: **You told me** / **Learned from your work** / **Learned from
email**. The moment you tell someone the assistant remembers things about their business, their next
thought is "where does that live and who can see it." The local-storage line and per-fact provenance
answer that before they ask. Editability (correct or delete any fact inline) is what makes the
knowledge base trustworthy rather than a black box.

## Connection to the trust chain

Memory feeds [Permissions](07-permissions-settings.md). Preference-level facts ("prefer to approve
client-facing work before sending") inform permission defaults and the assistant's behavior. Memory,
permissions, and activity are one connected trust system, not three separate features.

## Data / engine

- Reads the existing `memories` table (raw_text/summary, entities, topics, importance, salience,
  source, timestamps). `source` provides provenance ("checkpoint", "you told me", inferred-from-work).
- Edit updates the fact; Delete removes it (and should prevent re-derivation, not just hide).
- Add inserts a high-salience operator-authored fact.
- Consolidation/decay continues to run; the UI surfaces current state, not the mechanics.

## States

- Grouped, editable list. Empty category is hidden rather than shown empty.
- Recently learned facts may carry a subtle "new" marker so the operator can review what was inferred.

## Open decisions

- **D11:** exact provenance taxonomy and whether inferred facts require operator confirmation before
  they influence behavior.

## Cross-references

- Feeds defaults in [Permissions](07-permissions-settings.md).
- Informs teammate behavior across [Home](03-home.md), [Routines](06-routines.md), [War room](10-war-room-and-pulse.md).
