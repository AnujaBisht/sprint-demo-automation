name: Weekly Jira Tickets to Confluence

on:
  workflow_dispatch:
  schedule:
    - cron: '30 3 * * 1'   # Every Monday 9 AM IST

jobs:
  fetch-and-summarize:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install jq
        run: sudo apt-get update && sudo apt-get install -y jq

      - name: Validate secrets
        run: |
          if [ -z "${{ secrets.JIRA_BASE_URL }}" ]; then echo "Missing JIRA_BASE_URL"; exit 1; fi
          if [ -z "${{ secrets.JIRA_EMAIL }}" ]; then echo "Missing JIRA_EMAIL"; exit 1; fi
          if [ -z "${{ secrets.JIRA_API_TOKEN }}" ]; then echo "Missing JIRA_API_TOKEN"; exit 1; fi
          if [ -z "${{ secrets.JIRA_BOARD_ID }}" ]; then echo "Missing JIRA_BOARD_ID"; exit 1; fi
          if [ -z "${{ secrets.CONFLUENCE_BASE_URL }}" ]; then echo "Missing CONFLUENCE_BASE_URL"; exit 1; fi
          if [ -z "${{ secrets.CONFLUENCE_EMAIL }}" ]; then echo "Missing CONFLUENCE_EMAIL"; exit 1; fi
          if [ -z "${{ secrets.CONFLUENCE_API_TOKEN }}" ]; then echo "Missing CONFLUENCE_API_TOKEN"; exit 1; fi
          if [ -z "${{ secrets.CONFLUENCE_SPACE_KEY }}" ]; then echo "Missing CONFLUENCE_SPACE_KEY"; exit 1; fi
          if [ -z "${{ secrets.GEMINI_API_KEY }}" ]; then echo "Missing GEMINI_API_KEY"; exit 1; fi
          echo "✓ All secrets validated"

      # ── STEP 1: Fetch active sprint ──────────────────────────────────────
      - name: Fetch active sprint
        run: |
          echo "Fetching active sprint from board ${{ secrets.JIRA_BOARD_ID }}..."

          response=$(curl -s \
            -u "${{ secrets.JIRA_EMAIL }}:${{ secrets.JIRA_API_TOKEN }}" \
            -H "Accept: application/json" \
            "${{ secrets.JIRA_BASE_URL }}/rest/agile/1.0/board/${{ secrets.JIRA_BOARD_ID }}/sprint?state=active")

          sprint_id=$(echo "$response" | jq -r '.values[0].id')
          sprint_name=$(echo "$response" | jq -r '.values[0].name')

          if [ -z "$sprint_id" ] || [ "$sprint_id" = "null" ]; then
            echo "No active sprint found"; exit 1
          fi

          echo "✓ Active Sprint: $sprint_name (ID: $sprint_id)"
          echo "SPRINT_ID=$sprint_id"     >> $GITHUB_ENV
          echo "SPRINT_NAME=$sprint_name" >> $GITHUB_ENV

      # ── STEP 2: Fetch IN REVIEW tickets ─────────────────────────────────
      # FIX: Use /rest/api/3/search with correct &fields= param (not ?fields=)
      # FIX: JQL uses sprint ID number, not variable in quotes
      - name: Fetch IN REVIEW tickets
        run: |
          echo "Fetching In Review tickets for sprint ${SPRINT_ID}..."

          response=$(curl -s \
            -u "${{ secrets.JIRA_EMAIL }}:${{ secrets.JIRA_API_TOKEN }}" \
            -H "Accept: application/json" \
            -G \
            --data-urlencode "jql=sprint=${SPRINT_ID} AND status=\"In Review\"" \
            --data-urlencode "fields=key,summary,description,status,assignee,issuetype,customfield_10016" \
            --data-urlencode "maxResults=50" \
            "${{ secrets.JIRA_BASE_URL }}/rest/api/3/search")

          echo "$response" > in_review_tickets.json

          # Debug: show what we got
          echo "Raw response total: $(echo "$response" | jq '.total')"
          count=$(jq '.issues | length' in_review_tickets.json)
          echo "✓ IN REVIEW Tickets found: $count"

          # Print ticket keys for verification
          jq -r '.issues[] | "  - \(.key): \(.fields.summary)"' in_review_tickets.json || echo "  (none)"

      # ── STEP 3: Fetch DONE tickets ───────────────────────────────────────
      # FIX: statusCategory=Done is not valid JQL — use status="Done" instead
      - name: Fetch DONE tickets
        run: |
          echo "Fetching Done tickets for sprint ${SPRINT_ID}..."

          response=$(curl -s \
            -u "${{ secrets.JIRA_EMAIL }}:${{ secrets.JIRA_API_TOKEN }}" \
            -H "Accept: application/json" \
            -G \
            --data-urlencode "jql=sprint=${SPRINT_ID} AND status=\"Done\"" \
            --data-urlencode "fields=key,summary,description,status,assignee,issuetype,customfield_10016" \
            --data-urlencode "maxResults=50" \
            "${{ secrets.JIRA_BASE_URL }}/rest/api/3/search")

          echo "$response" > done_tickets.json

          # Debug: show what we got
          echo "Raw response total: $(echo "$response" | jq '.total')"
          count=$(jq '.issues | length' done_tickets.json)
          echo "✓ DONE Tickets found: $count"

          # Print ticket keys for verification
          jq -r '.issues[] | "  - \(.key): \(.fields.summary)"' done_tickets.json || echo "  (none)"

      # ── STEP 4: Setup Node + install deps ───────────────────────────────
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm install @google/generative-ai

      # ── STEP 5: Generate AI summaries ───────────────────────────────────
      # FIX: generate-summaries.js is now written inline so no separate file needed
      - name: Generate summaries
        run: |
          cat << 'JSEOF' > generate-summaries.js
          const { GoogleGenerativeAI } = require("@google/generative-ai");
          const fs = require("fs");

          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
          const sprintName = process.env.SPRINT_NAME || "Sprint";

          // Helper: extract plain text from Jira ADF description
          function extractText(desc) {
            if (!desc) return "No description provided.";
            const texts = [];
            for (const block of desc.content || []) {
              for (const inline of block.content || []) {
                if (inline.type === "text") texts.push(inline.text || "");
              }
            }
            return texts.join(" ") || "No description provided.";
          }

          // Build a summary string for a list of tickets
          async function summariseTickets(tickets, statusLabel) {
            if (!tickets || tickets.length === 0) {
              return `No ${statusLabel} tickets this sprint.`;
            }

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            let summaryLines = [];

            for (const issue of tickets) {
              const f = issue.fields;
              const key = issue.key;
              const summary = f.summary || "";
              const description = extractText(f.description);
              const assignee = f.assignee ? f.assignee.displayName : "Unassigned";
              const points = f.customfield_10016 || "—";
              const type = f.issuetype ? f.issuetype.name : "Task";

              console.log(`  Summarising ${key}: ${summary.substring(0, 50)}...`);

              const prompt = `You are a scrum master writing a sprint demo summary.
          Summarise this Jira ticket in 2-3 clear sentences suitable for a stakeholder demo.
          Focus on what was done and the business value.

          Ticket: ${key} — ${summary}
          Type: ${type} | Story Points: ${points} | Assignee: ${assignee}
          Description: ${description}

          Return only the summary text, no bullet points, no headers.`;

              try {
                const result = await model.generateContent(prompt);
                const text = result.response.text().trim();
                summaryLines.push(`${key} (${assignee}, ${points} pts): ${text}`);
              } catch (err) {
                console.error(`  Error summarising ${key}: ${err.message}`);
                summaryLines.push(`${key}: ${summary} (AI summary unavailable)`);
              }

              // Small delay to avoid rate limits
              await new Promise(r => setTimeout(r, 500));
            }

            return summaryLines.join("\n\n");
          }

          async function main() {
            console.log("Loading ticket data...");

            const inReviewData = JSON.parse(fs.readFileSync("in_review_tickets.json", "utf8"));
            const doneData     = JSON.parse(fs.readFileSync("done_tickets.json", "utf8"));

            const inReviewTickets = inReviewData.issues || [];
            const doneTickets     = doneData.issues || [];

            console.log(`Found ${inReviewTickets.length} In Review, ${doneTickets.length} Done tickets`);

            console.log("\nSummarising In Review tickets...");
            const inReviewSummary = await summariseTickets(inReviewTickets, "In Review");

            console.log("\nSummarising Done tickets...");
            const doneSummary = await summariseTickets(doneTickets, "Done");

            fs.writeFileSync("in_review_summary.txt", inReviewSummary);
            fs.writeFileSync("done_summary.txt",      doneSummary);

            // Also write a combined JSON for richer Confluence content
            const combined = {
              sprintName,
              generatedAt: new Date().toISOString(),
              inReview: inReviewTickets.map(i => ({
                key:       i.key,
                summary:   i.fields.summary,
                assignee:  i.fields.assignee ? i.fields.assignee.displayName : "Unassigned",
                points:    i.fields.customfield_10016 || null,
              })),
              done: doneTickets.map(i => ({
                key:      i.key,
                summary:  i.fields.summary,
                assignee: i.fields.assignee ? i.fields.assignee.displayName : "Unassigned",
                points:   i.fields.customfield_10016 || null,
              })),
              inReviewSummary,
              doneSummary,
            };
            fs.writeFileSync("combined.json", JSON.stringify(combined, null, 2));
            console.log("\n✓ Summaries written to in_review_summary.txt, done_summary.txt, combined.json");
          }

          main().catch(err => { console.error(err); process.exit(1); });
          JSEOF

          node generate-summaries.js
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          SPRINT_NAME: ${{ env.SPRINT_NAME }}

      # ── STEP 6: Create / Update Confluence page ──────────────────────────
      # FIX: Read spaceId correctly — CONFLUENCE_SPACE_KEY must be the numeric
      #      space ID for v2 API, not the text key like "SCRUM".
      #      If you only have the text key, we first look it up then use the ID.
      - name: Create/Update Confluence page
        run: |
          IN_REVIEW_SUMMARY=$(cat in_review_summary.txt)
          DONE_SUMMARY=$(cat done_summary.txt)
          CURRENT_DATE=$(date '+%Y-%m-%d')
          PAGE_TITLE="Sprint Summary - ${SPRINT_NAME} - ${CURRENT_DATE}"

          echo "Looking up Confluence space ID for key: ${{ secrets.CONFLUENCE_SPACE_KEY }}..."

          # Look up numeric space ID from space key (needed for v2 API)
          SPACE_RESP=$(curl -s \
            -u "${{ secrets.CONFLUENCE_EMAIL }}:${{ secrets.CONFLUENCE_API_TOKEN }}" \
            -H "Accept: application/json" \
            "${{ secrets.CONFLUENCE_BASE_URL }}/wiki/api/v2/spaces?keys=${{ secrets.CONFLUENCE_SPACE_KEY }}")

          SPACE_ID=$(echo "$SPACE_RESP" | jq -r '.results[0].id // empty')

          if [ -z "$SPACE_ID" ]; then
            echo "Could not find space with key ${{ secrets.CONFLUENCE_SPACE_KEY }}"
            echo "Space API response: $SPACE_RESP"
            exit 1
          fi
          echo "✓ Space ID: $SPACE_ID"

          # Escape summaries for safe JSON embedding
          IN_REVIEW_ESCAPED=$(echo "$IN_REVIEW_SUMMARY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
          DONE_ESCAPED=$(echo "$DONE_SUMMARY"     | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
          TITLE_ESCAPED=$(echo "$PAGE_TITLE"      | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")

          # Build ADF (Atlassian Document Format) body
          BODY=$(cat << ADFEOF
          {
            "type": "doc",
            "version": 1,
            "content": [
              {
                "type": "heading",
                "attrs": { "level": 1 },
                "content": [{ "type": "text", "text": ${TITLE_ESCAPED} }]
              },
              {
                "type": "paragraph",
                "content": [{ "type": "text", "text": "Auto-generated by GitHub Actions on ${CURRENT_DATE}.", "marks": [{"type": "em"}] }]
              },
              {
                "type": "heading",
                "attrs": { "level": 2 },
                "content": [{ "type": "text", "text": "📋 In Review Tickets" }]
              },
              {
                "type": "paragraph",
                "content": [{ "type": "text", "text": ${IN_REVIEW_ESCAPED} }]
              },
              {
                "type": "heading",
                "attrs": { "level": 2 },
                "content": [{ "type": "text", "text": "✅ Completed (Done) Tickets" }]
              },
              {
                "type": "paragraph",
                "content": [{ "type": "text", "text": ${DONE_ESCAPED} }]
              }
            ]
          }
          ADFEOF
          )

          # Check if page already exists
          echo "Checking for existing Confluence page..."
          TITLE_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$PAGE_TITLE")

          PAGE_RESP=$(curl -s \
            -u "${{ secrets.CONFLUENCE_EMAIL }}:${{ secrets.CONFLUENCE_API_TOKEN }}" \
            -H "Accept: application/json" \
            "${{ secrets.CONFLUENCE_BASE_URL }}/wiki/api/v2/pages?spaceId=${SPACE_ID}&title=${TITLE_ENCODED}")

          PAGE_ID=$(echo "$PAGE_RESP" | jq -r '.results[0].id // empty')

          if [ -z "$PAGE_ID" ]; then
            # ── CREATE new page ─────────────────────────────────────────
            echo "Creating new Confluence page: $PAGE_TITLE"

            CREATE_RESP=$(curl -s -X POST \
              -u "${{ secrets.CONFLUENCE_EMAIL }}:${{ secrets.CONFLUENCE_API_TOKEN }}" \
              -H "Content-Type: application/json" \
              -H "Accept: application/json" \
              -d "{
                \"spaceId\": \"${SPACE_ID}\",
                \"title\": ${TITLE_ESCAPED},
                \"body\": {
                  \"representation\": \"atlas_doc_format\",
                  \"value\": $(echo "$BODY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
                }
              }" \
              "${{ secrets.CONFLUENCE_BASE_URL }}/wiki/api/v2/pages")

            NEW_PAGE_ID=$(echo "$CREATE_RESP" | jq -r '.id // empty')
            if [ -z "$NEW_PAGE_ID" ]; then
              echo "✗ Failed to create page. Response:"
              echo "$CREATE_RESP" | jq '.'
              exit 1
            fi
            echo "✓ Page created! ID: $NEW_PAGE_ID"
            echo "  URL: ${{ secrets.CONFLUENCE_BASE_URL }}/wiki/spaces/${{ secrets.CONFLUENCE_SPACE_KEY }}/pages/$NEW_PAGE_ID"

          else
            # ── UPDATE existing page ────────────────────────────────────
            echo "Updating existing page ID: $PAGE_ID"
            CURRENT_VERSION=$(echo "$PAGE_RESP" | jq -r '.results[0].version.number')
            NEW_VERSION=$((CURRENT_VERSION + 1))

            UPDATE_RESP=$(curl -s -X PUT \
              -u "${{ secrets.CONFLUENCE_EMAIL }}:${{ secrets.CONFLUENCE_API_TOKEN }}" \
              -H "Content-Type: application/json" \
              -H "Accept: application/json" \
              -d "{
                \"id\": \"${PAGE_ID}\",
                \"version\": { \"number\": ${NEW_VERSION} },
                \"title\": ${TITLE_ESCAPED},
                \"body\": {
                  \"representation\": \"atlas_doc_format\",
                  \"value\": $(echo "$BODY" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
                }
              }" \
              "${{ secrets.CONFLUENCE_BASE_URL }}/wiki/api/v2/pages/${PAGE_ID}")

            UPDATED_ID=$(echo "$UPDATE_RESP" | jq -r '.id // empty')
            if [ -z "$UPDATED_ID" ]; then
              echo "✗ Failed to update page. Response:"
              echo "$UPDATE_RESP" | jq '.'
              exit 1
            fi
            echo "✓ Page updated! Version: $NEW_VERSION"
            echo "  URL: ${{ secrets.CONFLUENCE_BASE_URL }}/wiki/spaces/${{ secrets.CONFLUENCE_SPACE_KEY }}/pages/$PAGE_ID"
          fi

      # ── Cleanup ──────────────────────────────────────────────────────────
      - name: Cleanup
        if: always()
        run: |
          rm -f in_review_tickets.json done_tickets.json \
                in_review_summary.txt done_summary.txt \
                combined.json generate-summaries.js
          echo "✓ Cleanup done"
