# Structured Project Experience Design

## Goal

Add structured project experience to Job Buddy for domestic graduate recruitment. Users can maintain multiple projects, import them from a resume, and use them in both structured and single-textarea job application forms.

## Data Model

Add a top-level `projects: ProjectEntry[]` field to `Profile`. Each entry contains:

- `name`: required project name;
- `role`: optional role or responsibility title;
- `startDate`: optional `YYYY` or `YYYY-MM`;
- `endDate`: optional `YYYY` or `YYYY-MM`;
- `isCurrent`: boolean;
- `technologies`: string array;
- `url`: optional project, repository, or demo URL;
- `description`: optional prose or bullet-form achievements.

Existing profiles without `projects` normalize to an empty array. Projects remain optional and do not lower profile completion percentage.

## Options UI

Add a `Project Experience` item to the sidebar and a dedicated `ProjectExperienceSection` following the existing multi-entry Work History and Education patterns.

The section supports adding, editing, deleting, and reordering projects. Each project card exposes the structured fields above. Saving uses the existing section save flow and toast behavior. Date validation accepts `YYYY` and `YYYY-MM`; an active project disables its end-date requirement.

## Resume Import and Persistence

Extend the Gemini and DeepSeek resume schema prompts so both providers extract a `projects` array without inventing missing values. Add `projects` to normalization, validation, diff review, import/export, and Google Drive payload handling through the existing `Profile` object.

Project descriptions preserve a plain context paragraph followed by achievement bullets when the resume contains both. Technology names are deduplicated while preserving their original display spelling.

## Autofill

The deterministic resolver and AI prompt expose project paths such as:

- `projects.0.name`;
- `projects.0.role`;
- `projects.0.startDate` and `projects.0.endDate`;
- `projects.0.technologies`;
- `projects.0.url`;
- `projects.0.description`.

For structured project fields, the provider returns the corresponding path and the existing fill pipeline writes the resolved value.

For a single field labelled like `Project Experience`, `Projects`, or `Relevant Projects`, the resolver exposes `projects.formatted`. It combines all projects using a stable text format containing the project name, role and dates, technology stack, URL, and description. Missing optional fields are omitted rather than rendered as empty labels.

AI field resolution must never invent project content. When a site has repeated project groups, Job Buddy maps the first group to `projects.0`, the second to `projects.1`, and so on when the surrounding labels provide enough context; uncertain groups remain unfilled.

## Compatibility and Error Handling

- Existing saved profiles load with `projects: []`.
- Imported JSON with malformed project entries skips only those entries and reports validation warnings through the existing import review behavior.
- Invalid project URLs remain optional and are rejected by the same URL rules used elsewhere.
- Provider, network, or parsing failures do not affect deterministic autofill.
- Project data follows the existing local-storage, export, and Drive privacy boundaries.

## Testing and Delivery

Add tests for profile migration, project validation, resume prompt schema, diff/apply behavior, formatted project resolution, structured path resolution, and AI prompt coverage. Update relevant completion and options navigation tests without making projects mandatory.

Run lint, targeted/unit tests, and a production Chrome MV3 build. Replace the existing unpacked deliverable and ZIP after successful verification. Do not embed the user's DeepSeek API key in source or build artifacts.
