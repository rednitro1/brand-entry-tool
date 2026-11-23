# Brand Entry Tool

Enter a consumer brand (name or LinkedIn company URL). The tool researches the brand, finds the people who fit Nectar's wedge personas (CMO, Director of Social, Chief Digital Officer, Director of CX), pulls the brand's social page stats and recent post performance, and recommends a LinkedIn entry play with an evidence link behind every claim.

**It only recommends.** Nothing in this codebase posts, comments, connects or messages on LinkedIn.

- Stack and the reasoning behind it: [docs/STACK_DECISIONS.md](docs/STACK_DECISIONS.md)
- Schema: [db/migrations/001_init.sql](db/migrations/001_init.sql)

## Run locally
```
cp .env.example .env   # fill in keys
npm install
npm run build && npm start   # http://localhost:8080
npm test
```
