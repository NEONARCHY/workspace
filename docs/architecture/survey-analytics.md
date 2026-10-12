# Private survey analytics

## Product flow

`survey_analytics` is a Workspace module, not an iframe or a separate login. Upload XLSX,
legacy XLS or CSV, confirm a single source sheet and header row, inspect automatic question
types, correct them, then use search, AND filters, distributions, numeric summaries, group
comparison, quality flags and paginated raw responses. Save settings explicitly; reopen
from the author's library. Saved slices belong to that analysis. Archive is reversible;
it does not erase the original or release the storage quota.

The owner selected **private storage for the author**. Module view/create/edit rights are
checked by the API, and every detail/original/export/update also checks ownership. Admin
and superadmin module privileges do not override ownership. This is application access
control, not end-to-end encryption against infrastructure operators. Originals and parsed
matrices live in the existing private object store; private settings and metadata are in
PostgreSQL. Do not log filenames, response content, search terms or filter values. Audit
events contain only the action and actor/analysis identifiers. No response is sent to AI.

The section keeps its in-memory draft when navigating elsewhere, unmounts on logout,
identity change or permission loss, and never puts respondent data into localStorage.
Reloading or signing out discards unsaved settings, not the saved analysis. During saving,
controls are disabled. A conflict preserves the draft; cancel local changes and reopen
the current saved analysis before editing again. Uncertain uploads reuse their request
UUID and cannot create a second record for the same request. Changed contents with that
UUID return 409.

## Calculation contract

- One nonblank source row is one **assumed**, not verified, respondent. Source row numbers
  are preserved. Blank rows and rows before the confirmed header are explicitly excluded.
- Blank strings are missing. Literal `null`, `undefined`, `0` and negative answers are not
  automatically missing. Additional markers are explicit author settings.
- Category comparison normalizes case/spacing, while raw answers and originals remain
  unchanged. Multiple choice uses the chosen separator and deduplicates each option per row.
  Its base is respondents answering that question; summed percentages can exceed 100%.
- Numeric parsing accepts complete finite numeric strings, not digits extracted from dates,
  age bands or text. Mean/min/max/median use valid numbers only; invalid and missing counts
  are separate. Even-sized median averages both middle values. Screen numbers are rounded
  to at most three decimal places; summary CSV retains the numeric computed value.
- Group comparison has per-question bases and warns about overlapping multiple-choice
  groups. It makes no significance, representativeness, population or causal claim.
- Quality uses position-preserving normalized row signatures and a union of flagged row
  numbers. Repeated strings do not prove repeat participation and are never removed.
  Missing counts use the current filtered slice, not whole-workbook cached counts.
- Auto question detection is a hint, explicitly overridable. One column is one question.
  Separate checkbox columns are not automatically merged; sheets are not silently mixed.
  Weights, inferential statistics, free-text AI summaries, date filters, custom overlapping
  comparison group builders and automatic column-group reconstruction are not implemented.
  These are future explicit extensions, not capabilities implied by this release.

## Source provenance and integration choices

Reviewed the owner's working `C:\projects\survey` (HEAD `b45b9be`, including dirty working
files). The profiling/filtering/aggregation/comparison/quality workflow informs this
integration. That source checkout was not modified or reset. Existing Workspace React 19,
Fluent UI, Inter, semantic CSS tokens, authenticated API and storage are reused; standalone
Next/vinext/Electron shell, global CSS, demo dataset, global saved-view localStorage and the
old browser XLSX dependency are not embedded. The source's even-sized median, repeated
multiple-choice tokens, ambiguous duplicate signatures and overlapping issue counts have
regression tests in the replacement pure engine.

CSV exports quote headers and cells and neutralize potential Excel formulas, preserving
valid negative numbers. Excel export writes every header, answer and metadata cell as
literal text and verifies source row selection on the server. Export carries interpretation
settings and methodology; excluded identifiers remain in raw response export. This is not
anonymization. Protected original download remains byte-for-byte unchanged, including any
formulas: users must treat originals as untrusted documents.

## API and rollout

- `GET /survey-analyses`: owner-only library, including archives.
- `POST /survey-analyses?requestId=UUID&encoding=...&delimiter=...`: streamed original bytes,
  idempotent per owner/request, version 1. CSV options are explicit. The percent-encoded
  UTF-8 filename is in `X-Survey-Filename`, not the URL/access log; do not log that header.
- `GET /survey-analyses/{id}`: private metadata/settings and parsed source matrix.
- `PUT /survey-analyses/{id}`: title/archive/settings with `expectedRevision`; stale 409.
- `GET /survey-analyses/{id}/original`: owner-only attachment, no-store/nosniff.
- `POST /survey-analyses/{id}/export`: owner-only read/export, no database mutation.

Boundaries: 10 MiB/file, 20 sheets, 25,000 rows/sheet, 512 columns, 150,000 matrix cells,
2,000,000 response characters, 50 analyses/author including archives. CSV uses the standard
bounded field reader (about 128 KiB/cell). Office archives have existing compressed-package
checks plus safe XML and actual coordinate limits before the workbook reader allocates rows.
Encrypted files, macros and external XLSX links are rejected, never silently truncated.
The 150,000 limit also covers the full rectangular matrix including implicit empty cells,
preventing sparse inputs from ballooning during analysis/export. Parsing is limited to
two concurrent tasks per API process and runs off the event loop.
XLSX formulas are retained as text with a warning; XLS uses saved values without recalculation.

New dependency: pinned `xlrd==2.0.2` for legacy XLS; XLSX uses existing openpyxl. Install
updated locked Python dependencies before starting the new API. Apply **0086_survey_analytics**
from 0085 on the intended environment, then deploy matching API and renderer; publishing a
new EXE alone does not install the server feature. Existing personal navigation order is
preserved with the new key appended when missing. No migration was applied to live Workspace
during implementation; all database tests use a dedicated loopback PostgreSQL container.

Rollback may switch off the module and revert clients/API while retaining the new private
table and objects. Automatic destructive downgrade is intentionally refused. Do not bulk
delete `surveys/` keys: failed transactions can leave an unreferenced object; inventory
against both stored keys first and use a separately reviewed retention/cleanup procedure.
Include the private table and object store in the existing access-controlled backup and
restore process. The current 50-analysis quota has no end-user permanent-delete action.

## Verification boundaries

Synthetic CSV, actual synthetic BIFF2 XLS, XLSX multi-sheet/formula/empty-row, malformed,
oversized, unsafe XML, sparse coordinate, macro/external link and literal export tests.
PostgreSQL/API tests cover personal isolation (including superadmin), protected originals
and export, atomic version conflicts and simultaneous idempotent imports. Renderer tests
cover reopening, explicit saving, failed saving retaining input, rights, retries, search
denominators and arithmetic. Web build, strict types, lint and dependency audit are checked.

Live browser visual/responsive/keyboard verification remains pending: the available in-app
browser rejected loopback QA URLs with `ERR_BLOCKED_BY_CLIENT`; no security bypass was used.
No production dataset, EDO, server, installer, credentials or permissions were changed.

Local regression checkpoint: 881 Python tests passed, 2 optional tests skipped, overall
coverage 83.65%; subsequent focused parser/API/permission checks also passed after upload
filename-header hardening. 41 focused renderer/API/navigation tests plus the new App
section-retention scenario passed. Monorepo lint/typecheck/build, separate web build,
dependency audit and 15 release workflow tests passed. The full renderer run and hosted CI
are separate checks; use their latest status, not this checkpoint, before merge.

The App workflow tests compile the real Home/project/trip/feed/calendar chunks during
test collection, outside the business-scenario timer. They still use the production
React.lazy/Suspense loader and mocked HTTP boundary; this is not a measurement of
cold chunk download/compilation performance. Form queries are scoped to the actual
accessible dialog, and unrelated workflows start from Home rather than first opening
Messenger. The assistant cancellation regression waits for the background button to
become accessible after Fluent exit and Tabster's asynchronous modal isolation cleanup;
it does not query hidden controls or remove aria-hidden. Existing timeouts and business
assertions are unchanged.
