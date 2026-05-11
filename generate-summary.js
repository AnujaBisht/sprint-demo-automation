import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
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

  try {
    const result = await model.generateContent(prompt);

    const summary = result.response.text();

    output += `\n## ${issue.key}\n${summary}\n`;

    console.log(`Processed ${issue.key}`);
  } catch (err) {
    console.error(`Failed for ${issue.key}:`, err.message);
  }
}

fs.writeFileSync("summary.md", output);

console.log("Summary generated");
