# DOCX download reliability implementation plan

**Goal:** Retry transient Telegram file download failures and clearly distinguish download failure from invalid DOCX; test and deploy as requested in chat.

**Architecture:** Keep retry policy inside TelegramBotApiService.getFile. Maximum three complete attempts with 2/4 second backoff, covering metadata and bytes. Retry network errors with a code and HTTP 5xx; retain existing bounded 429 handling. Do not change sendDocument retry semantics. Keep upload state on failure.

**Tech stack:** NestJS, Axios, Jest, Docker Compose.

## Steps
- [x] Add failing regression tests for metadata timeout, byte timeout, 5xx, exhausted retries, permanent errors, unchanged send behavior, and user-facing download/read distinction.
- [x] Implement retries in src/modules/messenger/telegram-bot-api.service.ts and download feedback in src/modules/bot/bot.service.ts plus config/locales/ru.json.
- [x] Run npm test -- --runInBand, npm run test:telegram, npm run test:messenger, npm run build; review diff.
- [ ] Commit, push to main for the existing deployment workflow; preserve previous image for rollback; verify deployed commit, healthy container and Telegram polling.

## Review focus
Bounded attempts; timeout retry only for reads; permanent failures stop immediately; token-free logs; upload state preserved; failed download never reported as corrupt DOCX.
