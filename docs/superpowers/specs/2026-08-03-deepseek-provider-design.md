# DeepSeek Provider Design

## Goal

Add DeepSeek as a first-class AI provider for Job Buddy while retaining Gemini compatibility. New installations default to DeepSeek. Existing users with Gemini credentials continue to use Gemini unless they explicitly switch providers.

The DeepSeek provider must support both optional AI features:

- resume import from PDF and DOCX;
- AI resolution of fields that the deterministic autofill pipeline cannot resolve confidently.

All credentials remain in `chrome.storage.local`, are never included in profile exports, and are sent only to the selected provider.

## Chosen Approach

Introduce a small provider-neutral AI layer and keep provider-specific HTTP and document handling behind it.

Alternative approaches were rejected:

1. Replacing Gemini entirely would break existing configured users and remove a working fallback.
2. Using DeepSeek only for form autofill would leave resume import unusable for users who cannot obtain a Gemini key.
3. Sending base64 PDF or DOCX bytes inside a DeepSeek text prompt would be inefficient and would not make the document contents readable to the model.

## Provider Settings and Migration

Add these local-storage values:

- `aiProvider`: `'deepseek' | 'gemini'`;
- `deepseekApiKey`: string;
- `deepseekModel`: string.

Provider selection follows these rules:

1. If `aiProvider` is present, use it.
2. If it is absent and a legacy `geminiApiKey` exists, treat the user as a Gemini user and persist `aiProvider = 'gemini'` when settings are next saved.
3. If neither setting exists, default to `deepseek`.

Gemini storage keys remain unchanged for backward compatibility. AI settings remain outside profile export and Google Drive backup payloads.

The Settings page will show:

- an AI provider selector, with DeepSeek selected by default;
- a provider-specific API-key field and validation state;
- the selected model as internal configuration rather than an advanced user-facing requirement.

Switching providers does not delete the other provider's saved key. This makes switching reversible and avoids accidental credential loss. Clearing a displayed key clears only the selected provider's settings.

## DeepSeek HTTP Client

Create a provider client using direct `fetch` calls, avoiding an additional OpenAI SDK dependency.

- Base URL: `https://api.deepseek.com`.
- Key validation: authenticated `GET /models`.
- Default model: `deepseek-v4-flash`.
- Generation: `POST /chat/completions` with `Authorization: Bearer <key>`.
- Structured responses: `response_format: { "type": "json_object" }` where the expected top-level value is an object.
- Deterministic behavior: non-thinking mode and low temperature for parsing and field resolution.

The manifest receives `https://api.deepseek.com/*` in `host_permissions`.

The client maps provider responses into the same normalized profile and `AIFieldResponse[]` types already consumed by Job Buddy. Authentication, rate-limit, network, abort, empty-output, malformed-JSON, and model-unavailable failures are converted to the existing user-facing import error categories. AI autofill failures remain silent, preserving the current additive-AI contract.

For AI field resolution, the prompt currently requires a top-level JSON array. Since DeepSeek JSON mode guarantees a JSON object, the DeepSeek request will ask for an object shaped as `{ "fields": [...] }`, then unwrap and validate `fields` before returning the existing array type. Gemini retains its current raw-array contract.

## Resume Document Extraction

Gemini keeps its current native inline-document path.

DeepSeek receives extracted plain text rather than file bytes:

- PDF: reuse `pdfjs-dist` to extract page text and existing link annotations in the browser.
- DOCX: add a browser-compatible DOCX text extraction dependency and extract hyperlinks when available.
- Normalize whitespace while retaining line and paragraph boundaries useful for resume parsing.
- Reject documents whose extracted text is empty.
- Bound the extracted text sent to the provider and return a clear file/parse error instead of silently truncating essential content.

Document processing stays local until the extracted text and prompt are sent directly from the extension to DeepSeek. No Job Buddy server is introduced.

## Application Flow

The provider-neutral layer exposes operations equivalent to the existing Gemini functions:

- validate the selected provider key and choose a supported model;
- extract a partial profile from a resume;
- resolve unmatched application-form fields.

`ResumeImportSection` loads the selected provider configuration, prepares the document in the provider-appropriate format, and calls the neutral extraction operation. Existing review, diff, conflict, cancellation, and save behavior remains unchanged.

`runAIAutofill` loads the selected provider configuration and calls the neutral field-resolution operation after deterministic matching. The response continues through the existing validation, fill, confidence-color, picker, and learned-mapping logic.

## Error Handling and Privacy

- Never log API keys or Authorization headers.
- A missing key routes the user to Settings and identifies the selected provider.
- A 401 or 403 marks the selected key invalid.
- A 429 produces the existing rate-limit category with provider-appropriate guidance.
- Network and malformed-response failures are retryable during resume import.
- Abort signals stop resume requests without surfacing an error.
- AI autofill errors remain silent and do not block deterministic autofill.
- Provider keys and models are excluded from exported profile bundles and Drive backups.

## Tests and Acceptance Criteria

Add or update unit tests for:

- default provider selection and legacy Gemini migration;
- independent key storage and clearing for both providers;
- DeepSeek `/models` validation, authorization headers, and status mapping;
- DeepSeek chat request and response parsing;
- object-wrapped field-resolution responses and invalid item filtering;
- PDF and DOCX text extraction, empty documents, and cancellation;
- provider routing for resume import and autofill;
- Settings provider switching without deleting the inactive provider key;
- required DeepSeek host permission.

Before delivery, run:

1. `pnpm compile`
2. `pnpm lint`
3. `pnpm test:run`
4. `pnpm build`

The deliverable is a production Chrome MV3 unpacked directory that can be loaded from `chrome://extensions`, plus the modified source. No commit, push, release tag, or Chrome Web Store publication occurs without separate authorization.
