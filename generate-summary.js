import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const data = JSON.parse(fs.readFileSync("tickets.json", "utf8"));

let output = "";

for (const issue of data.issues) {
  const prompt = `
You are a senior software engineer.

Summarize this Jira ticket in 2-3 lines:
- What was the issue
- What was fixed
- Impact

Key: ${issue.key}
Summary: ${issue.fields.summary}
Description: ${issue.fields.description || "No description"}
`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const summary = res.choices[0].message.content;

  output += `\n## ${issue.key}\n${summary}\n`;
}

fs.writeFileSync("summary.md", output);
console.log("Summary generated");
