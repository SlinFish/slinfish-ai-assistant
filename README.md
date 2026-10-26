# SlinFish AI Business Assistant — demo starter

A functional **rules-based prototype**, not a deployed AI model. Four fictional business configurations: real estate, automotive, retail and hospitality. Includes customer chat, approved FAQ answers, safe unknown-question fallback, and a demo inquiry form. **No inquiries are saved or delivered**; don't use this to collect real customers.

## Run
Install Node.js 20+, then run `npm start` and open http://localhost:3000. Run `npm test` to verify the response logic.

## Deploy
Create a GitHub repository named `slinfish-ai-assistant` and upload the files. Deploy on a Node.js-capable host with start command `npm start` and its provided `PORT` environment variable. Static-only Cloudflare Pages is insufficient because this project uses `/api` routes.

## Before production
Add a server-side AI integration grounded in approved knowledge, retrieval evaluation, rate limits, privacy notice and consent, secure lead persistence, staff notifications, authentication and role-based access, logging, and business isolation. Never claim that the prototype already provides these capabilities.
